// =============================================================================
// Problem Management (ITIL).
//
// Full lifecycle: detect (manual or AI clustering of recurring incidents),
// investigate (RCA), document a workaround as a Known Error, then drive a
// permanent fix via a Change. Capabilities:
//   - impact x urgency -> priority matrix
//   - link / unlink incidents (with live impact counts)
//   - AI root-cause suggestion from the linked incidents
//   - publish a workaround to the knowledge base (KEDB -> self-service)
//   - raise a Change for the permanent fix
//   - collaboration notes + major-problem review + metrics
// Every action is recorded in the tamper-evident audit chain.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { complete } from "../ai/llm";
import { suggestProblemClusters, type ProblemCluster } from "../ai/aiService";
import { getStore } from "../data";
import { newId, now, reference } from "../domain/ids";
import { derivePriority } from "../domain/priority";
import { createArticle } from "./kbService";
import { createChange } from "./changeService";
import type {
  ImpactLevel,
  ProblemNote,
  ProblemRow,
  ProblemStatus,
  RcaMethod,
  TicketCategory,
  TicketPriority,
} from "../domain/models";

export { derivePriority };

export interface NewProblemInput {
  title: string;
  description: string;
  category?: TicketCategory;
  impact?: ImpactLevel;
  urgency?: ImpactLevel;
  priority?: TicketPriority;
  rootCause?: string;
  rcaMethod?: RcaMethod;
  workaround?: string;
  knownError?: boolean;
  assigneeId?: string;
}

export interface LinkedIncident {
  id: string;
  reference: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
}

export interface ProblemView extends ProblemRow {
  linkedIncidents: LinkedIncident[];
  openIncidentCount: number;
  assigneeName: string | null;
}

export interface ProblemMetrics {
  total: number;
  open: number;
  investigating: number;
  knownErrors: number;
  resolved: number;
  incidentsLinked: number;
}

const OPEN_INCIDENT = ["new", "open", "in_progress", "pending", "pending_agent", "escalated", "reopened"];

export async function listProblems(
  tenantId: string,
  filter: { status?: ProblemStatus; knownError?: boolean } = {}
): Promise<ProblemRow[]> {
  const store = await getStore();
  let rows = await store.problems.list({ tenantId });
  if (filter.status) rows = rows.filter((p) => p.status === filter.status);
  if (filter.knownError !== undefined) rows = rows.filter((p) => p.knownError === filter.knownError);
  return rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getProblem(id: string): Promise<ProblemRow | null> {
  const store = await getStore();
  return store.problems.get(id);
}

export async function getProblemView(id: string): Promise<ProblemView | null> {
  const store = await getStore();
  const problem = await store.problems.get(id);
  if (!problem) return null;

  const linked = (await store.tickets.list({ tenantId: problem.tenantId })).filter(
    (t) => t.problemId === id
  );
  const assignee = problem.assigneeId ? await store.users.get(problem.assigneeId) : null;

  return {
    ...problem,
    linkedIncidents: linked
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((t) => ({
        id: t.id,
        reference: t.reference,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        createdAt: t.createdAt,
      })),
    openIncidentCount: linked.filter((t) => OPEN_INCIDENT.includes(t.status)).length,
    assigneeName: assignee?.name ?? null,
  };
}

export async function createProblem(
  tenantId: string,
  input: NewProblemInput,
  actor = "system"
): Promise<ProblemRow> {
  const store = await getStore();
  const priority = input.priority ?? derivePriority(input.impact, input.urgency);
  const problem: ProblemRow = {
    id: newId("prb"),
    reference: reference("PRB"),
    tenantId,
    title: input.title.trim(),
    description: input.description.trim(),
    status: "open",
    priority,
    impact: input.impact ?? null,
    urgency: input.urgency ?? null,
    category: input.category ?? "Other",
    rootCause: input.rootCause ?? null,
    rcaMethod: input.rcaMethod ?? null,
    workaround: input.workaround ?? null,
    knownError: input.knownError ?? false,
    publishedArticleId: null,
    changeId: null,
    reviewNotes: null,
    notes: [],
    assigneeId: input.assigneeId ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.problems.create(problem);
  await appendAudit({
    tenantId,
    actor,
    action: "problem.created",
    payload: { reference: problem.reference, title: problem.title, priority },
  });
  return problem;
}

export interface ProblemPatch {
  title?: string;
  description?: string;
  status?: ProblemStatus;
  impact?: ImpactLevel;
  urgency?: ImpactLevel;
  category?: TicketCategory;
  rootCause?: string;
  rcaMethod?: RcaMethod;
  workaround?: string;
  knownError?: boolean;
  reviewNotes?: string;
  assigneeId?: string | null;
}

export async function updateProblem(
  id: string,
  patch: ProblemPatch,
  actor = "system"
): Promise<ProblemRow | null> {
  const store = await getStore();
  const existing = await store.problems.get(id);
  if (!existing) return null;

  const next: Partial<ProblemRow> = { ...patch, updatedAt: now() };
  // Recompute priority if impact/urgency changed.
  if (patch.impact || patch.urgency) {
    next.priority = derivePriority(patch.impact ?? existing.impact, patch.urgency ?? existing.urgency);
  }
  // Marking a known error implies it is at least investigated.
  if (patch.knownError && existing.status === "open") next.status = patch.status ?? "known_error";

  const updated = await store.problems.update(id, next);
  const changes = Object.keys(patch);
  await appendAudit({
    tenantId: existing.tenantId,
    actor,
    action: patch.status && patch.status !== existing.status ? `problem.status.${patch.status}` : "problem.updated",
    payload: { id, changes },
  });
  return updated;
}

export async function linkIncident(problemId: string, ticketId: string, actor = "system"): Promise<boolean> {
  const store = await getStore();
  const problem = await store.problems.get(problemId);
  const ticket = await store.tickets.get(ticketId);
  if (!problem || !ticket) return false;
  await store.tickets.update(ticketId, { problemId, updatedAt: now() });
  await appendAudit({
    tenantId: problem.tenantId,
    actor,
    action: "problem.incident.linked",
    ticketId,
    payload: { problemId, reference: problem.reference },
  });
  return true;
}

export async function unlinkIncident(problemId: string, ticketId: string, actor = "system"): Promise<boolean> {
  const store = await getStore();
  const ticket = await store.tickets.get(ticketId);
  if (!ticket || ticket.problemId !== problemId) return false;
  await store.tickets.update(ticketId, { problemId: null, updatedAt: now() });
  await appendAudit({
    tenantId: ticket.tenantId,
    actor,
    action: "problem.incident.unlinked",
    ticketId,
    payload: { problemId },
  });
  return true;
}

export async function addNote(id: string, author: string, body: string): Promise<ProblemRow | null> {
  const store = await getStore();
  const problem = await store.problems.get(id);
  if (!problem || !body.trim()) return null;
  const note: ProblemNote = { id: newId("note"), author, body: body.trim(), at: now() };
  const notes = [...(problem.notes ?? []), note];
  const updated = await store.problems.update(id, { notes, updatedAt: now() });
  await appendAudit({
    tenantId: problem.tenantId,
    actor: `agent:${author}`,
    action: "problem.note.added",
    payload: { id, chars: body.trim().length },
  });
  return updated;
}

/** AI: suggest problem candidates by clustering similar open incidents. */
export async function suggestClusters(tenantId: string): Promise<ProblemCluster[]> {
  const store = await getStore();
  const open = (await store.tickets.list({ tenantId })).filter(
    (t) => t.type === "incident" && OPEN_INCIDENT.includes(t.status) && !t.problemId
  );
  return suggestProblemClusters(open.map((t) => ({ id: t.id, subject: t.subject, body: t.body })));
}

/** Create a problem from an AI cluster and auto-link the incidents. */
export async function createFromCluster(
  tenantId: string,
  cluster: { theme: string; ticketIds: string[] },
  actor = "system"
): Promise<ProblemRow> {
  const store = await getStore();
  const first = cluster.ticketIds[0] ? await store.tickets.get(cluster.ticketIds[0]) : null;
  const problem = await createProblem(
    tenantId,
    {
      title: cluster.theme,
      description: `Auto-created from ${cluster.ticketIds.length} similar incidents. Investigate the common root cause.`,
      category: first?.category ?? "Other",
      impact: "medium",
      urgency: "medium",
    },
    actor
  );
  await store.problems.update(problem.id, { status: "investigating" });
  for (const ticketId of cluster.ticketIds) {
    await linkIncident(problem.id, ticketId, actor);
  }
  return (await store.problems.get(problem.id)) ?? problem;
}

/** AI: propose a root cause from the problem and its linked incidents. */
export async function aiSuggestRootCause(id: string): Promise<{ rootCause: string } | null> {
  const view = await getProblemView(id);
  if (!view) return null;
  const incidents = view.linkedIncidents.map((i) => `- ${i.subject}`).join("\n");
  const suggestion = await complete(
    "You are an ITIL problem manager performing root cause analysis. Be concise and specific.",
    `Problem: ${view.title}\nDescription: ${view.description}\nLinked incidents:\n${incidents || "(none yet)"}\n\nPropose the single most likely root cause in 1-2 sentences, then a one-line recommended permanent fix.`
  );
  return { rootCause: suggestion ?? "Insufficient signal to infer a root cause; gather more incident detail." };
}

/** Publish the workaround to the knowledge base (Known Error -> self-service). */
export async function publishWorkaroundToKb(id: string, actor = "system"): Promise<ProblemRow | null> {
  const store = await getStore();
  const problem = await store.problems.get(id);
  if (!problem || !problem.workaround) return null;

  const article = await createArticle(problem.tenantId, {
    title: `Workaround: ${problem.title}`,
    content: [
      problem.workaround,
      problem.rootCause ? `\n\nRoot cause: ${problem.rootCause}` : "",
      `\n\nReference: ${problem.reference} (known error).`,
    ].join(""),
    category: problem.category,
    tags: ["known error", "workaround", problem.reference.toLowerCase()],
    status: "published",
    isPublic: true,
  });

  const updated = await store.problems.update(id, { publishedArticleId: article.id, knownError: true, updatedAt: now() });
  await appendAudit({
    tenantId: problem.tenantId,
    actor,
    action: "problem.workaround.published",
    payload: { id, articleId: article.id },
  });
  return updated;
}

/** Raise a Change for the permanent fix and link it to the problem. */
export async function raiseChange(id: string, actor = "system"): Promise<{ problem: ProblemRow; changeId: string } | null> {
  const store = await getStore();
  const problem = await store.problems.get(id);
  if (!problem) return null;

  const change = await createChange(problem.tenantId, {
    title: `Permanent fix: ${problem.title}`,
    description: [
      problem.description,
      problem.rootCause ? `\n\nRoot cause: ${problem.rootCause}` : "",
      problem.workaround ? `\n\nCurrent workaround: ${problem.workaround}` : "",
      `\n\nRaised from problem ${problem.reference}.`,
    ].join(""),
    type: "normal",
  });

  const updated = await store.problems.update(id, { changeId: change.id, updatedAt: now() });
  await appendAudit({
    tenantId: problem.tenantId,
    actor,
    action: "problem.change.raised",
    payload: { id, changeId: change.id, changeRef: change.reference },
  });
  return { problem: updated ?? problem, changeId: change.id };
}

export async function problemMetrics(tenantId: string): Promise<ProblemMetrics> {
  const store = await getStore();
  const problems = await store.problems.list({ tenantId });
  const tickets = await store.tickets.list({ tenantId });
  return {
    total: problems.length,
    open: problems.filter((p) => p.status === "open").length,
    investigating: problems.filter((p) => p.status === "investigating").length,
    knownErrors: problems.filter((p) => p.knownError).length,
    resolved: problems.filter((p) => p.status === "resolved" || p.status === "closed").length,
    incidentsLinked: tickets.filter((t) => t.problemId).length,
  };
}

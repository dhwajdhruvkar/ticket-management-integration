import { getStore } from "../data";
import type { ArticleRow, AssignmentGroupRow, TicketRow, UserRow } from "../domain/models";
import { defaultWorkflowSettings } from "@/shared/workflow";
import { bowEmbed, cosineSimilarity } from "../ai/embeddings";
import { search, type SearchHit } from "../ai/vectorSearch";
import { activeWorkload, calculateAvailability, rankExperiencedAgents, type AgentAvailability, type AgentSuggestion } from "./availabilityService";
import { WorkflowError } from "./workflowService";

export interface GroupRecommendation {
  groupId: string; name: string; score: number; confidence: "high" | "medium" | "low"; reasons: string[];
  evidence: { tickets: { id: string; reference: string; subject: string }[]; articles: { id: string; title: string }[] }; availableMembers: number;
}
export interface RoutingRecommendation {
  groups: GroupRecommendation[]; recurring: { count: number; problemId: string | null } | null;
  agents: AgentSuggestion[]; basis: string;
}
export interface ScoreInput {
  ticket: TicketRow; departmentGroups: AssignmentGroupRow[]; history: TicketRow[]; kbHits: { article: ArticleRow; score: number }[];
  availableCount: Record<string, number>; now?: number;
}

const DAY_MS = 86_400_000;
const SIMILAR_MIN = 0.35;
const RECURRING_MIN = 0.5;
const ARTICLE_MIN = 0.3;
const RECURRING_COUNT = 3;
const EVIDENCE_LIMIT = 3;
const staffRoles = ["agent", "manager", "tenant_admin", "super_admin"];
const managerRoles = ["manager", "tenant_admin", "super_admin"];

interface GroupAccumulator {
  group: AssignmentGroupRow; score: number; similar: { row: TicketRow; sim: number }[]; articles: ArticleRow[]; owns: boolean;
}

/** Pure ranking over pre-loaded rows. Evidence-first: no evidence means no suggestion. */
export function scoreGroups(input: ScoreInput): { groups: GroupRecommendation[]; recurring: RoutingRecommendation["recurring"] } {
  const { ticket, departmentGroups, history, kbHits, availableCount } = input;
  const now = input.now ?? Date.now();
  const query = bowEmbed(`${ticket.subject} ${ticket.body}`);
  const scored = history
    .filter((row) => row.tenantId === ticket.tenantId && row.id !== ticket.id && !row.deletedAt)
    .map((row) => ({ row, sim: cosineSimilarity(query, bowEmbed(`${row.subject} ${row.body}`)) }));

  const accumulators = new Map(departmentGroups.map((group) => [group.id, { group, score: 0, similar: [], articles: [], owns: false } as GroupAccumulator]));
  for (const { row, sim } of scored) {
    const bucket = row.assignmentGroupId ? accumulators.get(row.assignmentGroupId) : undefined;
    const resolved = !!row.resolvedById && !!row.resolvedAt && ["resolved", "closed"].includes(row.status);
    if (!bucket || !resolved || sim < SIMILAR_MIN) continue;
    const recent = now - Date.parse(row.resolvedAt!) <= 90 * DAY_MS;
    bucket.score += sim * (recent ? 1 : 0.6);
    bucket.similar.push({ row, sim });
  }
  for (const hit of kbHits) {
    if (hit.score < ARTICLE_MIN) continue;
    for (const bucket of accumulators.values()) {
      if (!bucket.group.categories.includes(hit.article.category)) continue;
      bucket.score += 0.5 * hit.score;
      bucket.articles.push(hit.article);
    }
  }
  for (const bucket of accumulators.values()) {
    if (bucket.group.categories.includes(ticket.category)) { bucket.score += 0.25; bucket.owns = true; }
  }

  const recurringRows = scored.filter(({ row, sim }) => now - Date.parse(row.createdAt) <= 30 * DAY_MS && sim >= RECURRING_MIN);
  const recurring = recurringRows.length >= RECURRING_COUNT
    ? { count: recurringRows.length, problemId: recurringRows.map(({ row }) => row.problemId).find(Boolean) ?? null }
    : null;

  const groups = [...accumulators.values()].filter((bucket) => bucket.score > 0).map((bucket): GroupRecommendation => {
    const reasons: string[] = [];
    if (bucket.similar.length) reasons.push(`Resolved ${bucket.similar.length} similar ticket${bucket.similar.length === 1 ? "" : "s"} in this group`);
    if (bucket.articles.length) reasons.push(`${bucket.articles.length} matching knowledge article${bucket.articles.length === 1 ? "" : "s"}`);
    if (bucket.owns) reasons.push(`Group owns the ${ticket.category} category.`);
    let score = bucket.score;
    if (availableCount[bucket.group.id] === 0) { score *= 0.7; reasons.push("No member is available right now."); }
    const confidence = score >= 1 ? "high" : score >= 0.5 ? "medium" : "low";
    return {
      groupId: bucket.group.id, name: bucket.group.name, score: Math.round(score * 100) / 100, confidence, reasons,
      evidence: {
        tickets: [...bucket.similar].sort((a, b) => b.sim - a.sim).slice(0, EVIDENCE_LIMIT).map(({ row }) => ({ id: row.id, reference: row.reference, subject: row.subject })),
        articles: bucket.articles.slice(0, EVIDENCE_LIMIT).map((article) => ({ id: article.id, title: article.title })),
      },
      availableMembers: availableCount[bucket.group.id] ?? 0,
    };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 3);

  if (recurring && groups[0]) groups[0].reasons.push(`Recurring issue (${recurring.count} similar in 30 days)`);
  return { groups, recurring };
}

/** Lazily computed for one open panel. Advisory only: a human still routes the ticket. */
export async function recommendRouting(tenantId: string, ticketId: string, actorId: string): Promise<RoutingRecommendation> {
  const store = await getStore();
  const actor = await store.users.get(actorId);
  if (!actor?.active || actor.tenantId !== tenantId || !staffRoles.includes(actor.role)) throw new WorkflowError("An active organization staff account is required.", 403);
  const ticket = await store.tickets.get(ticketId);
  if (!ticket || ticket.tenantId !== tenantId || ticket.deletedAt) throw new WorkflowError("Ticket not found.", 404);
  const tenant = await store.tenants.get(tenantId);
  const settings = tenant?.workflowSettings ?? defaultWorkflowSettings();
  const serviceDesk = settings.serviceDeskGroupId ? await store.groups.get(settings.serviceDeskGroupId) : null;
  const deskMember = serviceDesk?.tenantId === tenantId && serviceDesk.memberIds.includes(actor.id);
  if (!managerRoles.includes(actor.role) && !deskMember) throw new WorkflowError("Only a manager or a Service Desk member can request a routing suggestion.", 403);
  if (ticket.workflow?.phase !== "service_desk") throw new WorkflowError("Routing suggestions are only available while a ticket is in the Service Desk bucket.", 409);

  const departmentIds = new Set(settings.buckets.filter((bucket) => bucket.kind === "department").map((bucket) => bucket.groupId));
  const [groups, allTickets, users, calendars] = await Promise.all([
    store.groups.list({ tenantId }), store.tickets.list({ tenantId, deletedAt: null }), store.users.list({ tenantId, active: true }), store.calendars.list({ tenantId }),
  ]);
  const departmentGroups = groups.filter((group) => departmentIds.has(group.id));
  // ponytail: same bounded history window as workflowBoard.ts.
  const history = allTickets.filter((row) => row.resolvedAt).sort((a, b) => b.resolvedAt!.localeCompare(a.resolvedAt!)).slice(0, 500);
  const staff: UserRow[] = users.filter((row) => staffRoles.includes(row.role));
  const availability: Record<string, AgentAvailability> = Object.fromEntries(staff.map((row) => [row.id, calculateAvailability(row, activeWorkload(allTickets, row.id), calendars.find((calendar) => calendar.id === row.availabilitySettings?.calendarId), settings.availabilityMode)]));
  const availableCount = Object.fromEntries(departmentGroups.map((group) => [group.id, group.memberIds.filter((id) => availability[id]?.status === "available").length]));

  const kb = await search(tenantId, `${ticket.subject} ${ticket.body}`, 4);
  const hits: SearchHit[] = kb.hits;
  const { groups: ranked, recurring } = scoreGroups({ ticket, departmentGroups, history, kbHits: hits, availableCount });
  const top = ranked[0] ? departmentGroups.find((group) => group.id === ranked[0].groupId) : undefined;
  const members = top ? staff.filter((row) => top.memberIds.includes(row.id)) : [];
  const agents = top ? rankExperiencedAgents(ticket, members, history, availability).slice(0, 5) : [];
  return {
    groups: ranked, recurring, agents,
    basis: `Compared against ${history.length} recent resolved ticket(s) and ${hits.length} knowledge article match(es).`,
  };
}

// =============================================================================
// Ticket service (server-side).
//
// All ticket reads/writes go through the DataStore port and record both a
// lifecycle event and a hash-chained audit block. Returns composed TicketViews
// (ticket + messages + events + resolution + assignee) for the API and UI.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { newId, now, ticketReference } from "../domain/ids";
import { derivePriority } from "../domain/priority";
import { publishEvent } from "../events/bus";
import { slaPausePatch, slaStatus, type SlaStatus } from "./slaService";
import type {
  ApprovalRow,
  AssignmentGroupRow,
  CIRow,
  CitationRow,
  ImpactLevel,
  MessageVisibility,
  ResolutionRow,
  TicketCategory,
  TicketChannel,
  TicketEventRow,
  TicketMessageRow,
  TicketPriority,
  TicketRow,
  TicketType,
  UserRow,
} from "../domain/models";

export interface TicketView extends TicketRow {
  messages: TicketMessageRow[];
  events: TicketEventRow[];
  resolution: (ResolutionRow & { citations: CitationRow[] }) | null;
  assignee: UserRow | null;
  assignmentGroup: AssignmentGroupRow | null;
  linkedCIs: CIRow[];
  approvals: ApprovalRow[];
  sla: SlaStatus;
}

export interface NewTicketInput {
  subject: string;
  body: string;
  requesterEmail: string;
  type?: TicketType;
  channel?: TicketChannel;
  category?: TicketCategory;
  subcategory?: string;
  impact?: ImpactLevel;
  urgency?: ImpactLevel;
  priority?: TicketPriority;
  tags?: string[];
  source?: string;
  catalogItemId?: string;
  ciIds?: string[];
}

export async function listTickets(
  tenantId: string,
  where: Partial<TicketRow> = {}
): Promise<TicketRow[]> {
  const store = await getStore();
  const rows = await store.tickets.list({ tenantId, ...where });
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getTicket(id: string): Promise<TicketRow | null> {
  const store = await getStore();
  return store.tickets.get(id);
}

export async function getTicketView(id: string): Promise<TicketView | null> {
  const store = await getStore();
  const ticket = await store.tickets.get(id);
  if (!ticket) return null;

  const [messages, events, resolutions, approvals, assignee, group] = await Promise.all([
    store.messages.list({ ticketId: id }),
    store.events.list({ ticketId: id }),
    store.resolutions.list({ ticketId: id }),
    store.approvals.list({ ticketId: id }),
    ticket.assigneeId ? store.users.get(ticket.assigneeId) : Promise.resolve(null),
    ticket.assignmentGroupId ? store.groups.get(ticket.assignmentGroupId) : Promise.resolve(null),
  ]);

  const linkedCIs: CIRow[] = [];
  for (const ciId of ticket.ciIds ?? []) {
    const ci = await store.cis.get(ciId);
    if (ci) linkedCIs.push(ci);
  }

  let resolution: TicketView["resolution"] = null;
  if (resolutions[0]) {
    const citations = await store.citations.list({ resolutionId: resolutions[0].id });
    resolution = { ...resolutions[0], citations };
  }

  return {
    ...ticket,
    assignee: assignee ?? null,
    assignmentGroup: group ?? null,
    linkedCIs,
    approvals: approvals.sort(byCreatedAtAsc),
    sla: slaStatus(ticket),
    messages: messages.sort(byCreatedAtAsc),
    events: events.sort(byCreatedAtAsc),
    resolution,
  };
}

export async function createTicket(
  tenantId: string,
  input: NewTicketInput,
  actor = "system"
): Promise<TicketRow> {
  const store = await getStore();
  const ts = now();
  const type = input.type ?? "incident";
  // ITIL: impact x urgency drives priority; an explicit priority wins.
  const priority =
    input.priority ?? (input.impact && input.urgency ? derivePriority(input.impact, input.urgency) : "medium");
  const ticket: TicketRow = {
    id: newId("tkt"),
    reference: ticketReference(type),
    tenantId,
    type,
    subject: input.subject.trim(),
    body: input.body.trim(),
    status: "open",
    priority,
    impact: input.impact ?? null,
    urgency: input.urgency ?? null,
    category: input.category ?? "Other",
    subcategory: input.subcategory ?? null,
    channel: input.channel ?? "portal",
    source: input.source ?? null,
    tags: input.tags ?? [],
    customFields: null,
    requesterEmail: input.requesterEmail.trim(),
    requesterId: null,
    assigneeId: null,
    assignmentGroupId: null,
    problemId: null,
    changeId: null,
    catalogItemId: input.catalogItemId ?? null,
    ciIds: input.ciIds ?? [],
    linkedTicketIds: [],
    mergedIntoId: null,
    satisfaction: null,
    resolutionNotes: null,
    firstRespondedAt: null,
    resolvedAt: null,
    closedAt: null,
    dueResponseAt: null,
    dueResolveAt: null,
    slaPolicyId: null,
    slaPausedAt: null,
    slaPausedMins: 0,
    createdAt: ts,
    updatedAt: ts,
  };
  await store.tickets.create(ticket);
  await recordEvent(ticket.id, "created", `Ticket ingested via ${ticket.channel}.`);
  await appendAudit({
    tenantId,
    actor,
    action: "ticket.ingested",
    ticketId: ticket.id,
    payload: {
      reference: ticket.reference,
      type: ticket.type,
      subject: ticket.subject,
      requester: ticket.requesterEmail,
      channel: ticket.channel,
      priority: ticket.priority,
    },
  });
  return ticket;
}

/**
 * Patch ticket fields, append a lifecycle event, and bump updatedAt. Status
 * transitions automatically maintain the SLA pause clock (pending pauses,
 * leaving pending resumes and shifts due dates) and stamp closedAt.
 */
export async function mutateTicket(
  id: string,
  patch: Partial<TicketRow>,
  event?: { type: string; message: string; meta?: Record<string, unknown> }
): Promise<TicketRow | null> {
  const store = await getStore();
  const current = await store.tickets.get(id);
  if (!current) return null;

  let full: Partial<TicketRow> = { ...patch };
  if (patch.status && patch.status !== current.status) {
    full = { ...slaPausePatch(current, patch.status), ...full };
    if (patch.status === "closed" && !patch.closedAt && !current.closedAt) full.closedAt = now();
    // Stamp resolvedAt for any path into a resolved-family status (automation
    // set_status, agent PATCH) so auto-close and MTTR/trend metrics see it;
    // explicit resolvedAt in the patch (agent actions, resolver) wins.
    if (
      (patch.status === "resolved" || patch.status === "auto_resolved" || patch.status === "closed") &&
      patch.resolvedAt === undefined &&
      !current.resolvedAt
    ) {
      full.resolvedAt = now();
    }
    if (patch.status === "reopened") {
      full.closedAt = null;
      if (patch.resolvedAt === undefined) full.resolvedAt = null;
    }
  }

  const updated = await store.tickets.update(id, { ...full, updatedAt: now() });
  if (updated && event) {
    await recordEvent(id, event.type, event.message, event.meta);
  }
  if (updated) {
    publishEvent({
      type: "ticket.updated",
      tenantId: updated.tenantId,
      ticketId: updated.id,
      ticketReference: updated.reference,
      requesterEmail: updated.requesterEmail,
    });
    // "ticket.updated" automations fire on status transitions only (the common
    // enterprise trigger), guarded against automation-inflicted recursion.
    if (patch.status && patch.status !== current.status) {
      const { runAutomationsSafe } = await import("./automationService");
      await runAutomationsSafe(updated.tenantId, "ticket.updated", updated.id);
    }
  }
  return updated;
}

export async function addMessage(
  ticketId: string,
  msg: {
    authorKind: TicketMessageRow["authorKind"];
    authorName: string;
    visibility: MessageVisibility;
    body: string;
  }
): Promise<TicketMessageRow> {
  const store = await getStore();
  const message: TicketMessageRow = {
    id: newId("msg"),
    ticketId,
    authorKind: msg.authorKind,
    authorName: msg.authorName,
    visibility: msg.visibility,
    body: msg.body.trim(),
    createdAt: now(),
  };
  await store.messages.create(message);
  return message;
}

export async function recordEvent(
  ticketId: string,
  type: string,
  message: string,
  meta?: Record<string, unknown>
): Promise<TicketEventRow> {
  const store = await getStore();
  const event: TicketEventRow = {
    id: newId("evt"),
    ticketId,
    type,
    message,
    meta: meta ?? null,
    createdAt: now(),
  };
  await store.events.create(event);
  return event;
}

function byCreatedAtAsc(a: { createdAt: string }, b: { createdAt: string }): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

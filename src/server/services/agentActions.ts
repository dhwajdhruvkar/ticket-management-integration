// =============================================================================
// Human ticket actions (server-side).
//
// Replies, internal notes, assignment (user + group), manual resolve/close/
// reopen, inline field edits (including impact x urgency -> priority recalc
// with audited manual overrides), requester replies, and CSAT. Each composes
// addMessage + mutateTicket (lifecycle event) + appendAudit (hash-chained
// record) + templated notifications.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { now } from "../domain/ids";
import { derivePriority, priorityCode } from "../domain/priority";
import { notifyTemplate } from "../notify/templates";
import { addMessage, getTicket, mutateTicket } from "./ticketService";
import type {
  ImpactLevel,
  MessageVisibility,
  TicketCategory,
  TicketPriority,
  TicketRow,
} from "../domain/models";

export interface Actor {
  name: string;
  role?: string;
}

async function tenantOf(ticketId: string): Promise<{ ticket: TicketRow; tenantId: string } | null> {
  const ticket = await getTicket(ticketId);
  return ticket ? { ticket, tenantId: ticket.tenantId } : null;
}

export async function agentReply(
  ticketId: string,
  agent: Actor,
  body: string,
  visibility: MessageVisibility
): Promise<TicketRow | null> {
  const ctx = await tenantOf(ticketId);
  if (!ctx || !body.trim()) return null;
  const isPublic = visibility === "public";

  await addMessage(ticketId, { authorKind: "agent", authorName: agent.name, visibility, body });

  const patch: Partial<TicketRow> = {};
  if (isPublic && !ctx.ticket.firstRespondedAt) patch.firstRespondedAt = now();
  // A public reply on a fresh or reopened ticket means an agent is actively
  // working it — move it to in_progress so queues and metrics reflect that.
  if (isPublic && ["open", "new", "reopened"].includes(ctx.ticket.status)) patch.status = "in_progress";

  const updated = await mutateTicket(ticketId, patch, {
    type: isPublic ? "reply_sent" : "note_added",
    message: isPublic ? `${agent.name} replied to the requester.` : `${agent.name} added an internal note.`,
  });
  await appendAudit({
    tenantId: ctx.tenantId,
    actor: `agent:${agent.name}`,
    action: isPublic ? "ticket.reply.public" : "ticket.note.internal",
    ticketId,
    payload: { visibility, chars: body.trim().length },
  });
  return updated;
}

export async function agentResolve(
  ticketId: string,
  agent: Actor,
  replyBody?: string,
  resolutionNotes?: string
): Promise<TicketRow | null> {
  const ctx = await tenantOf(ticketId);
  if (!ctx) return null;
  const ts = now();
  const patch: Partial<TicketRow> = { status: "resolved", resolvedAt: ts };
  if (resolutionNotes?.trim()) patch.resolutionNotes = resolutionNotes.trim();

  if (replyBody && replyBody.trim()) {
    await addMessage(ticketId, {
      authorKind: "agent",
      authorName: agent.name,
      visibility: "public",
      body: replyBody,
    });
    if (!ctx.ticket.firstRespondedAt) patch.firstRespondedAt = ts;
  }

  const updated = await mutateTicket(ticketId, patch, {
    type: "resolved",
    message: `${agent.name} resolved the ticket.`,
  });
  await appendAudit({
    tenantId: ctx.tenantId,
    actor: `agent:${agent.name}`,
    action: "ticket.resolved.manual",
    ticketId,
    payload: { withReply: !!(replyBody && replyBody.trim()) },
  });
  await notifyTemplate({
    tenantId: ctx.tenantId,
    to: ctx.ticket.requesterEmail,
    key: "ticket_resolved",
    link: `/tickets/${ticketId}`,
    vars: {
      reference: ctx.ticket.reference,
      subject: ctx.ticket.subject,
      requester_name: ctx.ticket.requesterEmail,
      resolution_clause: resolutionNotes?.trim() ? `Resolution: ${resolutionNotes.trim()}\n` : "",
    },
  });
  return updated;
}

export async function agentClose(ticketId: string, agent: Actor): Promise<TicketRow | null> {
  const ctx = await tenantOf(ticketId);
  if (!ctx) return null;
  const updated = await mutateTicket(
    ticketId,
    { status: "closed", resolvedAt: ctx.ticket.resolvedAt ?? now() },
    { type: "closed", message: `${agent.name} closed the ticket.` }
  );
  await appendAudit({
    tenantId: ctx.tenantId,
    actor: `agent:${agent.name}`,
    action: "ticket.closed.manual",
    ticketId,
    payload: {},
  });
  await notifyTemplate({
    tenantId: ctx.tenantId,
    to: ctx.ticket.requesterEmail,
    key: "ticket_closed",
    link: `/tickets/${ticketId}`,
    vars: {
      reference: ctx.ticket.reference,
      subject: ctx.ticket.subject,
      requester_name: ctx.ticket.requesterEmail,
    },
  });
  return updated;
}

export async function reopenTicket(ticketId: string, actor: Actor): Promise<TicketRow | null> {
  const ctx = await tenantOf(ticketId);
  if (!ctx) return null;
  const updated = await mutateTicket(
    ticketId,
    { status: "reopened", resolvedAt: null },
    { type: "reopened", message: `${actor.name} reopened the ticket.` }
  );
  await appendAudit({
    tenantId: ctx.tenantId,
    actor: actor.role === "requester" ? `requester:${actor.name}` : `agent:${actor.name}`,
    action: "ticket.reopened.manual",
    ticketId,
    payload: {},
  });
  if (ctx.ticket.assigneeId) {
    const store = await getStore();
    const assignee = await store.users.get(ctx.ticket.assigneeId);
    if (assignee) {
      await notifyTemplate({
        tenantId: ctx.tenantId,
        to: assignee.email,
        key: "ticket_reopened",
        link: `/tickets/${ticketId}`,
        vars: { reference: ctx.ticket.reference, subject: ctx.ticket.subject, actor_name: actor.name },
      });
    }
  }
  return updated;
}

export async function assignTicket(
  ticketId: string,
  assigneeId: string | null,
  by: Actor,
  assignmentGroupId?: string | null
): Promise<TicketRow | null> {
  const ctx = await tenantOf(ticketId);
  if (!ctx) return null;
  const store = await getStore();

  let assigneeName = "Unassigned";
  let assigneeEmail: string | null = null;
  if (assigneeId) {
    const user = await store.users.get(assigneeId);
    assigneeName = user?.name ?? assigneeId;
    assigneeEmail = user?.email ?? null;
  }

  const patch: Partial<TicketRow> = { assigneeId };
  let groupClause = "";
  if (assignmentGroupId !== undefined) {
    patch.assignmentGroupId = assignmentGroupId;
    if (assignmentGroupId) {
      const group = await store.groups.get(assignmentGroupId);
      if (group) groupClause = ` in the ${group.name} group`;
    }
  }

  const updated = await mutateTicket(ticketId, patch, {
    type: "assigned",
    message: assigneeId
      ? `${by.name} assigned the ticket to ${assigneeName}${groupClause}.`
      : `${by.name} unassigned the ticket.`,
  });
  await appendAudit({
    tenantId: ctx.tenantId,
    actor: `agent:${by.name}`,
    action: "ticket.assigned",
    ticketId,
    payload: { assignee: assigneeId ?? null, group: patch.assignmentGroupId ?? ctx.ticket.assignmentGroupId ?? null },
  });
  if (assigneeEmail) {
    await notifyTemplate({
      tenantId: ctx.tenantId,
      to: assigneeEmail,
      key: "ticket_assigned",
      link: `/tickets/${ticketId}`,
      vars: {
        reference: ctx.ticket.reference,
        subject: ctx.ticket.subject,
        assignee_name: assigneeName,
        priority: priorityCode(ctx.ticket.priority),
        group_clause: groupClause,
      },
    });
  }
  return updated;
}

export interface TicketFieldPatch {
  priority?: TicketPriority;
  /** Required when manually overriding the derived priority. */
  priorityJustification?: string;
  impact?: ImpactLevel;
  urgency?: ImpactLevel;
  category?: TicketCategory;
  subcategory?: string | null;
  tags?: string[];
  status?: TicketRow["status"];
  assignmentGroupId?: string | null;
  resolutionNotes?: string | null;
  ciIds?: string[];
  /** Per-tenant custom field values (shallow-merged into the existing bag). */
  customFields?: Record<string, unknown>;
}

export async function updateTicketFields(
  ticketId: string,
  patch: TicketFieldPatch,
  by: Actor
): Promise<TicketRow | null> {
  const ctx = await tenantOf(ticketId);
  if (!ctx) return null;
  const { priorityJustification, ...fields } = patch;
  const next: Partial<TicketRow> = { ...fields };
  const changes: string[] = [];

  // ITIL: impact/urgency edits recompute the priority via the matrix; an
  // explicit priority in the same patch is a manual override and wins.
  const impact = patch.impact ?? ctx.ticket.impact;
  const urgency = patch.urgency ?? ctx.ticket.urgency;
  if ((patch.impact || patch.urgency) && !patch.priority && impact && urgency) {
    next.priority = derivePriority(impact, urgency);
  }

  if (patch.impact && patch.impact !== ctx.ticket.impact) changes.push(`impact -> ${patch.impact}`);
  if (patch.urgency && patch.urgency !== ctx.ticket.urgency) changes.push(`urgency -> ${patch.urgency}`);
  if (next.priority && next.priority !== ctx.ticket.priority) changes.push(`priority -> ${next.priority}`);
  if (patch.category && patch.category !== ctx.ticket.category) changes.push(`category -> ${patch.category}`);
  if (patch.subcategory !== undefined && patch.subcategory !== ctx.ticket.subcategory)
    changes.push(`subcategory -> ${patch.subcategory ?? "none"}`);
  if (patch.status && patch.status !== ctx.ticket.status) changes.push(`status -> ${patch.status}`);
  if (patch.assignmentGroupId !== undefined && patch.assignmentGroupId !== ctx.ticket.assignmentGroupId)
    changes.push("assignment group updated");
  if (patch.resolutionNotes !== undefined) changes.push("resolution notes updated");
  if (patch.ciIds) changes.push("linked CIs updated");
  if (patch.tags) changes.push("tags updated");
  if (patch.customFields) {
    // Shallow-merge into the existing bag so one field edit can't blank others.
    next.customFields = { ...(ctx.ticket.customFields ?? {}), ...patch.customFields };
    changes.push("custom fields updated");
  }
  if (changes.length === 0) return ctx.ticket;

  const manualPriorityOverride =
    !!patch.priority &&
    patch.priority !== ctx.ticket.priority &&
    !!ctx.ticket.impact &&
    !!ctx.ticket.urgency &&
    patch.priority !== derivePriority(impact, urgency);

  const updated = await mutateTicket(ticketId, next, {
    type: "agent_action",
    message: `${by.name} updated ${changes.join(", ")}.`,
  });
  await appendAudit({
    tenantId: ctx.tenantId,
    actor: `agent:${by.name}`,
    action: manualPriorityOverride ? "ticket.priority.overridden" : "ticket.updated",
    ticketId,
    payload: manualPriorityOverride
      ? {
          changes,
          derived: derivePriority(impact, urgency),
          override: patch.priority,
          justification: priorityJustification ?? "(none given)",
        }
      : { changes },
  });

  // Requester-facing "waiting on you" notice when an agent parks the ticket.
  if (patch.status === "pending" && ctx.ticket.status !== "pending") {
    await notifyTemplate({
      tenantId: ctx.tenantId,
      to: ctx.ticket.requesterEmail,
      key: "ticket_pending",
      link: `/tickets/${ticketId}`,
      vars: {
        reference: ctx.ticket.reference,
        subject: ctx.ticket.subject,
        requester_name: ctx.ticket.requesterEmail,
      },
    });
  }
  return updated;
}

export async function requesterReply(ticketId: string, requester: Actor, body: string): Promise<TicketRow | null> {
  const ctx = await tenantOf(ticketId);
  if (!ctx || !body.trim()) return null;
  const wasResolved = ["closed", "auto_resolved", "resolved"].includes(ctx.ticket.status);

  await addMessage(ticketId, {
    authorKind: "requester",
    authorName: requester.name,
    visibility: "public",
    body,
  });

  const patch: Partial<TicketRow> = {};
  if (wasResolved) {
    patch.status = "reopened";
    patch.resolvedAt = null;
  } else if (ctx.ticket.status === "pending") {
    // A requester reply un-parks the ticket (and resumes the SLA clock) unless
    // it is being held for an approval decision.
    const store = await getStore();
    const approvals = await store.approvals.list({ ticketId });
    const heldForApproval = approvals.some((a) => a.state === "pending");
    if (!heldForApproval) patch.status = "in_progress";
  }
  const updated = await mutateTicket(ticketId, patch, {
    type: wasResolved ? "reopened" : "reply_sent",
    message: wasResolved ? `${requester.name} replied and reopened the ticket.` : `${requester.name} added a reply.`,
  });
  await appendAudit({
    tenantId: ctx.tenantId,
    actor: `requester:${requester.name}`,
    action: wasResolved ? "ticket.reopened.manual" : "ticket.reply.public",
    ticketId,
    payload: { chars: body.trim().length },
  });
  return updated;
}

export async function submitFeedback(
  ticketId: string,
  satisfaction: "satisfied" | "unsatisfied",
  comment?: string
): Promise<TicketRow | null> {
  const ctx = await tenantOf(ticketId);
  if (!ctx) return null;
  const satisfied = satisfaction === "satisfied";
  const updated = await mutateTicket(
    ticketId,
    { satisfaction, status: satisfied ? "closed" : "reopened", resolvedAt: satisfied ? ctx.ticket.resolvedAt ?? now() : null },
    {
      type: satisfied ? "feedback" : "reopened",
      message: satisfied
        ? "Requester confirmed the resolution solved their issue."
        : "Requester was unsatisfied; ticket reopened for an agent.",
      meta: { comment: comment ?? null },
    }
  );
  await appendAudit({
    tenantId: ctx.tenantId,
    actor: `requester:${ctx.ticket.requesterEmail}`,
    action: satisfied ? "ticket.feedback.satisfied" : "ticket.feedback.unsatisfied",
    ticketId,
    payload: { comment: comment ?? null },
  });
  return updated;
}

// --------------------------------------------------------------- link & merge

/** Symmetrically relate two tickets (records the link on both). */
export async function linkTickets(aId: string, bId: string, by: Actor): Promise<TicketRow | null> {
  if (aId === bId) return null;
  const [a, b] = [await getTicket(aId), await getTicket(bId)];
  if (!a || !b || a.tenantId !== b.tenantId) return null;

  await mutateTicket(
    bId,
    { linkedTicketIds: [...new Set([...(b.linkedTicketIds ?? []), aId])] },
    { type: "linked", message: `${by.name} linked ${a.reference}.` }
  );
  const updated = await mutateTicket(
    aId,
    { linkedTicketIds: [...new Set([...(a.linkedTicketIds ?? []), bId])] },
    { type: "linked", message: `${by.name} linked ${b.reference}.` }
  );
  await appendAudit({
    tenantId: a.tenantId,
    actor: `agent:${by.name}`,
    action: "ticket.linked",
    ticketId: aId,
    payload: { linked: bId, reference: b.reference },
  });
  return updated;
}

/** Remove a symmetric link between two tickets. */
export async function unlinkTickets(aId: string, bId: string, by: Actor): Promise<TicketRow | null> {
  const [a, b] = [await getTicket(aId), await getTicket(bId)];
  if (!a || !b) return null;

  await mutateTicket(
    bId,
    { linkedTicketIds: (b.linkedTicketIds ?? []).filter((x) => x !== aId) },
    { type: "unlinked", message: `${by.name} unlinked ${a.reference}.` }
  );
  const updated = await mutateTicket(
    aId,
    { linkedTicketIds: (a.linkedTicketIds ?? []).filter((x) => x !== bId) },
    { type: "unlinked", message: `${by.name} unlinked ${b.reference}.` }
  );
  await appendAudit({
    tenantId: a.tenantId,
    actor: `agent:${by.name}`,
    action: "ticket.unlinked",
    ticketId: aId,
    payload: { unlinked: bId },
  });
  return updated;
}

/**
 * Merge a duplicate ticket into a target: re-parent the source's messages onto
 * the target, cancel the source (stamping mergedIntoId), and link them. Non-
 * destructive and fully audited; the source stays queryable as a merged record.
 */
export async function mergeTicket(sourceId: string, targetId: string, by: Actor): Promise<TicketRow | null> {
  if (sourceId === targetId) return null;
  const [source, target] = [await getTicket(sourceId), await getTicket(targetId)];
  if (!source || !target || source.tenantId !== target.tenantId) return null;
  if (source.mergedIntoId) return null; // already merged elsewhere

  const store = await getStore();
  // Consolidate the conversation onto the target.
  const msgs = await store.messages.list({ ticketId: sourceId });
  for (const m of msgs) await store.messages.update(m.id, { ticketId: targetId });

  await addMessage(targetId, {
    authorKind: "system",
    authorName: "System",
    visibility: "internal",
    body: `Merged ${source.reference} — "${source.subject}" (from ${source.requesterEmail}) into this ticket.`,
  });

  await mutateTicket(
    targetId,
    { linkedTicketIds: [...new Set([...(target.linkedTicketIds ?? []), sourceId])] },
    { type: "merge_target", message: `${by.name} merged ${source.reference} into this ticket.` }
  );

  const updated = await mutateTicket(
    sourceId,
    {
      status: "cancelled",
      mergedIntoId: targetId,
      linkedTicketIds: [...new Set([...(source.linkedTicketIds ?? []), targetId])],
    },
    { type: "merged", message: `${by.name} merged this ticket into ${target.reference}.` }
  );

  await appendAudit({
    tenantId: source.tenantId,
    actor: `agent:${by.name}`,
    action: "ticket.merged",
    ticketId: sourceId,
    payload: { into: targetId, reference: target.reference, messagesMoved: msgs.length },
  });
  return updated;
}

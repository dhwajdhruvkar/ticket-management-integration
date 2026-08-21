// =============================================================================
// Assignment groups (support teams / queues).
//
// Groups own a set of categories: on intake a ticket is routed to the first
// group whose categories include the ticket's category (automation rules can
// override afterwards). Members are referenced by user id.
//
// Auto-assignment strategies (group.strategy):
//   manual       — route to the group only (an agent picks it up)   [default]
//   round_robin  — rotate through active members (lastAssignedIndex cursor)
//   least_loaded — member with the fewest open assigned tickets
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { pageCollection, type ListOptions, type PageResult } from "../data/store";
import { newId, now } from "../domain/ids";
import { notifyTemplate } from "../notify/templates";
import { priorityCode } from "../domain/priority";
import { listActiveTickets, mutateTicket } from "./ticketService";
import type {
  AssignmentGroupRow,
  AssignmentStrategy,
  TicketCategory,
  TicketRow,
  UserRow,
} from "../domain/models";

const UNSOLVED = ["new", "open", "in_progress", "pending", "pending_agent", "escalated", "reopened"];

export async function listGroups(
  tenantId: string,
  options: ListOptions<AssignmentGroupRow> = { orderBy: { field: "name", dir: "asc" } }
): Promise<PageResult<AssignmentGroupRow>> {
  const store = await getStore();
  return pageCollection(store.groups, { tenantId }, options);
}

export async function createGroup(
  tenantId: string,
  input: {
    name: string;
    description?: string;
    memberIds?: string[];
    categories?: TicketCategory[];
    leadId?: string;
  },
  actor = "system"
): Promise<AssignmentGroupRow> {
  const store = await getStore();
  const group: AssignmentGroupRow = {
    id: newId("grp"),
    tenantId,
    name: input.name.trim(),
    description: input.description?.trim() ?? null,
    memberIds: input.memberIds ?? [],
    categories: input.categories ?? [],
    leadId: input.leadId ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.groups.create(group);
  await appendAudit({
    tenantId,
    actor,
    action: "group.created",
    payload: { name: group.name, categories: group.categories },
  });
  return group;
}

export async function updateGroup(
  id: string,
  patch: Partial<
    Pick<
      AssignmentGroupRow,
      "name" | "description" | "memberIds" | "categories" | "leadId" | "strategy"
    >
  >,
  actor = "system"
): Promise<AssignmentGroupRow | null> {
  const store = await getStore();
  const before = await store.groups.get(id);
  if (!before) return null;

  // Membership is by user id, so filter out anyone outside this tenant before
  // they end up in a routing rotation they cannot act on.
  const next = { ...patch };
  if (next.memberIds) {
    const tenantUsers = await store.users.list({ tenantId: before.tenantId });
    const known = new Set(tenantUsers.map((u) => u.id));
    next.memberIds = next.memberIds.filter((memberId) => known.has(memberId));
  }
  if (next.leadId && !next.memberIds) {
    const lead = await store.users.get(next.leadId);
    if (!lead || lead.tenantId !== before.tenantId) next.leadId = null;
  }

  const updated = await store.groups.update(id, { ...next, updatedAt: now() });
  if (updated) {
    const membersChanged =
      next.memberIds && JSON.stringify(next.memberIds) !== JSON.stringify(before.memberIds);
    const strategyChanged = next.strategy && next.strategy !== (before.strategy ?? "manual");
    if (membersChanged || strategyChanged) {
      await appendAudit({
        tenantId: updated.tenantId,
        actor,
        action: "group.updated",
        payload: {
          name: updated.name,
          ...(strategyChanged ? { strategy: next.strategy } : {}),
          ...(membersChanged ? { members: next.memberIds!.length } : {}),
        },
      });
    }
  }
  return updated;
}

/** Pick the next assignee for a group according to its strategy. Pure logic. */
export function pickAssignee(
  strategy: AssignmentStrategy,
  members: UserRow[],
  lastAssignedIndex: number,
  openCounts: Map<string, number>
): { userId: string; nextIndex: number } | null {
  const active = members.filter((m) => m.active);
  if (active.length === 0) return null;

  if (strategy === "round_robin") {
    const nextIndex = (lastAssignedIndex + 1) % active.length;
    return { userId: active[nextIndex].id, nextIndex };
  }
  if (strategy === "least_loaded") {
    let best = active[0];
    for (const m of active) {
      if ((openCounts.get(m.id) ?? 0) < (openCounts.get(best.id) ?? 0)) best = m;
    }
    return { userId: best.id, nextIndex: lastAssignedIndex };
  }
  return null;
}

/**
 * Pick who should take over a ticket its current owner is not progressing:
 * the least-loaded member who is active and available for dispatch, never the
 * person already holding it. Ties break on name so the choice is stable.
 */
export function pickReassignee(
  members: UserRow[],
  openCounts: Map<string, number>,
  currentAssigneeId?: string | null
): UserRow | null {
  const candidates = members.filter(
    (m) => m.active && m.available !== false && m.id !== currentAssigneeId
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, m) => {
    const load = openCounts.get(m.id) ?? 0;
    const bestLoad = openCounts.get(best.id) ?? 0;
    if (load !== bestLoad) return load < bestLoad ? m : best;
    return m.name.localeCompare(best.name) < 0 ? m : best;
  });
}

/**
 * Hand a ticket to someone else — backs the "reassign" automation action, so a
 * breached SLA can move the work instead of only flagging it.
 *
 * Candidates come from the ticket's assignment group, or the group owning its
 * category when it has none. If that pool is exhausted (everyone away, or the
 * current assignee is the only member) it widens to every agent in the tenant,
 * because an escalated ticket with nobody left to take it just breaches again.
 */
export async function reassignToLeastLoaded(
  ticket: TicketRow,
  actor = "automation"
): Promise<TicketRow | null> {
  const store = await getStore();
  const [users, groups, tickets] = await Promise.all([
    store.users.list({ tenantId: ticket.tenantId }),
    store.groups.list({ tenantId: ticket.tenantId }),
    listActiveTickets(ticket.tenantId),
  ]);

  const group =
    groups.find((g) => g.id === ticket.assignmentGroupId) ??
    groups.find((g) => (g.categories ?? []).includes(ticket.category));

  const byId = new Map(users.map((u) => [u.id, u]));
  const groupPool = (group?.memberIds ?? [])
    .map((id) => byId.get(id))
    .filter((u): u is UserRow => !!u);
  const tenantPool = users.filter((u) => u.role !== "requester");

  const openCounts = new Map<string, number>();
  for (const t of tickets) {
    if (t.assigneeId && UNSOLVED.includes(t.status)) {
      openCounts.set(t.assigneeId, (openCounts.get(t.assigneeId) ?? 0) + 1);
    }
  }

  const next =
    pickReassignee(groupPool, openCounts, ticket.assigneeId) ??
    pickReassignee(tenantPool, openCounts, ticket.assigneeId);
  if (!next) return null;

  const previous = ticket.assigneeId ? byId.get(ticket.assigneeId) : null;
  const load = openCounts.get(next.id) ?? 0;

  const patch: Partial<TicketRow> = { assigneeId: next.id };
  if (group && group.id !== ticket.assignmentGroupId) patch.assignmentGroupId = group.id;
  // A new owner is the answer to an escalation: back to the active queue, off
  // the dispatcher's board. The reason stays as context for the new owner.
  if (ticket.status === "escalated") patch.status = "in_progress";

  const updated = await mutateTicket(ticket.id, patch, {
    type: "assigned",
    message: previous
      ? `Reassigned from ${previous.name} to ${next.name} (least loaded, ${load} open).`
      : `Assigned to ${next.name} (least loaded, ${load} open).`,
  });
  await appendAudit({
    tenantId: ticket.tenantId,
    actor,
    action: "ticket.reassigned",
    ticketId: ticket.id,
    payload: {
      from: previous?.name ?? null,
      to: next.name,
      openCount: load,
      ...(group ? { group: group.name } : {}),
    },
  });
  await notifyTemplate({
    tenantId: ticket.tenantId,
    to: next.email,
    key: "ticket_assigned",
    link: `/tickets/${ticket.id}`,
    vars: {
      reference: ticket.reference,
      subject: ticket.subject,
      assignee_name: next.name,
      priority: priorityCode(ticket.priority),
      group_clause: group ? ` via the ${group.name} group` : "",
    },
  });
  return updated;
}

/**
 * Category-based routing: route to the first matching group, then auto-assign
 * an individual member when the group's strategy calls for it.
 */
export async function routeTicketToGroup(ticket: TicketRow): Promise<TicketRow | null> {
  if (ticket.assignmentGroupId) return null; // already routed
  const store = await getStore();
  const groups = await store.groups.list({ tenantId: ticket.tenantId });
  // Defensive: rows persisted by older schema versions may miss array fields.
  const match = groups.find((g) => (g.categories ?? []).includes(ticket.category));
  if (!match) return null;

  const updated = await mutateTicket(
    ticket.id,
    { assignmentGroupId: match.id },
    { type: "assigned", message: `Routed to the ${match.name} group (category ${ticket.category}).` }
  );
  await appendAudit({
    tenantId: ticket.tenantId,
    actor: "router",
    action: "ticket.routed",
    ticketId: ticket.id,
    payload: { group: match.name, category: ticket.category },
  });

  const strategy = (match.strategy ?? "manual") as AssignmentStrategy;
  if (strategy === "manual" || ticket.assigneeId || match.memberIds.length === 0) return updated;

  // Resolve members + open workloads for the strategy decision.
  const users = await store.users.list({ tenantId: ticket.tenantId });
  const members = match.memberIds
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is UserRow => !!u);
  const openCounts = new Map<string, number>();
  if (strategy === "least_loaded") {
    const tickets = await listActiveTickets(ticket.tenantId);
    for (const t of tickets) {
      if (t.assigneeId && UNSOLVED.includes(t.status)) {
        openCounts.set(t.assigneeId, (openCounts.get(t.assigneeId) ?? 0) + 1);
      }
    }
  }

  const pick = pickAssignee(strategy, members, match.lastAssignedIndex ?? 0, openCounts);
  if (!pick) return updated;

  const assignee = users.find((u) => u.id === pick.userId);
  if (strategy === "round_robin") {
    await store.groups.update(match.id, { lastAssignedIndex: pick.nextIndex, updatedAt: now() });
  }

  const assigned = await mutateTicket(
    ticket.id,
    { assigneeId: pick.userId },
    {
      type: "assigned",
      message: `Auto-assigned to ${assignee?.name ?? "an agent"} (${strategy.replace("_", " ")}).`,
    }
  );
  await appendAudit({
    tenantId: ticket.tenantId,
    actor: "router",
    action: "ticket.auto_assigned",
    ticketId: ticket.id,
    payload: { group: match.name, strategy, assignee: assignee?.name ?? pick.userId },
  });
  if (assignee) {
    await notifyTemplate({
      tenantId: ticket.tenantId,
      to: assignee.email,
      key: "ticket_assigned",
      link: `/tickets/${ticket.id}`,
      vars: {
        reference: ticket.reference,
        subject: ticket.subject,
        assignee_name: assignee.name,
        priority: priorityCode(ticket.priority),
        group_clause: ` via the ${match.name} group`,
      },
    });
  }
  return assigned ?? updated;
}

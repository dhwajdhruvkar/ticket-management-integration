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
import { newId, now } from "../domain/ids";
import { notifyTemplate } from "../notify/templates";
import { priorityCode } from "../domain/priority";
import { mutateTicket } from "./ticketService";
import type {
  AssignmentGroupRow,
  AssignmentStrategy,
  TicketCategory,
  TicketRow,
  UserRow,
} from "../domain/models";

const UNSOLVED = ["new", "open", "in_progress", "pending", "pending_agent", "escalated", "reopened"];

export async function listGroups(tenantId: string): Promise<AssignmentGroupRow[]> {
  const store = await getStore();
  return (await store.groups.list({ tenantId })).sort((a, b) => a.name.localeCompare(b.name));
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
  const updated = await store.groups.update(id, { ...patch, updatedAt: now() });
  if (before && updated) {
    const membersChanged =
      patch.memberIds && JSON.stringify(patch.memberIds) !== JSON.stringify(before.memberIds);
    const strategyChanged = patch.strategy && patch.strategy !== (before.strategy ?? "manual");
    if (membersChanged || strategyChanged) {
      await appendAudit({
        tenantId: updated.tenantId,
        actor,
        action: "group.updated",
        payload: {
          name: updated.name,
          ...(strategyChanged ? { strategy: patch.strategy } : {}),
          ...(membersChanged ? { members: patch.memberIds!.length } : {}),
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
    const tickets = await store.tickets.list({ tenantId: ticket.tenantId });
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

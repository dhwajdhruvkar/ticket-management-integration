// =============================================================================
// Triage board (dispatcher queue).
//
// Aggregates everything a dispatcher needs on one call: the unassigned open
// ticket queue, the tickets an agent escalated because they could not resolve
// them, and every agent's live open-ticket load + availability + group
// memberships. The UI uses group memberships to show "specialists" for a
// ticket's category vs. the generalist "common" handlers.
// =============================================================================

import { getStore } from "../data";
import { assignTicket, type Actor } from "./agentActions";
import { reassignToLeastLoaded } from "./groupService";
import { getTicket, listActiveTickets } from "./ticketService";
import type { AssignmentGroupRow, TicketRow } from "../domain/models";

const OPEN = ["new", "open", "in_progress", "pending", "pending_agent", "escalated", "reopened"];
const PRIORITY_ORDER = ["critical", "high", "medium", "low", "very_low"];

export interface TriageAgent {
  id: string;
  name: string;
  initials: string;
  role: string;
  available: boolean;
  /** Live count of open tickets currently assigned to this agent. */
  openCount: number;
  /** Assignment groups this agent is a member of. */
  groupIds: string[];
}

export interface TriageBoard {
  queue: TicketRow[];
  /**
   * Escalated tickets, assigned or not: the point of the lane is that the
   * current owner has given up on them, so filtering on assignee would hide
   * exactly the ones needing a dispatcher.
   */
  escalations: TicketRow[];
  agents: TriageAgent[];
  groups: AssignmentGroupRow[];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "·";
}

export async function getTriageBoard(tenantId: string): Promise<TriageBoard> {
  const store = await getStore();
  const [tickets, users, groups] = await Promise.all([
    listActiveTickets(tenantId),
    store.users.list({ tenantId }),
    store.groups.list({ tenantId }),
  ]);

  // Live open-ticket load per assignee.
  const openCounts = new Map<string, number>();
  for (const t of tickets) {
    if (t.assigneeId && OPEN.includes(t.status)) {
      openCounts.set(t.assigneeId, (openCounts.get(t.assigneeId) ?? 0) + 1);
    }
  }

  const agents: TriageAgent[] = users
    .filter((u) => u.role !== "requester")
    .map((u) => ({
      id: u.id,
      name: u.name,
      initials: u.initials ?? initialsOf(u.name),
      role: u.role,
      available: u.available !== false,
      openCount: openCounts.get(u.id) ?? 0,
      groupIds: groups.filter((g) => (g.memberIds ?? []).includes(u.id)).map((g) => g.id),
    }))
    .sort((a, b) => a.openCount - b.openCount || a.name.localeCompare(b.name));

  const byUrgency = (a: TicketRow, b: TicketRow) =>
    PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

  // Unassigned + open tickets, worst priority and oldest first.
  const queue = tickets.filter((t) => !t.assigneeId && OPEN.includes(t.status)).sort(byUrgency);
  const escalations = tickets.filter((t) => t.status === "escalated").sort(byUrgency);

  return { queue, escalations, agents, groups };
}

/** Largest batch one request may move, so a runaway client cannot walk the tenant. */
export const MAX_BULK_ASSIGN = 100;

export interface BulkAssignResult {
  assigned: { ticketId: string; assigneeId: string | null }[];
  skipped: { ticketId: string; reason: string }[];
}

/**
 * Clear a stretch of the dispatcher queue in one go.
 *
 * With `assigneeId` every ticket goes to that person; without it each ticket is
 * routed to its own best fit (least-loaded available member of the group owning
 * its category). Unknown ids are reported as skipped rather than failing the
 * batch: one stale row from a board loaded a minute ago should not void the
 * other forty.
 */
export async function bulkAssignTickets(
  tenantId: string,
  ticketIds: string[],
  by: Actor,
  assigneeId?: string | null
): Promise<BulkAssignResult> {
  const result: BulkAssignResult = { assigned: [], skipped: [] };

  for (const ticketId of ticketIds) {
    const ticket = await getTicket(ticketId, tenantId);
    if (!ticket) {
      result.skipped.push({ ticketId, reason: "Not found." });
      continue;
    }

    const updated = assigneeId
      ? await assignTicket(ticketId, assigneeId, by, ticket.assignmentGroupId)
      : await reassignToLeastLoaded(ticket, `dispatcher:${by.name}`);

    if (updated) result.assigned.push({ ticketId, assigneeId: updated.assigneeId ?? null });
    else result.skipped.push({ ticketId, reason: "No eligible agent available." });
  }
  return result;
}

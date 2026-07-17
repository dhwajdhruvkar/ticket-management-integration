// =============================================================================
// Triage board (dispatcher queue).
//
// Aggregates everything a dispatcher needs on one call: the unassigned open
// ticket queue, and every agent's live open-ticket load + availability + group
// memberships. The UI uses group memberships to show "specialists" for a
// ticket's category vs. the generalist "common" handlers.
// =============================================================================

import { getStore } from "../data";
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
    store.tickets.list({ tenantId }),
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

  // Unassigned + open tickets, worst priority and oldest first.
  const queue = tickets
    .filter((t) => !t.assigneeId && OPEN.includes(t.status))
    .sort(
      (a, b) =>
        PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

  return { queue, agents, groups };
}

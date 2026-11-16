// Shared deterministic ticket fixture for the SQL parity suites.
import type { TicketRow } from "@/server/domain/models";

export const FIXED_NOW = new Date("2026-10-01T12:00:00.000Z");

const STATUSES = ["new", "open", "in_progress", "pending", "auto_resolved", "pending_agent", "escalated", "resolved", "reopened", "closed", "cancelled"] as const;
const PRIORITIES = ["critical", "high", "medium", "low", "very_low"] as const;
const CATEGORIES = ["IT", "HR", "Access", "Software", "Hardware", "Network", "Billing", "Other"] as const;

/** Tickets whose deadlines straddle `now` (past, future, exactly now, 80% and 90% elapsed). */
export function buildFixture(now: Date = FIXED_NOW): TicketRow[] {
  const ms = (offsetMin: number) => new Date(now.getTime() + offsetMin * 60_000).toISOString();
  const WORKFLOWS: (Record<string, unknown> | null)[] = [
    null, { phase: "department" }, { phase: "in_progress" }, { phase: "awaiting_acceptance", managerEscalatedAt: ms(-5) },
    { phase: "department", rmEscalatedAt: "" }, { phase: "department", resolutionEscalatedAt: ms(-1) },
  ];
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % n; };
  const rows: Partial<TicketRow>[] = [];
  for (let i = 0; i < 90; i++) {
    const created = -600 - rnd(5000);
    const dueKind = rnd(9);
    const due = dueKind === 0 ? null : dueKind === 1 ? ms(-30) : dueKind === 2 ? ms(0) : dueKind === 3 ? ms(500) : dueKind === 4 ? ms(created + (0 - created) * 1.25) : dueKind === 6 ? ms(created + (0 - created) * 1.1) : dueKind === 7 ? ms(created + (0 - created) * 2) : ms(created);
    const status = STATUSES[rnd(STATUSES.length)];
    const solved = ["resolved", "closed", "auto_resolved"].includes(status);
    rows.push({
      id: `t${String(i).padStart(3, "0")}`, reference: `NL-${1000 + i}`, tenantId: i % 9 === 0 ? "other" : "org",
      subject: ["Printer jam", "VPN down", "Reset password", "50% slower_login"][rnd(4)], requesterEmail: ["a@x.com", "B@x.com", "c@y.com"][rnd(3)],
      status, priority: PRIORITIES[rnd(5)], category: CATEGORIES[rnd(8)], type: "incident",
      assigneeId: [null, "u1", "u2", ""][rnd(4)] as string | null, assignmentGroupId: [null, "g1", "g2"][rnd(3)],
      createdAt: ms(created), updatedAt: ms(-(rnd(40) * 10)),
      dueResponseAt: due, dueResolveAt: rnd(2) ? due : ms(-rnd(100)),
      firstRespondedAt: rnd(3) === 0 ? ms(created + 5) : null,
      resolvedAt: solved ? ms(created + rnd(900)) : rnd(15) === 0 ? ms(-3) : null,
      slaPausedAt: rnd(8) === 0 ? ms(-20) : null, slaPausedMins: 0, workflowVersion: 0,
      workflow: WORKFLOWS[rnd(WORKFLOWS.length)] as TicketRow["workflow"],
      deletedAt: i % 11 === 0 ? ms(-10) : null,
    });
  }
  return rows as TicketRow[];
}

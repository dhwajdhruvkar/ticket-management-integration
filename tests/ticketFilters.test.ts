import { describe, expect, it } from "vitest";
import { applyTicketFilters, filtersFromParams, slaStateOf } from "@/lib/ticketFilters";
import type { TicketRow } from "@/server/domain/models";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");

function ticket(overrides: Record<string, unknown> = {}): TicketRow {
  return {
    id: "t", tenantId: "org", status: "open", priority: "medium", category: "Network", createdAt: "2026-10-01T00:00:00.000Z",
    assigneeId: null, assignmentGroupId: null, resolvedAt: null, dueResolveAt: null, dueResponseAt: null, firstRespondedAt: null,
    slaPausedAt: null, workflow: undefined, ...overrides,
  } as unknown as TicketRow;
}

describe("applyTicketFilters", () => {
  const a = ticket({ id: "a", priority: "critical", assignmentGroupId: "g1", assigneeId: "u1", category: "Network" });
  const b = ticket({ id: "b", priority: "low", assignmentGroupId: "g2", assigneeId: null, category: "IT" });
  const all = [a, b];

  it("filters by priority, technical group, assignee and category", () => {
    expect(applyTicketFilters(all, { priority: "critical" }, NOW)).toEqual([a]);
    expect(applyTicketFilters(all, { groupId: "g2" }, NOW)).toEqual([b]);
    expect(applyTicketFilters(all, { assigneeId: "u1" }, NOW)).toEqual([a]);
    expect(applyTicketFilters(all, { category: "IT" }, NOW)).toEqual([b]);
    expect(applyTicketFilters(all, { priority: "critical", category: "IT" }, NOW)).toEqual([]);
  });

  it("treats assigneeId 'unassigned' as no assignee, and 'assigned' as any assignee", () => {
    expect(applyTicketFilters(all, { assigneeId: "unassigned" }, NOW)).toEqual([b]);
    expect(applyTicketFilters(all, { assigned: true }, NOW)).toEqual([a]);
  });

  it("matches the overdue filter only for open tickets past their resolution due time", () => {
    const pastDue = { firstRespondedAt: "2026-10-01T00:30:00.000Z", dueResolveAt: "2026-10-01T06:00:00.000Z" };
    const overdue = ticket({ id: "overdue", ...pastDue });
    const resolvedLate = ticket({ id: "late", ...pastDue, status: "resolved", resolvedAt: "2026-10-01T07:00:00.000Z" });
    const notDue = ticket({ id: "fine", firstRespondedAt: "2026-10-01T00:30:00.000Z", dueResolveAt: "2026-10-02T06:00:00.000Z" });
    const paused = ticket({ id: "paused", ...pastDue, slaPausedAt: "2026-10-01T05:00:00.000Z" });
    const result = applyTicketFilters([overdue, resolvedLate, notDue, paused], { overdue: true }, NOW);
    expect(result.map((row) => row.id)).toEqual(["overdue"]);
  });

  it("gives paused precedence over the timing state for unresolved tickets", () => {
    const paused = ticket({ slaPausedAt: "2026-10-01T05:00:00.000Z", firstRespondedAt: "2026-10-01T00:30:00.000Z", dueResolveAt: "2026-10-01T06:00:00.000Z" });
    expect(slaStateOf(paused, NOW)).toBe("paused");
    expect(applyTicketFilters([paused], { slaState: "paused" }, NOW)).toEqual([paused]);
    expect(applyTicketFilters([paused], { slaState: "breached" }, NOW)).toEqual([]);
  });

  it("classifies at-risk tickets at 80% of the window and met tickets as met", () => {
    const atRisk = ticket({ createdAt: "2026-10-01T00:00:00.000Z", firstRespondedAt: "2026-10-01T00:10:00.000Z", dueResolveAt: "2026-10-01T10:00:00.000Z" });
    expect(slaStateOf(atRisk, Date.parse("2026-10-01T09:00:00.000Z"))).toBe("at_risk");
    const met = ticket({ status: "resolved", resolvedAt: "2026-10-01T05:00:00.000Z", dueResolveAt: "2026-10-01T10:00:00.000Z" });
    expect(slaStateOf(met, NOW)).toBe("met");
  });

  it("treats escalation by status or by a workflow escalation marker", () => {
    const byStatus = ticket({ id: "status", status: "escalated" });
    const byMarker = ticket({ id: "marker", workflow: { phase: "department", managerEscalatedAt: "2026-10-01T06:00:00.000Z" } });
    const neither = ticket({ id: "neither" });
    expect(applyTicketFilters([byStatus, byMarker, neither], { escalated: true }, NOW).map((row) => row.id)).toEqual(["status", "marker"]);
  });

  it("filters by workflow phase", () => {
    const inDept = ticket({ id: "dept", workflow: { phase: "department" } });
    const awaiting = ticket({ id: "await", workflow: { phase: "awaiting_acceptance" } });
    expect(applyTicketFilters([inDept, awaiting], { phase: "department" }, NOW)).toEqual([inDept]);
  });
});

describe("filtersFromParams", () => {
  it("reads valid values and ignores unknown priority, SLA state and phase", () => {
    const parsed = filtersFromParams(new URLSearchParams("priority=bogus&sla=nope&phase=nope&overdue=1&escalated=1&assigned=1&group=g1&assignee=u1&category=IT"));
    expect(parsed).toEqual({ overdue: true, escalated: true, assigned: true, groupId: "g1", assigneeId: "u1", category: "IT" });
    expect(parsed).not.toHaveProperty("priority");
    expect(parsed).not.toHaveProperty("slaState");
    expect(parsed).not.toHaveProperty("phase");
  });

  it("accepts valid priority, SLA state and phase values", () => {
    expect(filtersFromParams(new URLSearchParams("priority=high&sla=breached&phase=department"))).toEqual({ priority: "high", slaState: "breached", phase: "department" });
  });
});

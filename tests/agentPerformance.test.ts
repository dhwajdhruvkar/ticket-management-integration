import { describe, expect, it } from "vitest";
import { buildResolutionSeries, defaultGranularity, performancePeriod, summarizeAgentPerformance } from "../src/server/services/agentPerformance";
import type { TicketRow, TicketEventRow, UserRow } from "../src/server/domain/models";

describe("date-filtered agent performance", () => {
  it("uses organization-local dates, inclusive end dates, and DST boundaries", () => {
    const india = performancePeriod("custom", "Asia/Kolkata", "2026-09-01", "2026-09-30");
    expect(india.startAt).toBe("2026-08-31T18:30:00.000Z");
    expect(india.endBefore).toBe("2026-09-30T18:30:00.000Z");
    const dst = performancePeriod("custom", "America/New_York", "2026-03-08", "2026-03-08");
    expect(Date.parse(dst.endBefore) - Date.parse(dst.startAt)).toBe(23 * 3600000);
    expect(() => performancePeriod("custom", "UTC", "2026-02-30", "2026-03-01")).toThrow();
    expect(() => performancePeriod("custom", "UTC", "2026-10-01", "2026-09-01")).toThrow();
  });
  it("provides Monday-based week, calendar month and calendar year", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    expect(performancePeriod("week", "UTC", undefined, undefined, now).from).toBe("2026-09-28");
    expect(performancePeriod("month", "UTC", undefined, undefined, now).to).toBe("2026-09-30");
    expect(performancePeriod("year", "UTC", undefined, undefined, now).from).toBe("2026-01-01");
  });
  it("attributes resolution events to actual resolvers, not current assignees; backlog stays live", () => {
    const period = performancePeriod("custom", "UTC", "2026-09-01", "2026-09-30");
    const users = [{ id: "a", tenantId: "org", name: "Alice", role: "agent", active: true }, { id: "b", tenantId: "org", name: "Bob", role: "agent", active: true }] as UserRow[];
    const tickets = [{ id: "t", tenantId: "org", assigneeId: "b", status: "reopened", createdAt: "2025-01-01" }, { id: "c", tenantId: "org", assigneeId: "a", status: "cancelled" }] as TicketRow[];
    const events = [{ id: "e", ticketId: "t", tenantId: "org", type: "resolution_recorded", resolverId: "a", createdAt: "2026-09-01T00:00:00.000Z" },
      { id: "x", ticketId: "c", tenantId: "other", type: "resolution_recorded", resolverId: "a", createdAt: "2026-09-02T00:00:00.000Z" }] as TicketEventRow[];
    const result = summarizeAgentPerformance("org", users, tickets, events, period);
    expect(result.find((row) => row.id === "a")).toMatchObject({ resolutions: 1, liveOpen: 0 });
    expect(result.find((row) => row.id === "b")).toMatchObject({ resolutions: 0, liveOpen: 1 });
  });
});

const users = [
  { id: "a", tenantId: "org", name: "Alice", role: "agent", active: true },
  { id: "b", tenantId: "org", name: "Bob", role: "agent", active: true },
] as UserRow[];
const resolution = (id: string, ticketId: string, resolverId: string, createdAt: string, tenantId = "org") =>
  ({ id, ticketId, tenantId, type: "resolution_recorded", resolverId, createdAt }) as TicketEventRow;
const ticket = (id: string, overrides: Partial<TicketRow> = {}) =>
  ({ id, tenantId: "org", status: "resolved", createdAt: "2026-09-01T10:00:00.000Z", assigneeId: "a", ...overrides }) as TicketRow;

describe("agent performance metrics", () => {
  it("counts today, week and month in the organization timezone, independent of the selected period", () => {
    const period = performancePeriod("custom", "Asia/Kolkata", "2026-09-01", "2026-09-30");
    const at = new Date("2026-10-01T06:00:00.000Z"); // 11:30 on 1 Oct in Kolkata
    const events = [
      resolution("e1", "t1", "a", "2026-09-30T20:00:00.000Z"), // 01:30 on 1 Oct locally: today, not in September
      resolution("e2", "t2", "a", "2026-09-30T10:00:00.000Z"), // 15:30 on 30 Sep locally: this week, not this month
    ];
    const [row] = summarizeAgentPerformance("org", users, [], events, period, { at });
    expect(row).toMatchObject({ id: "a", resolutions: 1, resolvedToday: 1, resolvedThisWeek: 2, resolvedThisMonth: 1 });
  });

  it("subtracts SLA pause time from average resolution and skips events whose ticket is missing", () => {
    const period = performancePeriod("custom", "UTC", "2026-09-01", "2026-09-30");
    const tickets = [ticket("t1", { slaPausedMins: 30 })];
    const events = [resolution("e1", "t1", "a", "2026-09-01T12:00:00.000Z"), resolution("e2", "gone", "a", "2026-09-02T12:00:00.000Z")];
    const [row] = summarizeAgentPerformance("org", users, tickets, events, period);
    expect(row.resolutions).toBe(2);
    expect(row.avgResolutionMins).toBe(90);
  });

  it("measures SLA compliance only for tickets with a resolution due time", () => {
    const period = performancePeriod("custom", "UTC", "2026-09-01", "2026-09-30");
    const tickets = [
      ticket("met", { dueResolveAt: "2026-09-02T00:00:00.000Z" }),
      ticket("late", { dueResolveAt: "2026-09-01T06:00:00.000Z" }),
      ticket("unmeasured"),
    ];
    const events = ["met", "late", "unmeasured"].map((id) => resolution(`e-${id}`, id, "a", "2026-09-01T12:00:00.000Z"));
    const [row] = summarizeAgentPerformance("org", users, tickets, events, period);
    expect(row).toMatchObject({ slaMet: 1, slaMeasured: 2, slaCompliance: 0.5 });
  });

  it("credits a reopen to the resolver of the preceding resolution, and ignores another tenant's reopen", () => {
    const period = performancePeriod("custom", "UTC", "2026-09-01", "2026-09-30");
    const tickets = [ticket("t1", { status: "reopened", assigneeId: "b" }), ticket("foreign", { tenantId: "other-org" })];
    const events = [resolution("e1", "t1", "a", "2026-09-05T00:00:00.000Z"), resolution("e2", "foreign", "a", "2026-09-05T00:00:00.000Z", "other-org")];
    const reopens = [
      { id: "r1", ticketId: "t1", type: "reopened", createdAt: "2026-09-10T00:00:00.000Z" },
      { id: "r2", ticketId: "foreign", type: "reopened", createdAt: "2026-09-10T00:00:00.000Z" },
    ] as TicketEventRow[];
    const result = summarizeAgentPerformance("org", users, tickets, events, period, { reopenEvents: reopens, at: new Date("2026-09-20T00:00:00.000Z") });
    expect(result.find((row) => row.id === "a")).toMatchObject({ reopened: 1 });
    expect(result.find((row) => row.id === "b")).toMatchObject({ reopened: 0 });
  });

  it("computes oldest and average open age from the reference time", () => {
    const period = performancePeriod("custom", "UTC", "2026-09-01", "2026-09-30");
    const tickets = [
      ticket("t1", { status: "open", assigneeId: "a", createdAt: "2026-09-20T00:00:00.000Z" }),
      ticket("t2", { status: "in_progress", assigneeId: "a", createdAt: "2026-09-22T00:00:00.000Z" }),
    ];
    const [row] = summarizeAgentPerformance("org", users, tickets, [], period, { at: new Date("2026-09-23T00:00:00.000Z") });
    expect(row).toMatchObject({ liveOpen: 2, oldestOpenAgeMins: 4320, avgOpenAgeMins: 2880 });
  });
});

describe("resolution trend series", () => {
  const resolvedEvents = [
    resolution("e1", "t", "a", "2026-09-29T09:00:00.000Z"),
    resolution("e2", "t", "b", "2026-09-29T15:00:00.000Z"),
    resolution("before", "t", "a", "2026-09-27T23:00:00.000Z"),
    resolution("after", "t", "a", "2026-10-05T01:00:00.000Z"),
  ];

  it("zero-fills daily buckets and excludes events outside the selected dates", () => {
    const period = performancePeriod("custom", "UTC", "2026-09-28", "2026-10-04");
    const series = buildResolutionSeries("org", resolvedEvents, period, "day");
    expect(series.map((point) => point.bucket)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(series[1]).toEqual({ bucket: "2026-09-29", total: 2, counts: { a: 1, b: 1 } });
    expect(series.reduce((sum, point) => sum + point.total, 0)).toBe(2);
  });

  it("starts week buckets on Monday and keys month buckets by year and month", () => {
    const period = performancePeriod("custom", "UTC", "2026-09-30", "2026-10-06");
    expect(buildResolutionSeries("org", resolvedEvents, period, "week").map((point) => point.bucket)).toEqual(["2026-09-28", "2026-10-05"]);
    const september = performancePeriod("custom", "UTC", "2026-09-28", "2026-10-04");
    expect(buildResolutionSeries("org", resolvedEvents, september, "month")).toEqual([
      { bucket: "2026-09", total: 2, counts: { a: 1, b: 1 } },
      { bucket: "2026-10", total: 0, counts: {} },
    ]);
  });

  it("chooses granularity by span: up to 31 days daily, up to 180 weekly, otherwise monthly", () => {
    expect(defaultGranularity(performancePeriod("custom", "UTC", "2026-09-01", "2026-10-01"))).toBe("day");
    expect(defaultGranularity(performancePeriod("custom", "UTC", "2026-09-01", "2026-10-02"))).toBe("week");
    expect(defaultGranularity(performancePeriod("custom", "UTC", "2026-01-01", "2026-06-29"))).toBe("week");
    expect(defaultGranularity(performancePeriod("custom", "UTC", "2026-01-01", "2026-06-30"))).toBe("month");
  });
});

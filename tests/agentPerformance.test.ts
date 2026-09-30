import { describe, expect, it } from "vitest";
import { performancePeriod, summarizeAgentPerformance } from "../src/server/services/agentPerformance";
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

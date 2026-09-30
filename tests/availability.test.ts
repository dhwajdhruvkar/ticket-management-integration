import { describe, expect, it } from "vitest";
import { calculateAvailability, rankExperiencedAgents } from "@/server/services/availabilityService";
import type { BusinessCalendarRow, TicketRow, UserRow } from "@/server/domain/models";

const at = new Date("2026-09-30T10:00:00Z");
const user = { id: "agent", tenantId: "org", name: "Agent", role: "agent", active: true, available: true, availabilitySettings: { capacity: 5, calendarId: "calendar" } } as UserRow;
const calendar: BusinessCalendarRow = { id: "calendar", tenantId: "org", name: "Working hours", timezone: "UTC", workDays: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, holidays: [], createdAt: at.toISOString(), updatedAt: at.toISOString() };
describe("agent availability", () => {
  it("uses working hours, holidays and capacity instead of a permanent green flag", () => {
    expect(calculateAvailability(user, 2, calendar, "in_app", at).status).toBe("available");
    expect(calculateAvailability(user, 5, calendar, "in_app", at).status).toBe("busy");
    expect(calculateAvailability(user, 0, calendar, "in_app", new Date("2026-09-30T22:00:00Z")).status).toBe("off_shift");
    expect(calculateAvailability(user, 0, { ...calendar, holidays: ["2026-09-30"] }, "in_app", at).status).toBe("off_shift");
    expect(calculateAvailability(user, 0, undefined, "in_app", at).status).toBe("unconfigured");
  });
  it("expires timed overrides and never lets Teams override capacity", () => {
    const configured = { ...user, availabilitySettings: { ...user.availabilitySettings!, override: "away" as const, overrideUntil: "2026-09-30T10:30:00Z" }, presenceSnapshot: { status: "available" as const, checkedAt: at.toISOString() } };
    expect(calculateAvailability(configured, 0, calendar, "automatic", at).status).toBe("away");
    expect(calculateAvailability(configured, 0, calendar, "automatic", new Date("2026-09-30T11:00:00Z")).source).toBe("in_app");
    expect(calculateAvailability({ ...user, presenceSnapshot: configured.presenceSnapshot }, 5, calendar, "automatic", at).status).toBe("busy");
  });
  it("uses fresh Teams presence and labels stale/unknown fallback", () => {
    const online = { ...user, presenceSnapshot: { status: "busy" as const, checkedAt: at.toISOString() } };
    expect(calculateAvailability(online, 1, calendar, "automatic", at)).toMatchObject({ status: "busy", source: "teams" });
    expect(calculateAvailability(online, 1, calendar, "automatic", new Date("2026-09-30T10:03:00Z"))).toMatchObject({ status: "available", source: "in_app" });
  });
});

describe("experience suggestions", () => {
  it("ranks available experts using actual resolvers and never borrows another tenant’s history", () => {
    const ticket = { id: "new", tenantId: "org", subject: "VPN DNS failure", body: "VPN DNS fails to connect", category: "Network" } as TicketRow;
    const staff = [user, { ...user, id: "expert", name: "Expert" }];
    const history = [
      { ...ticket, id: "old", status: "resolved", resolvedById: "expert", resolvedAt: at.toISOString(), deletedAt: null },
      { ...ticket, id: "foreign", tenantId: "other", status: "resolved", resolvedById: "agent", resolvedAt: at.toISOString(), deletedAt: null },
      { ...ticket, id: "unknown", status: "resolved", assigneeId: "agent", resolvedAt: at.toISOString(), deletedAt: null },
    ] as TicketRow[];
    const available = Object.fromEntries(staff.map((row) => [row.id, calculateAvailability(row, 0, calendar, "in_app", at)]));
    const ranked = rankExperiencedAgents(ticket, staff, history, available);
    expect(ranked[0].id).toBe("expert");
    expect(ranked[0].similarResolved).toBe(1);
    expect(ranked[1].similarResolved).toBe(0);
  });
});

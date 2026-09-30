import { describe, expect, it } from "vitest";
import { bucketHealth, monitorWorkflowTicket } from "../src/server/services/workflowMonitoring";
import { defaultWorkflowSettings } from "../src/shared/workflow";
import type { TicketRow } from "../src/server/domain/models";
import { MemoryStore } from "../src/server/data/memoryStore";
import { acquireLease, finishLease } from "../src/server/jobs/durableLease";
import { calendarMinutesBetween } from "../src/server/services/slaService";

const start = Date.parse("2026-09-28T09:00:00Z");
const ticket = { id: "t", tenantId: "a", status: "open", priority: "critical", workflowVersion: 1,
  workflow: { phase: "department", visitId: "v", queuedAt: new Date(start).toISOString(), queuedPauseMins: 0 },
  slaPausedMins: 0 } as TicketRow;

describe("durable workflow monitoring", () => {
  it("warns at 80%, escalates manager then RM, and stops on acceptance", () => {
    const settings = defaultWorkflowSettings();
    expect(bucketHealth(ticket, settings, null, null, start + 3 * 60000).level).toBe("on_track");
    expect(bucketHealth(ticket, settings, null, null, start + 4 * 60000).level).toBe("warning");
    expect(bucketHealth(ticket, settings, null, null, start + 5 * 60000).level).toBe("manager");
    expect(bucketHealth(ticket, settings, null, null, start + 10 * 60000).level).toBe("senior_rm");
    expect(bucketHealth({ ...ticket, workflow: { ...ticket.workflow!, phase: "in_progress" } }, settings, null, null, start + 20 * 60000).level).toBe("accepted");
  });
  it("honours business calendars and queue-local pause credit", () => {
    const settings = defaultWorkflowSettings();
    const calendar = { id: "cal", tenantId: "a", name: "Weekdays", timezone: "UTC", workDays: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, holidays: [], createdAt: "", updatedAt: "" };
    const friday = Date.parse("2026-10-02T17:58:00Z");
    const waiting = { ...ticket, workflow: { ...ticket.workflow!, queuedAt: new Date(friday).toISOString(), queuedPauseMins: 20, queueWorkingPauseMins: 2 }, slaPausedMins: 22 };
    const health = bucketHealth(waiting, settings, null, calendar, Date.parse("2026-10-05T09:04:00Z"));
    expect(health.managerDueAt).toBe("2026-10-05T09:05:00.000Z");
    expect(health.level).toBe("warning");
    expect(bucketHealth({ ...waiting, slaPausedAt: "2026-10-05T09:01:00Z" }, settings, null, calendar, Date.parse("2026-10-06T00:00:00Z")).level).toBe("paused");
  });
  it("does not count weekends twice when a bucket hold crosses a closed period", () => {
    const calendar = { id: "cal", tenantId: "a", name: "Weekdays", timezone: "UTC", workDays: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, holidays: [], createdAt: "", updatedAt: "" };
    const pause = calendarMinutesBetween(new Date("2026-10-02T17:59:00Z"), new Date("2026-10-05T09:03:00Z"), calendar);
    expect(pause).toBe(4);
    const waiting = { ...ticket, slaPausedMins: 3784, workflow: { ...ticket.workflow!, queuedAt: "2026-10-02T17:58:00Z", queueWorkingPauseMins: pause } };
    expect(bucketHealth(waiting, defaultWorkflowSettings(), null, calendar).managerDueAt).toBe("2026-10-05T09:07:00.000Z");
    expect(calendarMinutesBetween(new Date("2026-10-02T17:59:30Z"), new Date("2026-10-02T18:30:00Z"), calendar)).toBe(0.5);
  });
  it("allows one lease winner and fences out an expired owner", async () => {
    const store = new MemoryStore(false);
    const claims = await Promise.all([acquireLease(store, "sweep", start, 1000), acquireLease(store, "sweep", start, 1000)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const old = claims.find(Boolean)!;
    const next = (await acquireLease(store, "sweep", start + 1001, 1000))!;
    expect(next.owner).not.toBe(old.owner);
    expect(await finishLease(store, old, { lastSuccessAt: new Date(start).toISOString() })).toBe(false);
    expect(await finishLease(store, next, { lastSuccessAt: new Date(start + 1001).toISOString() })).toBe(true);
  });
  it("keeps the senior RM resolution grace period inside fallback business hours", async () => {
    const store = new MemoryStore(false);
    await store.tenants.create({ id: "a", name: "A", slug: "a", isInternal: false, workflowSettings: defaultWorkflowSettings(), createdAt: "", updatedAt: "" });
    await store.slaPolicies.create({ id: "p", tenantId: "a", name: "Business hours", createdAt: "", updatedAt: "", priority: "critical", businessHoursOnly: true, responseMins: 5, resolveMins: 60 });
    await store.tickets.create({ ...ticket, reference: "TEST", subject: "Test", requesterEmail: "requester@example.test", dueResolveAt: "2026-10-02T17:58:00Z", workflow: { ...ticket.workflow!, phase: "in_progress" } });
    await monitorWorkflowTicket(store, "t", Date.parse("2026-10-03T12:00:00Z"));
    expect((await store.tickets.get("t"))?.workflow?.resolutionEscalatedAt).toBeTruthy();
    expect((await store.tickets.get("t"))?.workflow?.resolutionRmEscalatedAt).toBeUndefined();
    await monitorWorkflowTicket(store, "t", Date.parse("2026-10-05T09:03:00Z"));
    expect((await store.tickets.get("t"))?.workflow?.resolutionRmEscalatedAt).toBeTruthy();
  });
  it("deduplicates warning/escalation notices across concurrent repeated sweeps", async () => {
    const store = new MemoryStore(false);
    const settings = { ...defaultWorkflowSettings(), enabled: true, buckets: [{ groupId: "g", kind: "department" as const, managerId: "m", seniorRmId: "r" }] };
    await store.tenants.create({ id: "a", name: "A", slug: "a", isInternal: false, workflowSettings: settings, createdAt: "", updatedAt: "" });
    for (const id of ["m", "r"]) await store.users.create({ id, tenantId: "a", role: "manager", email: `${id}@example.test`, name: id, active: true, createdAt: "", updatedAt: "" });
    await store.tickets.create({ ...ticket, assignmentGroupId: "g", reference: "TEST", subject: "Test", requesterEmail: "requester@example.test" });
    await Promise.all([monitorWorkflowTicket(store, "t", start + 11 * 60000), monitorWorkflowTicket(store, "t", start + 11 * 60000)]);
    expect(await store.events.count({ ticketId: "t" })).toBe(3);
    expect(await store.notificationDeliveries.count()).toBe(4);
    await monitorWorkflowTicket(store, "t", start + 12 * 60000);
    expect(await store.notificationDeliveries.count()).toBe(4);
  });
  it("reminds at day three then closes at day seven without claiming confirmation", async () => {
    const store = new MemoryStore(false);
    const resolved = { ...ticket, reference: "TEST", subject: "Test", requesterEmail: "requester@example.test", status: "resolved" as const, resolvedAt: new Date(start).toISOString(), workflow: { ...ticket.workflow!, phase: "resolved" as const } };
    await store.tickets.create(resolved);
    await monitorWorkflowTicket(store, "t", start + 3 * 86400000);
    expect((await store.tickets.get("t"))?.workflow?.reminderAt).toBeTruthy();
    await monitorWorkflowTicket(store, "t", start + 7 * 86400000);
    expect((await store.tickets.get("t"))?.workflow).toMatchObject({ phase: "closed", closureReason: "no_response" });
    expect((await store.tickets.get("t"))?.workflow?.confirmedAt).toBeUndefined();
    expect((await store.notifications.list()).some((row) => row.body.includes("not confirmed"))).toBe(true);
  });
});

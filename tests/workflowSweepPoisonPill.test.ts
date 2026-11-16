// R1 (malformed workflow data) and R2 (deterministic alert order) regression suite.
// File name kept from the earlier verification that reproduced the bug; it now pins the fixed behaviour.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/server/data/memoryStore";
import { runWorkflowMaintenance } from "@/server/jobs/workflowMaintenance";
import { getWorkflowAlerts, getWorkflowBoard } from "@/server/services/workflowBoard";
import { bucketHealth, InvalidWorkflowDataError } from "@/server/services/workflowMonitoring";
import { logger } from "@/server/observability/logger";
import { defaultWorkflowSettings } from "@/shared/workflow";
import type { TicketRow } from "@/server/domain/models";

const STAMP = "2026-09-30T09:00:00.000Z";
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const g = globalThis as { __netlinkStore?: Promise<unknown> };
afterEach(() => { delete g.__netlinkStore; vi.restoreAllMocks(); });

const ticket = (id: string, workflow: unknown, over: Partial<TicketRow> = {}): TicketRow => ({
  id, reference: `T-${id}`, tenantId: "org", type: "incident", subject: `subject of ${id}`, body: "SECRET BODY", requesterEmail: "r@example.test", status: "open", priority: "critical",
  category: "IT", channel: "portal", tags: [], ciIds: [], linkedTicketIds: [], slaPausedMins: 0, createdAt: STAMP, updatedAt: STAMP, deletedAt: null,
  workflowVersion: 1, assigneeId: null, assignmentGroupId: "it", workflow, ...over,
}) as unknown as TicketRow;
const wf = (mins: number, phase = "department") => ({ phase, visitId: "v", queuedAt: minsAgo(mins), queuedPauseMins: 0 });

async function newStore() {
  const store = new MemoryStore(false);
  await store.tenants.create({ id: "org", name: "Org", slug: "org", isInternal: false, createdAt: STAMP, updatedAt: STAMP, workflowSettings: { ...defaultWorkflowSettings(), enabled: true } } as never);
  await store.users.create({ id: "admin", tenantId: "org", name: "admin", email: "admin@example.test", role: "tenant_admin", active: true, createdAt: STAMP, updatedAt: STAMP } as never);
  await store.groups.create({ id: "it", tenantId: "org", name: "it", memberIds: ["admin"], categories: [], createdAt: STAMP, updatedAt: STAMP });
  return store;
}
const bindStore = (store: MemoryStore) => { g.__netlinkStore = Promise.resolve(store); };
const events = async (store: MemoryStore, id: string) => (await store.events.list({ ticketId: id })).filter((e) => e.type.startsWith("workflow."));

describe("R1: bucketHealth rejects unusable workflow data instead of inventing times", () => {
  const settings = defaultWorkflowSettings();
  const base = ticket("x", wf(3));
  it("valid records behave exactly as before", () => {
    const start = Date.parse("2026-09-28T09:00:00Z");
    const valid = { ...base, workflow: { phase: "department", visitId: "v", queuedAt: new Date(start).toISOString(), queuedPauseMins: 0 } } as TicketRow;
    expect(bucketHealth(valid, settings, null, null, start + 3 * 60_000)).toMatchObject({ level: "on_track", managerDueAt: new Date(start + 5 * 60_000).toISOString() });
    expect(bucketHealth(valid, settings, null, null, start + 4 * 60_000).level).toBe("warning");
    expect(bucketHealth(valid, settings, null, null, start + 5 * 60_000).level).toBe("manager");
    expect(bucketHealth(valid, settings, null, null, start + 10 * 60_000).level).toBe("senior_rm");
    // A numeric epoch was accepted before and still is.
    expect(bucketHealth({ ...valid, workflow: { ...valid.workflow!, queuedAt: start as never } }, settings, null, null, start + 3 * 60_000).level).toBe("on_track");
  });
  it.each([
    ["missing", undefined], ["null", null], ["empty string", ""], ["blank string", "   "], ["garbage string", "not-a-date"], ["NaN", Number.NaN], ["Infinity", Number.POSITIVE_INFINITY], ["object", {}],
  ])("throws InvalidWorkflowDataError for queuedAt %s (never a RangeError, never epoch 0 or 'now')", (_label, queuedAt) => {
    const bad = { ...base, id: "bad-1", workflow: { phase: "department", visitId: "v", queuedAt } } as unknown as TicketRow;
    let thrown: unknown;
    try { bucketHealth(bad, settings, null, null); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(InvalidWorkflowDataError);
    expect(thrown).toMatchObject({ ticketId: "bad-1" });
    expect((thrown as Error).message).not.toMatch(/Invalid time value/);
  });
  it("unusable timing values and an unknown priority are also isolated", () => {
    const calendar = { id: "c", tenantId: "org", timezone: "UTC", workDays: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, holidays: [] } as never;
    for (const workflow of [{ queuedPauseMins: "x" }, { queueWorkingPauseMins: Number.NaN }, { queueWorkingPauseMins: Number.POSITIVE_INFINITY }]) {
      const bad = { ...base, workflow: { ...base.workflow!, ...workflow } } as unknown as TicketRow;
      expect(() => bucketHealth(bad, settings, null, calendar)).toThrow(InvalidWorkflowDataError); // with a calendar NaN would otherwise collapse the deadline to the queue time
      expect(() => bucketHealth(bad, settings, null, null)).toThrow(InvalidWorkflowDataError);
    }
    expect(() => bucketHealth({ ...base, slaPausedMins: Number.NaN }, settings, null, null)).toThrow(InvalidWorkflowDataError);
    // Absent pause values are fine (default 0), as before.
    expect(bucketHealth({ ...base, workflow: { phase: "department", visitId: "v", queuedAt: base.workflow!.queuedAt } } as TicketRow, settings, null, null).level).toBe("on_track");
    expect(() => bucketHealth({ ...base, priority: "bogus" as never }, settings, null, null)).toThrow(InvalidWorkflowDataError);
  });
  it("states that do not use queuedAt are unaffected", () => {
    const noQueued = (workflow: object, over: Partial<TicketRow> = {}) => ({ ...base, ...over, workflow: { visitId: "v", ...workflow } }) as unknown as TicketRow;
    expect(bucketHealth(noQueued({ phase: "in_progress" }), settings, null, null).level).toBe("accepted");
    expect(bucketHealth(noQueued({ phase: "department" }, { status: "closed" }), settings, null, null).level).toBe("finished");
  });
});

describe("R1: alerts and board survive a malformed ticket", () => {
  it("returns the valid alerts and skips only the malformed ticket, logging id and reason without content", async () => {
    const store = await newStore();
    await store.tickets.create(ticket("mal-alerts", { phase: "department", visitId: "v" }));
    await store.tickets.create(ticket("valid-manager", wf(6)));
    await store.tickets.create(ticket("valid-rm", wf(11)));
    bindStore(store);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const result = await getWorkflowAlerts("org", { id: "admin" } as never);
    expect(result.alerts.map((a) => [a.ticketId, a.level])).toEqual([["valid-rm", "senior_rm"], ["valid-manager", "manager"]]);
    expect(result.alerts.some((a) => a.ticketId === "mal-alerts")).toBe(false);
    const calls = warn.mock.calls.filter(([msg]) => msg === "workflow.ticket.skipped_invalid_workflow");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ ticketId: "mal-alerts", reason: expect.stringContaining("queuedAt"), context: "alerts" });
    expect(JSON.stringify(calls)).not.toMatch(/SECRET BODY|subject of|example\.test/); // no ticket content or personal data
    await getWorkflowAlerts("org", { id: "admin" } as never); // polled again: not logged again within the window
    expect(warn.mock.calls.filter(([msg]) => msg === "workflow.ticket.skipped_invalid_workflow")).toHaveLength(1);
  });

  it("the full board also loads, with no health entry for the malformed ticket", async () => {
    const store = await newStore();
    await store.tickets.create(ticket("mal-board", { phase: "department", visitId: "v", queuedAt: "garbage" }));
    await store.tickets.create(ticket("ok-board", wf(6)));
    bindStore(store);
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const board = await getWorkflowBoard("org", { id: "admin" } as never, true);
    expect(Object.keys(board.queueHealth)).toEqual(["ok-board"]);
    expect(board.monitoring.alerts.map((a) => a.ticketId)).toEqual(["ok-board"]);
  });

  it("does not hide unrelated errors", async () => {
    const store = await newStore();
    await store.tickets.create(ticket("t1", wf(6)));
    bindStore(store);
    vi.spyOn(store.jobLeases, "get").mockRejectedValue(new Error("database unavailable"));
    await expect(getWorkflowAlerts("org", { id: "admin" } as never)).rejects.toThrow("database unavailable");
  });
});

describe("R1: the maintenance sweep continues past a malformed ticket", () => {
  it("escalates the valid tickets on both sides of it, completes, and advances the cursor", async () => {
    const store = await newStore();
    await store.tickets.create(ticket("a-valid", wf(60)));
    await store.tickets.create(ticket("b-malformed", { phase: "department", visitId: "v" }));
    await store.tickets.create(ticket("c-valid", wf(60)));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const result = await runWorkflowMaintenance("local_scheduler", store);
    expect(result).toMatchObject({ skipped: false, complete: true, processed: 3 });
    expect((await events(store, "a-valid")).length).toBeGreaterThan(0);
    expect((await events(store, "c-valid")).length).toBeGreaterThan(0); // the ticket after the bad one is still monitored
    expect(await events(store, "b-malformed")).toEqual([]); // no escalation computed from a guessed time
    const lease = await store.jobLeases.get("workflow-monitor");
    expect(lease).toMatchObject({ cursor: null, lastError: null });
    expect(lease?.lastSuccessAt).toBeTruthy();
    const skipped = warn.mock.calls.filter(([msg]) => msg === "workflow.ticket.skipped_invalid_workflow");
    expect(skipped.map(([, meta]) => meta)).toEqual([{ ticketId: "b-malformed", reason: expect.stringContaining("queuedAt"), context: "sweep" }]);
  });

  it("walks past a malformed ticket across page boundaries (120 tickets, bad one in the middle)", async () => {
    const store = await newStore();
    for (let i = 0; i < 120; i++) {
      const id = `t${String(i).padStart(3, "0")}`;
      await store.tickets.create(ticket(id, i === 50 ? { phase: "department", visitId: "v" } : wf(i % 2 ? 60 : 1)));
    }
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const result = await runWorkflowMaintenance("local_scheduler", store);
    expect(result).toMatchObject({ complete: true, processed: 120 });
    expect((await events(store, "t119")).length).toBeGreaterThan(0); // t119 is odd -> 60 minutes old -> escalated
    expect(await events(store, "t050")).toEqual([]);
    expect((await store.jobLeases.get("workflow-monitor"))?.cursor).toBeNull();
  });

  it("valid-only data behaves as before (escalation events, success recorded)", async () => {
    const store = await newStore();
    await store.tickets.create(ticket("only", wf(60)));
    const result = await runWorkflowMaintenance("local_scheduler", store);
    expect(result).toMatchObject({ complete: true, processed: 1 });
    expect((await events(store, "only")).length).toBeGreaterThan(0);
  });

  it("does not swallow other failures: a database error still fails the sweep and records it", async () => {
    const store = await newStore();
    await store.tickets.create(ticket("a", wf(60)));
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(store, "transaction").mockRejectedValue(new Error("db down"));
    await expect(runWorkflowMaintenance("local_scheduler", store)).rejects.toThrow("Workflow maintenance failed.");
    const lease = await store.jobLeases.get("workflow-monitor");
    expect(lease?.lastError).toContain("Workflow sweep failed");
    expect(lease?.lastSuccessAt ?? null).toBeNull();
  });
});

describe("R2: deterministic alert order", () => {
  // Built once per test so every insertion order sees the very same timestamps.
  let specsCache: Record<string, TicketRow> | null = null;
  afterEach(() => { specsCache = null; });
  async function storeWith(order: string[]) {
    const store = await newStore();
    const sharedQueued = minsAgo(4.5); // identical queue time -> identical due time, so only the id can break the tie
    const specs: Record<string, TicketRow> = specsCache ??= {
      "z-warn": ticket("z-warn", { phase: "department", visitId: "v", queuedAt: sharedQueued, queuedPauseMins: 0 }),
      "m-warn": ticket("m-warn", wf(4.4)),
      "a-warn": ticket("a-warn", { phase: "department", visitId: "v", queuedAt: sharedQueued, queuedPauseMins: 0 }),
      "q-mgr": ticket("q-mgr", wf(6)),
      "b-rm": ticket("b-rm", wf(11)),
      "c-rm": ticket("c-rm", wf(12)),
      "d-breach": ticket("d-breach", wf(30, "in_progress"), { status: "in_progress", dueResolveAt: minsAgo(5) }),
    };
    for (const id of order) await store.tickets.create(structuredClone(specs[id]));
    bindStore(store);
    return store;
  }
  const ids = ["z-warn", "m-warn", "a-warn", "q-mgr", "b-rm", "c-rm", "d-breach"];

  it("orders by severity, then earliest due date, then ticket id, whatever the insertion order", async () => {
    const outputs: string[] = [];
    for (const order of [ids, [...ids].reverse(), [ids[3], ids[6], ids[0], ids[5], ids[2], ids[1], ids[4]]]) {
      await storeWith(order);
      const result = await getWorkflowAlerts("org", { id: "admin" } as never);
      outputs.push(JSON.stringify(result.alerts));
      expect(result.alerts.map((a) => `${a.level}:${a.ticketId}`)).toEqual([
        "senior_rm:c-rm", // queued 12 min ago -> due earlier than b-rm
        "senior_rm:b-rm",
        "manager:q-mgr",
        "resolution_breach:d-breach",
        "warning:a-warn", // same warning time as z-warn: id breaks the tie
        "warning:z-warn",
        "warning:m-warn", // queued later, due later
      ]);
    }
    expect(new Set(outputs).size).toBe(1); // byte-identical payloads, so the component's equality check sees no change
  });

  it("repeated requests on unchanged data give identical results", async () => {
    await storeWith(ids);
    const first = JSON.stringify(await getWorkflowAlerts("org", { id: "admin" } as never));
    for (let i = 0; i < 5; i++) expect(JSON.stringify(await getWorkflowAlerts("org", { id: "admin" } as never))).toBe(first);
  });

  it("the store contract is deterministic too: workflowAlertTickets returns rows in id order", async () => {
    const store = await storeWith([...ids].reverse());
    const all = await store.workflowAlertTickets("org", null);
    expect(all.tickets.map((t) => t.id)).toEqual([...ids].sort());
  });

  it("alert contents and classification are unchanged from the board's own monitoring", async () => {
    const store = await storeWith(ids);
    const board = (await getWorkflowBoard("org", { id: "admin" } as never, true)).monitoring;
    expect(await getWorkflowAlerts("org", { id: "admin" } as never)).toEqual(board);
    expect(new Set(board.alerts.map((a) => a.level))).toEqual(new Set(["senior_rm", "manager", "resolution_breach", "warning"]));
    void store;
  });
});

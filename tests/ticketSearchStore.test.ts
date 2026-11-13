import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/server/data/memoryStore";
import { getWorkflowAlerts, getWorkflowBoard } from "@/server/services/workflowBoard";
import { defaultWorkflowSettings } from "@/shared/workflow";
import type { TicketRow, UserRow } from "@/server/domain/models";

const STAMP = "2026-09-30T09:00:00.000Z";
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function ticket(over: Partial<TicketRow> & { id: string }): TicketRow {
  return { tenantId: "org", type: "incident", subject: `Subject ${over.id}`, body: "b", requesterEmail: "req@example.test", reference: `TKT-${over.id}`,
    status: "open", priority: "medium", category: "IT", channel: "portal", tags: [], ciIds: [], linkedTicketIds: [], slaPausedMins: 0,
    createdAt: STAMP, updatedAt: STAMP, deletedAt: null, workflowVersion: 0, assigneeId: null, ...over } as TicketRow;
}

const g = globalThis as unknown as { __netlinkStore?: Promise<unknown> };
afterEach(() => { delete g.__netlinkStore; });

describe("store.searchTickets (MemoryStore)", () => {
  async function seed() {
    const store = new MemoryStore(false);
    const rows = [
      ticket({ id: "a", status: "open", assigneeId: "me", priority: "high", createdAt: minsAgo(50), updatedAt: minsAgo(5), assignmentGroupId: "g1" }),
      ticket({ id: "b", status: "pending", createdAt: minsAgo(40), updatedAt: minsAgo(4), subject: "VPN outage" }),
      ticket({ id: "c", status: "resolved", assigneeId: "me", createdAt: minsAgo(30), updatedAt: minsAgo(1), resolvedAt: minsAgo(1) }),
      ticket({ id: "d", status: "open", createdAt: minsAgo(20), updatedAt: minsAgo(3), dueResponseAt: new Date(Date.now() - 60_000).toISOString() }),
      ticket({ id: "e", status: "open", createdAt: minsAgo(10), updatedAt: minsAgo(2), dueResponseAt: new Date(Date.now() + 3_600_000).toISOString() }),
      ticket({ id: "gone", status: "open", createdAt: minsAgo(60), deletedAt: STAMP }),
      ticket({ id: "foreign", tenantId: "other", status: "open", createdAt: minsAgo(70) }),
    ];
    for (const row of rows) await store.tickets.create(row);
    return store;
  }
  const spec = (over: object = {}) => ({ scope: {}, meId: "me", view: "all" as const, filters: {}, skip: 0, take: 50, ...over });

  it("counts every saved view over the tenant's live tickets only", async () => {
    const store = await seed();
    const { counts, total } = await store.searchTickets("org", spec());
    expect(total).toBe(5);
    expect(counts).toEqual({ your_unsolved: 1, unassigned: 3, all_unsolved: 4, pending: 1, recently_updated: 5, recently_solved: 1, all: 5 });
  });

  it("applies each view's predicate and ordering", async () => {
    const store = await seed();
    const ids = async (view: string) => (await store.searchTickets("org", spec({ view }))).data.map((t) => t.id);
    expect(await ids("your_unsolved")).toEqual(["a"]);
    expect(await ids("unassigned")).toEqual(["e", "d", "b"]);
    expect(await ids("all_unsolved")).toEqual(["e", "d", "b", "a"]);
    expect(await ids("pending")).toEqual(["b"]);
    expect(await ids("recently_solved")).toEqual(["c"]);
    expect(await ids("recently_updated")).toEqual(["c", "e", "d", "b", "a"]);
    expect(await ids("all")).toEqual(["e", "d", "c", "b", "a"]);
  });

  it("combines view, filters and search, and treats the SLA boundary strictly", async () => {
    const store = await seed();
    expect((await store.searchTickets("org", spec({ view: "all_unsolved", filters: { priority: "high", groupId: "g1" } }))).data.map((t) => t.id)).toEqual(["a"]);
    expect((await store.searchTickets("org", spec({ view: "all_unsolved", filters: { overdue: true } }))).data.map((t) => t.id)).toEqual(["d"]);
    expect((await store.searchTickets("org", spec({ filters: { slaState: "breached" } }))).data.map((t) => t.id)).toEqual(["d"]);
    expect((await store.searchTickets("org", spec({ q: "vpn", view: "pending" }))).data.map((t) => t.id)).toEqual(["b"]);
    expect((await store.searchTickets("org", spec({ q: "vpn", filters: { priority: "high" } }))).total).toBe(0);
    // Counts ignore filters and search, like the sidebar.
    expect((await store.searchTickets("org", spec({ q: "vpn" }))).counts.all).toBe(5);
  });

  it("pages across multiple pages with a stable total and honours the caller scope", async () => {
    const store = await seed();
    const p1 = await store.searchTickets("org", spec({ take: 2, skip: 0 }));
    const p2 = await store.searchTickets("org", spec({ take: 2, skip: 2 }));
    const p3 = await store.searchTickets("org", spec({ take: 2, skip: 4 }));
    expect([...p1.data, ...p2.data, ...p3.data].map((t) => t.id)).toEqual(["e", "d", "c", "b", "a"]);
    expect([p1.total, p2.total, p3.total]).toEqual([5, 5, 5]);
    expect((await store.searchTickets("org", spec({ scope: { requesterEmail: "someone@else.test" } }))).total).toBe(0);
    expect((await store.searchTickets("org", spec({ scope: { assigneeId: null } }))).data.map((t) => t.id)).toEqual(["e", "d", "b"]);
    expect((await store.searchTickets("other", spec())).data.map((t) => t.id)).toEqual(["foreign"]);
  });
});

describe("workflow alerts: optimised query equals the board's monitoring", () => {
  async function seed() {
    const store = new MemoryStore(false);
    await store.tenants.create({ id: "org", name: "Org", slug: "org", isInternal: false, createdAt: STAMP, updatedAt: STAMP, workflowSettings: { ...defaultWorkflowSettings(), enabled: true } } as never);
    await store.tenants.create({ id: "other", name: "Other", slug: "other", isInternal: false, createdAt: STAMP, updatedAt: STAMP } as never);
    const users: UserRow[] = [["admin", "tenant_admin"], ["mgr", "manager"], ["agent", "agent"], ["peer", "agent"], ["solo", "agent"]].map(([id, role]) => ({ id, tenantId: "org", name: id, email: `${id}@example.test`, role, active: true, createdAt: STAMP, updatedAt: STAMP }) as UserRow);
    for (const user of users) await store.users.create(user);
    await store.groups.create({ id: "it", tenantId: "org", name: "it", memberIds: ["agent", "peer"], categories: [], createdAt: STAMP, updatedAt: STAMP });
    await store.groups.create({ id: "desk", tenantId: "org", name: "desk", memberIds: ["mgr"], categories: [], createdAt: STAMP, updatedAt: STAMP });
    const wf = (phase: string, queuedMinsAgo: number) => ({ phase, visitId: "v", queuedAt: minsAgo(queuedMinsAgo), queuedPauseMins: 0 }) as TicketRow["workflow"];
    const rows = [
      ticket({ id: "ontrack", priority: "critical", assignmentGroupId: "it", workflow: wf("department", 3) }),
      ticket({ id: "warning", priority: "critical", assignmentGroupId: "it", workflow: wf("department", 4.5) }),
      ticket({ id: "manager", priority: "critical", assignmentGroupId: "desk", workflow: wf("department", 6) }),
      ticket({ id: "rm", priority: "critical", assignmentGroupId: "desk", assigneeId: "solo", workflow: wf("department", 11) }),
      ticket({ id: "breach", priority: "critical", assignmentGroupId: "it", status: "in_progress", dueResolveAt: minsAgo(5), workflow: wf("in_progress", 30) }),
      ticket({ id: "accepted-ok", priority: "critical", assignmentGroupId: "it", status: "in_progress", dueResolveAt: new Date(Date.now() + 3_600_000).toISOString(), workflow: wf("in_progress", 30) }),
      ticket({ id: "paused-breach", priority: "critical", assignmentGroupId: "it", status: "in_progress", slaPausedAt: minsAgo(2), dueResolveAt: minsAgo(5), workflow: wf("in_progress", 30) }),
      ticket({ id: "paused", priority: "critical", assignmentGroupId: "it", slaPausedAt: minsAgo(1), workflow: wf("department", 20) }),
      ticket({ id: "resolved", priority: "critical", assignmentGroupId: "it", status: "resolved", workflow: wf("department", 20) }),
      ticket({ id: "cancelled", priority: "critical", assignmentGroupId: "it", status: "cancelled", workflow: wf("department", 20) }),
      ticket({ id: "deleted", priority: "critical", assignmentGroupId: "it", deletedAt: STAMP, workflow: wf("department", 20) }),
      ticket({ id: "nowf", priority: "critical", assignmentGroupId: "it", workflow: undefined }),
      ticket({ id: "nullwf", priority: "critical", assignmentGroupId: "it", workflow: null as never }),
      ticket({ id: "foreign", tenantId: "other", priority: "critical", workflow: wf("department", 20) }),
    ];
    for (const row of rows) await store.tickets.create(row);
    await store.notificationDeliveries.create({ id: "nd1", tenantId: "org", status: "pending" } as never);
    await store.notificationDeliveries.create({ id: "nd2", tenantId: "org", status: "failed" } as never);
    g.__netlinkStore = Promise.resolve(store);
    return users;
  }

  it("returns the same alerts, health and flags as the full board for every role", async () => {
    const users = await seed();
    for (const user of users) {
      const old = (await getWorkflowBoard("org", { id: user.id } as never, true)).monitoring;
      const next = await getWorkflowAlerts("org", { id: user.id } as never);
      expect(next, user.id).toEqual(old);
    }
  });

  it("flags each severity and respects agent visibility", async () => {
    await seed();
    const levels = async (id: string) => Object.fromEntries((await getWorkflowAlerts("org", { id } as never)).alerts.map((a) => [a.ticketId, a.level]));
    expect(await levels("admin")).toEqual({ warning: "warning", manager: "manager", rm: "senior_rm", breach: "resolution_breach" });
    // Group member: own group's tickets only, not the desk-group ones or the assigned-to-solo one.
    expect(await levels("agent")).toEqual({ warning: "warning", breach: "resolution_breach" });
    // Assigned-to visibility without group membership.
    expect(await levels("solo")).toEqual({ rm: "senior_rm" });
    const health = (await getWorkflowAlerts("org", { id: "admin" } as never)).health;
    expect(health).toMatchObject({ pendingEmails: 1, failedEmails: 1 });
  });

  it("returns only workflow tickets from the store, excluding closed/cancelled, deleted, foreign and no-workflow rows (resolved stays, as before)", async () => {
    await seed();
    const store = (await g.__netlinkStore) as MemoryStore;
    const all = await store.workflowAlertTickets("org", null);
    expect(all.tickets.map((t) => t.id).sort()).toEqual(["accepted-ok", "breach", "manager", "ontrack", "paused", "paused-breach", "resolved", "rm", "warning"]);
    expect(all.workflowCount).toBe(9);
    const mine = await store.workflowAlertTickets("org", { userId: "solo", groupIds: [] });
    expect(mine.tickets.map((t) => t.id)).toEqual(["rm"]);
    expect(mine.workflowCount).toBe(9);
  });
});

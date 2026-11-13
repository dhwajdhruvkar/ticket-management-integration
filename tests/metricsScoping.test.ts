import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/server/data/memoryStore";

describe("tenant-scoped store queries", () => {
  it("scopes resolutions and events to the tenant's active tickets", async () => {
    const store = new MemoryStore();
    await store.ready();
    const base = { createdAt: new Date().toISOString() };
    const mk = (id: string, tenantId: string, deletedAt: string | null) => ({ id, tenantId, deletedAt, reference: id, ...base }) as never;
    await store.tickets.create(mk("a", "t1", null));
    await store.tickets.create(mk("b", "t2", null));
    await store.tickets.create(mk("c", "t1", new Date().toISOString()));
    for (const id of ["a", "b", "c"]) {
      await store.resolutions.create({ id: `r${id}`, ticketId: id, decision: "suggest", confidence: 0.5 } as never);
      await store.events.create({ id: `e${id}`, ticketId: id, type: "reopened", tenantId: null, message: "", ...base } as never);
      await store.events.create({ id: `x${id}`, ticketId: id, type: "other", message: "", ...base } as never);
    }
    expect((await store.resolutionsForTenant("t1")).map((r) => r.ticketId)).toEqual(["a"]);
    expect((await store.eventsForTenant("t1", "reopened")).map((e) => e.ticketId)).toEqual(["a"]);
    expect(await store.eventsForTenant("t2", "reopened")).toHaveLength(1);
  });
});

describe("notification feed queries", () => {
  it("filters by tenant and recipient (case-insensitive), pages, counts unread and marks read", async () => {
    const store = new MemoryStore();
    await store.ready();
    const mk = (id: string, tenantId: string, toAddress: string, createdAt: string, readAt?: string) =>
      store.notifications.create({ id, tenantId, toAddress, subject: id, body: "", channel: "in_app", sent: false, createdAt, readAt: readAt ?? null } as never);
    await mk("n1", "t1", "Me@x.com", "2026-01-01T00:00:00.000Z");
    await mk("n2", "t1", "me@x.com", "2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z");
    await mk("n3", "t1", "other@x.com", "2026-01-03T00:00:00.000Z");
    await mk("n4", "t2", "me@x.com", "2026-01-04T00:00:00.000Z");
    const page = await store.notificationsFor("t1", "ME@x.com", { skip: 0, take: 1, dir: "desc" });
    expect(page).toMatchObject({ total: 2, unread: 1 });
    expect(page.items.map((n) => n.id)).toEqual(["n2"]);
    expect(await store.markNotificationsRead("t1", "me@x.com", "2026-02-01T00:00:00.000Z", "n3")).toBe(0);
    expect(await store.markNotificationsRead("t1", "me@x.com", "2026-02-01T00:00:00.000Z")).toBe(1);
    expect((await store.notificationsFor("t1", "me@x.com", { skip: 0, take: 10, dir: "desc" })).unread).toBe(0);
  });
});

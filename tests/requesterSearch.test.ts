import { beforeAll, describe, expect, it } from "vitest";
import { getStore } from "@/server/data";
import { searchRequesters } from "@/server/services/requesterSearch";

beforeAll(async () => {
  const store = await getStore();
  const stamp = new Date().toISOString();
  for (const [id, name] of [["search-alice", "Alice Search"], ["search-zara", "Zara Search"]]) {
    if (!(await store.users.get(id))) await store.users.create({ id, tenantId: "tenant_search", name, email: `${id}@netlink.test`, role: "requester", active: true, createdAt: stamp, updatedAt: stamp });
  }
  // 51 users so the 50-result cap is observable.
  for (let i = 0; i < 51; i++) {
    const id = `search-bulk-${String(i).padStart(2, "0")}`;
    if (!(await store.users.get(id))) await store.users.create({ id, tenantId: "tenant_search_bulk", name: `Bulk ${id}`, email: `${id}@netlink.test`, role: "requester", active: true, createdAt: stamp, updatedAt: stamp });
  }
});

describe("requester search", () => {
  it("searches tenant users by name/email without exposing authentication fields", async () => {
    const store = await getStore();
    const user = (await store.users.list({ tenantId: "tenant_search" }))[0];
    const result = await searchRequesters("tenant_search", user.email.toUpperCase(), 1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({ id: user.id, name: user.name, email: user.email, department: user.department ?? null, location: user.location ?? null });
    expect(JSON.stringify(result)).not.toMatch(/passwordHash|failedLogin|lockedUntil/);
    expect((await searchRequesters("unrelated-tenant", user.email, 20)).items).toEqual([]);
  });

  it("filters before limiting results and excludes inactive accounts", async () => {
    const store = await getStore();
    const users = (await store.users.list({ tenantId: "tenant_search" })).filter((u) => u.active);
    const target = users.at(-1)!;
    expect((await searchRequesters("tenant_search", target.name, 1)).items[0].id).toBe(target.id);
    await store.users.update(target.id, { active: false });
    try { expect((await searchRequesters("tenant_search", target.email, 20)).items).toEqual([]); }
    finally { await store.users.update(target.id, { active: true }); }
  });

  it("browses the first page alphabetically when the search is empty", async () => {
    const first = await searchRequesters("tenant_search", "  ", 1);
    expect(first.items.map((item) => item.name)).toEqual(["Alice Search"]);
    expect(first.hasMore).toBe(true);
    const all = await searchRequesters("tenant_search", "", 20);
    expect(all.items.map((item) => item.name)).toEqual(["Alice Search", "Zara Search"]);
    expect(all.hasMore).toBe(false);
  });

  it("matches on the location and returns it with each choice", async () => {
    const store = await getStore();
    await store.users.update("search-alice", { location: "Dublin HQ, Floor 3" });
    try {
      const result = await searchRequesters("tenant_search", "dublin", 20);
      expect(result.items.map((item) => item.id)).toEqual(["search-alice"]);
      expect(result.items[0].location).toBe("Dublin HQ, Floor 3");
    } finally {
      await store.users.update("search-alice", { location: null });
    }
  });

  it("clamps the limit between 1 and 50", async () => {
    expect((await searchRequesters("tenant_search_bulk", "", 0)).items).toHaveLength(1);
    const capped = await searchRequesters("tenant_search_bulk", "", 500);
    expect(capped.items).toHaveLength(50);
    expect(capped.hasMore).toBe(true);
  });
});

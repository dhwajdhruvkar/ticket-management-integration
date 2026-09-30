import { beforeAll, describe, expect, it } from "vitest";
import { getStore } from "@/server/data";
import { searchRequesters } from "@/server/services/requesterSearch";

beforeAll(async () => {
  const store = await getStore();
  for (const [id, name] of [["search-alice", "Alice Search"], ["search-zara", "Zara Search"]]) {
    if (!(await store.users.get(id))) await store.users.create({ id, tenantId: "tenant_search", name, email: `${id}@netlink.test`, role: "requester", active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
});

describe("requester search", () => {
  it("searches tenant users by name/email without exposing authentication fields", async () => {
    const store = await getStore();
    const user = (await store.users.list({ tenantId: "tenant_search" }))[0];
    const result = await searchRequesters("tenant_search", user.email.toUpperCase(), 1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({ id: user.id, name: user.name, email: user.email, department: user.department ?? null });
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

  it("does not enumerate users for an empty search and bounds results", async () => {
    expect((await searchRequesters("tenant_search", "  ", 20)).items).toEqual([]);
    const result = await searchRequesters("tenant_search", "netlink", 1);
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });
});

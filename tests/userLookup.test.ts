import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/server/data/memoryStore";
import { findUserByEmail } from "@/server/services/userLookup";
import type { UserRow } from "@/server/domain/models";

const STAMP = "2026-09-30T09:00:00.000Z";
const user = (id: string, tenantId: string, email: string) => ({ id, tenantId, name: id, email, role: "agent", active: true, createdAt: STAMP, updatedAt: STAMP }) as UserRow;

async function seed() {
  const store = new MemoryStore(false);
  await store.users.create(user("u1", "org", "dana.lee@example.test"));
  await store.users.create(user("u2", "other", "dana.lee@example.test"));
  await store.users.create(user("u3", "org", "sam@example.test"));
  return store;
}

describe("findUserByEmail", () => {
  it("finds a user whatever the case or surrounding spaces of the lookup", async () => {
    const store = await seed();
    for (const email of ["dana.lee@example.test", "DANA.LEE@EXAMPLE.TEST", "  Dana.Lee@Example.test "]) {
      expect((await findUserByEmail(store, "org", email))?.id).toBe("u1");
    }
  });
  it("never returns a user from another tenant", async () => {
    const store = await seed();
    expect((await findUserByEmail(store, "other", "dana.lee@example.test"))?.id).toBe("u2");
    expect(await findUserByEmail(store, "other", "sam@example.test")).toBeNull();
    expect(await findUserByEmail(store, "nobody", "dana.lee@example.test")).toBeNull();
  });
  it("returns null for an unknown address", async () => {
    expect(await findUserByEmail(await seed(), "org", "missing@example.test")).toBeNull();
  });
});

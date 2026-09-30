import { describe, expect, it } from "vitest";
import { MemoryCollection, MemoryStore } from "@/server/data/memoryStore";

describe("workflow persistence guarantees", () => {
  it("permits exactly one conditional-update winner", async () => {
    const rows = [{ id: "ticket", version: 0, owner: "" }];
    const collection = new MemoryCollection(() => rows, () => {});
    const attempts = await Promise.all(["alice", "bob"].map((owner) => collection.updateIf("ticket", { version: 0 }, { version: 1, owner })));
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(rows[0].version).toBe(1);
  });

  it("serializes transactions so a failing transaction cannot undo another commit", async () => {
    const store = new MemoryStore(false);
    const row = { id: "tx-test", name: "original", slug: "tx-test", isInternal: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await store.tenants.create(row);
    const failing = store.transaction(async (tx) => {
      await tx.tenants.update(row.id, { name: "temporary" });
      await new Promise((resolve) => setTimeout(resolve, 15));
      throw new Error("rollback");
    });
    const success = store.transaction(async (tx) => {
      await tx.tenants.update(row.id, { name: "committed" });
    });
    await Promise.allSettled([failing, success]);
    expect((await store.tenants.get(row.id))?.name).toBe("committed");
  });
  it("also isolates standalone reads and writes from an uncommitted transaction", async () => {
    const store = new MemoryStore(false);
    await store.tenants.create({ id: "t", name: "original", slug: "t", isInternal: false, createdAt: "", updatedAt: "" });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const failed = store.transaction(async (tx) => {
      await tx.tenants.update("t", { name: "temporary" }); entered();
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("rollback");
    });
    await ready;
    const read = store.tenants.get("t");
    const write = store.tenants.update("t", { name: "outside" });
    await Promise.allSettled([failed, write]);
    expect((await read)?.name).toBe("original");
    expect((await store.tenants.get("t"))?.name).toBe("outside");
  });
});

import { describe, expect, it } from "vitest";
import { DatabaseBlobStore, type AttachmentBlobTable } from "@/server/storage/databaseBlob";

// Map-backed stand-in for the Prisma AttachmentBlob delegate.
function fakeTable(): AttachmentBlobTable {
  const rows = new Map<string, { id: string; data: Uint8Array }>();
  return {
    async upsert({ where, create, update }) {
      const existing = rows.get(where.id);
      rows.set(where.id, { id: where.id, data: existing ? update.data : create.data });
      return {};
    },
    async findUnique({ where }) {
      return rows.get(where.id) ?? null;
    },
    async deleteMany({ where }) {
      return { count: rows.delete(where.id) ? 1 : 0 };
    },
  };
}

describe("database blob store", () => {
  it("round-trips bytes exactly", async () => {
    const table = fakeTable();
    const store = new DatabaseBlobStore(() => table);
    const bytes = Buffer.from([0, 1, 2, 250, 255]);
    expect(await store.put("att-1", bytes)).toBe("db://att-1");
    expect(await store.get("att-1")).toEqual(bytes);
  });

  it("overwrites an existing key on put", async () => {
    const table = fakeTable();
    const store = new DatabaseBlobStore(() => table);
    await store.put("att-2", Buffer.from("first"));
    await store.put("att-2", Buffer.from("second"));
    expect((await store.get("att-2"))?.toString()).toBe("second");
  });

  it("returns null for a missing key", async () => {
    const table = fakeTable();
    const store = new DatabaseBlobStore(() => table);
    expect(await store.get("missing")).toBeNull();
  });

  it("reports true on first delete and false once the key is gone", async () => {
    const table = fakeTable();
    const store = new DatabaseBlobStore(() => table);
    await store.put("att-3", Buffer.from("x"));
    expect(await store.delete("att-3")).toBe(true);
    expect(await store.delete("att-3")).toBe(false);
  });

  it("rejects keys that are not opaque server-generated ids", async () => {
    const table = fakeTable();
    const store = new DatabaseBlobStore(() => table);
    await expect(store.put("../escape", Buffer.from("x"))).rejects.toThrow("Invalid blob key.");
    await expect(store.get("a/b")).rejects.toThrow("Invalid blob key.");
    await expect(store.delete("")).rejects.toThrow("Invalid blob key.");
  });
});

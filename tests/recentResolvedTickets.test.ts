import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/server/data/memoryStore";
import type { TicketRow } from "@/server/domain/models";

const STAMP = "2026-09-30T09:00:00.000Z";
const ticket = (id: string, over: Partial<TicketRow>) => ({
  id, reference: id, tenantId: "org", type: "incident", subject: id, body: "b", requesterEmail: "r@example.test", status: "resolved", priority: "low", category: "IT", channel: "portal",
  tags: [], ciIds: [], linkedTicketIds: [], slaPausedMins: 0, createdAt: STAMP, updatedAt: STAMP, deletedAt: null, workflowVersion: 0, assigneeId: null, resolvedAt: null, ...over,
}) as TicketRow;

describe("store.recentResolvedTickets (MemoryStore)", () => {
  it("returns this tenant's non-deleted resolved tickets, newest resolution first, limited", async () => {
    const store = new MemoryStore(false);
    for (const t of [
      ticket("a", { resolvedAt: "2026-10-01T00:00:00.000Z" }),
      ticket("b", { resolvedAt: "2026-10-03T00:00:00.000Z" }),
      ticket("c", { resolvedAt: "2026-10-02T00:00:00.000Z" }),
      ticket("d", { resolvedAt: "2026-10-03T00:00:00.000Z" }), // ties with b: id order
      ticket("open", { status: "open" }),
      ticket("deleted", { resolvedAt: "2026-10-09T00:00:00.000Z", deletedAt: STAMP }),
      ticket("other", { tenantId: "other", resolvedAt: "2026-10-08T00:00:00.000Z" }),
    ]) await store.tickets.create(t);
    expect((await store.recentResolvedTickets("org", 10)).map((t) => t.id)).toEqual(["b", "d", "c", "a"]);
    expect((await store.recentResolvedTickets("org", 2)).map((t) => t.id)).toEqual(["b", "d"]);
    expect(await store.recentResolvedTickets("nobody", 5)).toEqual([]);
  });
});

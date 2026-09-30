import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/server/data/memoryStore";
import { queueLifecycle } from "../src/server/notify/workflowOutbox";
import { acknowledgeTicket } from "../src/server/services/ticketAcknowledgement";
import { acknowledgementToken } from "../src/server/notify/acknowledgementTokens";
import type { TicketRow } from "../src/server/domain/models";

const stamp = "2026-09-30T10:00:00.000Z";
async function fixture() {
  const store = new MemoryStore(false);
  const ticket = { id: "ack-ticket", tenantId: "org-a", reference: "INC-TEST", subject: "Test", requesterEmail: "external@example.test", status: "resolved", resolvedAt: stamp, resolvedById: "agent-a", deletedAt: null, workflowVersion: 3,
    workflow: { phase: "resolved", queuedAt: stamp, visitId: "visit", acceptedAt: stamp, resolvedById: "agent-a" } } as TicketRow;
  await store.tickets.create(ticket);
  await store.transaction((tx) => queueLifecycle(tx, ticket, "evt-resolved", "resolved", undefined, Date.parse(stamp)));
  const ack = (await store.acknowledgements.list())[0];
  return { store, ticket, ack, token: acknowledgementToken(ack.id) };
}
beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-only-acknowledgement-secret-at-least-32-characters"));
afterEach(() => vi.unstubAllEnvs());

describe("resolution acknowledgement", () => {
  it("queues once and never persists the raw confirmation token", async () => {
    const { store, ticket, token } = await fixture();
    await store.transaction((tx) => queueLifecycle(tx, ticket, "evt-resolved", "resolved"));
    expect(await store.notificationDeliveries.count()).toBe(1);
    expect(JSON.stringify([await store.acknowledgements.list(), await store.notifications.list(), await store.notificationDeliveries.list()])).not.toContain(token);
  });
  it("allows an external requester to confirm exactly once under concurrent requests", async () => {
    const { store, token } = await fixture();
    const results = await Promise.allSettled([acknowledgeTicket(token, "confirm", store, Date.parse(stamp) + 1), acknowledgeTicket(token, "reopen", store, Date.parse(stamp) + 1)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const updated = await store.tickets.get("ack-ticket");
    expect(updated?.workflow?.closureReason).toBe("requester_confirmed");
    expect(updated?.workflow?.confirmedAt).toBeTruthy();
    await expect(acknowledgeTicket(token, "confirm", store, Date.parse(stamp) + 2)).rejects.toThrow("no longer valid");
  });
  it("rejects expired, forged and old-resolution links without altering the ticket", async () => {
    const { store, ticket, token } = await fixture();
    await expect(acknowledgeTicket(token, "confirm", store, Date.parse(stamp) + 7 * 86400000)).rejects.toThrow("no longer valid");
    await expect(acknowledgeTicket(token.slice(0, -1) + "!", "confirm", store, Date.parse(stamp) + 1)).rejects.toThrow("no longer valid");
    await store.tickets.update(ticket.id, { resolvedAt: "2026-09-30T11:00:00.000Z" });
    await expect(acknowledgeTicket(token, "reopen", store, Date.parse(stamp) + 2)).rejects.toThrow("no longer valid");
    expect((await store.tickets.get(ticket.id))?.status).toBe("resolved");
  });
  it("reopens into the department bucket without implying confirmation", async () => {
    const { store, ticket, token } = await fixture();
    await store.tickets.update(ticket.id, { workflow: { ...ticket.workflow!, resolutionRmEscalatedAt: stamp, reminderAt: stamp } });
    await acknowledgeTicket(token, "reopen", store, Date.parse(stamp) + 1);
    const updated = await store.tickets.get(ticket.id);
    expect(updated?.status).toBe("reopened");
    expect(updated?.workflow?.phase).toBe("department");
    expect(updated?.workflow?.confirmedAt).toBeUndefined();
    expect(updated?.workflow?.resolutionRmEscalatedAt).toBeUndefined();
    expect(updated?.workflow?.reminderAt).toBeUndefined();
    expect(updated?.assigneeId).toBeNull();
  });
  it("rolls back ticket, in-app notification and delivery together on failure", async () => {
    const { store, ticket } = await fixture();
    const count = await store.notifications.count();
    await expect(store.transaction(async (tx) => {
      await tx.tickets.update(ticket.id, { status: "closed" });
      await queueLifecycle(tx, { ...ticket, status: "closed" }, "event-close", "closed");
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect((await store.tickets.get(ticket.id))?.status).toBe("resolved");
    expect(await store.notifications.count()).toBe(count);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/server/data/memoryStore";
import { drainWorkflowOutbox, queueLifecycle } from "../src/server/notify/workflowOutbox";
import { refreshTeamsPresence } from "../src/server/integrations/teamsPresence";
import type { TicketRow, UserRow } from "../src/server/domain/models";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const ticket = { id: "t", tenantId: "org", status: "open", requesterEmail: "external@example.test", subject: "Test", reference: "T1", workflow: { phase: "department", queuedAt: new Date().toISOString(), visitId: "v" } } as TicketRow;
describe("workflow notification outbox", () => {
  it("has one delivery worker winner and excludes internal notes", async () => {
    const store = new MemoryStore(false); await store.tickets.create(ticket);
    await store.transaction(async (tx) => {
      await queueLifecycle(tx, ticket, "e1", "created");
      await queueLifecycle(tx, ticket, "e2", "note_added", "INTERNAL SECRET");
    });
    const sender = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    await Promise.all([drainWorkflowOutbox(store, Date.now() + 1000, sender), drainWorkflowOutbox(store, Date.now() + 1000, sender)]);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]).not.toContain("INTERNAL SECRET");
    expect((await store.notificationDeliveries.list())[0].status).toBe("sent");
  });
  it("keeps failed sends for retry without losing the in-app notification", async () => {
    const store = new MemoryStore(false); await store.tickets.create(ticket);
    await store.transaction((tx) => queueLifecycle(tx, ticket, "e1", "created"));
    await drainWorkflowOutbox(store, Date.now() + 1000, async () => { throw new Error("provider secret must not be stored"); });
    const job = (await store.notificationDeliveries.list())[0];
    expect(job).toMatchObject({ status: "pending", attempts: 1 });
    expect(job.lastError).not.toContain("secret");
    expect(Date.parse(job.nextAttemptAt)).toBeGreaterThan(Date.now());
    expect(await store.notifications.count()).toBe(1);
  });
});
describe("tenant-mapped Teams presence", () => {
  const microsoftId = "11111111-1111-4111-a111-111111111111";
  const user = { id: "u", tenantId: "org", role: "agent", active: true, availabilitySettings: { capacity: 5, teamsUserId: microsoftId } } as UserRow;
  const configure = () => vi.stubEnv("TEAMS_PRESENCE_CONNECTIONS", JSON.stringify({ org: { tenantId: microsoftId, clientId: microsoftId, clientSecret: "test-provider-secret" } }));
  it("never uses another organization's credentials", async () => {
    configure(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = await refreshTeamsPresence(new MemoryStore(false), "other", [{ ...user, tenantId: "other" }]);
    expect(fetcher).not.toHaveBeenCalled(); expect(result[0].presenceSnapshot).toBeNull();
  });
  it("validates and maps provider responses and falls back on provider failure", async () => {
    configure(); const store = new MemoryStore(false); await store.users.create(user);
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "test" })).mockResolvedValueOnce(Response.json({ value: [{ id: microsoftId, availability: "Busy" }] }));
    vi.stubGlobal("fetch", fetcher);
    const result = await refreshTeamsPresence(store, "org", [user]);
    expect(result[0].presenceSnapshot?.status).toBe("busy");
    fetcher.mockRejectedValue(new Error("network"));
    expect((await refreshTeamsPresence(store, "org", [user]))[0].presenceSnapshot?.status).toBe("unknown");
  });
});

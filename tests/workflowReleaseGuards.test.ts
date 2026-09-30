import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/server/data/memoryStore";
import type { DataStore } from "../src/server/data/store";
import type { TicketRow } from "../src/server/domain/models";
const mocks = vi.hoisted(() => ({ store: null as DataStore | null, context: vi.fn() }));
vi.mock("@/server/data", () => ({ getStore: async () => mocks.store }));
vi.mock("@/server/context", () => ({ currentActor: async () => mocks.context(), currentTenantId: async () => "a" }));
import { agentResolve } from "../src/server/services/agentActions";
import { POST as actionRoute } from "../src/app/api/v1/tickets/[id]/actions/route";
import { POST as retryEmails } from "../src/app/api/v1/workflow/retry-emails/route";
import { cleanWorkflowMetadata } from "../src/server/jobs/workflowRetention";

beforeEach(async () => {
  mocks.store = new MemoryStore(false);
  await mocks.store.tenants.create({ id: "a", name: "A", slug: "a", isInternal: false, createdAt: "", updatedAt: "" });
  for (const id of ["one", "two"]) await mocks.store.users.create({ id, tenantId: "a", role: "agent", name: id, email: `${id}@example.test`, active: true, createdAt: "", updatedAt: "" });
  await mocks.store.tickets.create({ id: "t", tenantId: "a", status: "open", reference: "TEST", subject: "Test", requesterEmail: "requester@example.test", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), resolvedAt: null } as TicketRow);
  mocks.context.mockReturnValue({ id: "requester", role: "requester", name: "Requester", email: "requester@example.test" });
});
describe("release safety regressions", () => {
  it("records only one actual resolver when two agents resolve a legacy ticket concurrently", async () => {
    const results = await Promise.allSettled(["one", "two"].map((id) => agentResolve("t", { id, name: id, role: "agent" })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await mocks.store!.events.count({ type: "resolution_recorded" })).toBe(1);
  });
  it("rejects requester reopening through the public action route during an approval hold", async () => {
    await mocks.store!.tickets.update("t", { status: "pending", slaPausedAt: new Date().toISOString(), workflowVersion: 1, workflow: { phase: "service_desk", visitId: "v", queuedAt: new Date().toISOString() } });
    const response = await actionRoute(new Request("https://example.test/api/v1/tickets/t/actions", { method: "POST", body: JSON.stringify({ action: "reopen" }) }), { params: Promise.resolve({ id: "t" }) });
    expect(response.status).toBe(409);
    expect((await mocks.store!.tickets.get("t"))?.status).toBe("pending");
  });
  it("requires a staff administrator session for email retries", async () => {
    expect((await retryEmails(new Request("https://example.test/api/v1/workflow/retry-emails", { method: "POST" }))).status).toBe(403);
    mocks.context.mockReturnValue({ id: "one", role: "tenant_admin", name: "Admin", apiKeyId: "key" });
    expect((await retryEmails(new Request("https://example.test/api/v1/workflow/retry-emails", { method: "POST" }))).status).toBe(403);
  });
  it("cleans only expired transient rate-limit metadata", async () => {
    await mocks.store!.publicRateLimits.create({ id: "old", count: 10, resetAt: new Date(Date.now() - 2 * 86400000).toISOString() });
    await mocks.store!.publicRateLimits.create({ id: "live", count: 10, resetAt: new Date(Date.now() + 60000).toISOString() });
    await cleanWorkflowMetadata(mocks.store!);
    expect(await mocks.store!.publicRateLimits.get("old")).toBeNull();
    expect(await mocks.store!.publicRateLimits.get("live")).not.toBeNull();
    expect(await mocks.store!.tickets.get("t")).not.toBeNull();
  });
  it("does no retention queries after its time budget expires", async () => {
    const read = vi.spyOn(mocks.store!.publicRateLimits, "list");
    await cleanWorkflowMetadata(mocks.store!, Date.now(), Date.now() - 1);
    expect(read).not.toHaveBeenCalled();
  });
});

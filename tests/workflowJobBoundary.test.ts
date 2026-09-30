import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/server/data/memoryStore";
const mocks = vi.hoisted(() => ({ sweep: vi.fn(), store: null as MemoryStore | null }));
vi.mock("@/server/jobs/workflowMaintenance", () => ({ runWorkflowMaintenance: mocks.sweep }));
vi.mock("@/server/data", () => ({ getStore: async () => mocks.store }));
import { POST } from "../src/app/api/jobs/workflow/route";
import { sharedActionLimit } from "../src/server/sharedRateLimit";

beforeEach(() => { vi.unstubAllEnvs(); mocks.store = new MemoryStore(false); mocks.sweep.mockReset(); });
describe("public workflow boundaries", () => {
  it("requires the dedicated cron secret, not an integration key", async () => {
    vi.stubEnv("CRON_SECRET", "workflow-cron-unit-test-only-32-characters");
    for (const authorization of ["", "Bearer nlk_not-a-cron-secret", "Bearer incorrect"]) {
      expect((await POST(new Request("https://example.test/api/jobs/workflow", { method: "POST", headers: { authorization } }))).status).toBe(401);
    }
    expect(mocks.sweep).not.toHaveBeenCalled();
    mocks.sweep.mockResolvedValue({ skipped: false, complete: true });
    expect((await POST(new Request("https://example.test/api/jobs/workflow", { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }))).status).toBe(200);
    expect(mocks.sweep).toHaveBeenCalledOnce();
  });
  it("bounds concurrent confirmation attempts across callers sharing the store", async () => {
    vi.stubEnv("AUTH_SECRET", "workflow-rate-unit-test-only-32-characters");
    const request = new Request("https://example.test/api/account/ticket-confirmation", { headers: { "x-forwarded-for": "192.0.2.1" } });
    const results = await Promise.all(Array.from({ length: 15 }, () => sharedActionLimit(request, "confirmation")));
    expect(results.filter(Boolean)).toHaveLength(10);
    const records = await mocks.store!.publicRateLimits.list();
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain("192.0.2.1");
  });
});

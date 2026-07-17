import { describe, expect, it, vi } from "vitest";
import { evaluate } from "@/server/services/automationService";
import { runWithRetry, withJobLock } from "@/server/jobs/lock";
import { computeTrends } from "@/server/services/metricsService";
import { getStore } from "@/server/data";
import type { TicketRow } from "@/server/domain/models";

const ticket = {
  id: "t1",
  status: "open",
  priority: "high",
  category: "Network",
  subject: "VPN outage in Berlin",
  requesterEmail: "erin@customer.com",
} as unknown as TicketRow;

describe("automation condition evaluation", () => {
  it("legacy flat arrays behave as AND", () => {
    expect(evaluate(ticket, [
      { field: "status", op: "eq", value: "open" },
      { field: "category", op: "eq", value: "Network" },
    ])).toBe(true);
    expect(evaluate(ticket, [
      { field: "status", op: "eq", value: "open" },
      { field: "category", op: "eq", value: "HR" },
    ])).toBe(false);
  });

  it("supports {all, any} groups", () => {
    expect(evaluate(ticket, {
      all: [{ field: "status", op: "eq", value: "open" }],
      any: [
        { field: "category", op: "eq", value: "HR" },
        { field: "subject", op: "contains", value: "vpn" },
      ],
    })).toBe(true);

    expect(evaluate(ticket, {
      all: [{ field: "status", op: "eq", value: "closed" }],
      any: [{ field: "subject", op: "contains", value: "vpn" }],
    })).toBe(false);

    expect(evaluate(ticket, {
      any: [
        { field: "category", op: "eq", value: "HR" },
        { field: "priority", op: "eq", value: "low" },
      ],
    })).toBe(false);
  });

  it("treats empty/missing conditions as match-all", () => {
    expect(evaluate(ticket, [])).toBe(true);
    expect(evaluate(ticket, undefined)).toBe(true);
    expect(evaluate(ticket, {})).toBe(true);
  });
});

describe("job hardening", () => {
  it("runWithRetry retries transient failures then succeeds", async () => {
    let calls = 0;
    await runWithRetry(
      "test-job",
      async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
      },
      { attempts: 3, baseDelayMs: 1 }
    );
    expect(calls).toBe(3);
  });

  it("withJobLock refuses concurrent same-name runs in-process", async () => {
    let running = 0;
    let overlaps = 0;
    const job = () =>
      withJobLock("overlap-test", async () => {
        running++;
        if (running > 1) overlaps++;
        await new Promise((r) => setTimeout(r, 20));
        running--;
      });
    const [a, b] = await Promise.all([job(), job()]);
    // Exactly one of the two concurrent invocations runs.
    expect([a, b].filter(Boolean).length).toBe(1);
    expect(overlaps).toBe(0);
  });
});

describe("computeTrends", () => {
  it("buckets created/resolved per day over the window", async () => {
    const store = await getStore();
    const tenants = await store.tenants.list();
    const trends = await computeTrends(tenants[0].id, 14);
    expect(trends).toHaveLength(14);
    expect(trends[13].date).toBe(new Date().toISOString().slice(0, 10));
    const totalCreated = trends.reduce((sum, p) => sum + p.created, 0);
    expect(totalCreated).toBeGreaterThanOrEqual(0);
    for (const p of trends) {
      expect(p.slaMet + p.slaBreached).toBeLessThanOrEqual(p.resolved + p.autoResolved + p.resolved);
    }
  });
});

// Silence unused import warnings for vi (kept for future fake timers).
void vi;

import { describe, it, expect } from "vitest";
import { slaPausePatch, slaStatus, AT_RISK_FRACTION } from "@/server/services/slaService";
import type { TicketRow } from "@/server/domain/models";

function ticket(overrides: Partial<TicketRow>): TicketRow {
  const base: TicketRow = {
    id: "t1", reference: "INC-1", tenantId: "t", type: "incident", subject: "s", body: "b",
    status: "open", priority: "high", impact: "high", urgency: "medium", category: "IT",
    subcategory: null, channel: "portal", source: null, tags: [],
    customFields: null, requesterEmail: "x@y.com", requesterId: null, assigneeId: null,
    assignmentGroupId: null, problemId: null, changeId: null, catalogItemId: null, ciIds: [],
    linkedTicketIds: [], mergedIntoId: null,
    satisfaction: null, resolutionNotes: null,
    firstRespondedAt: null, resolvedAt: null, closedAt: null, dueResponseAt: null, dueResolveAt: null,
    slaPolicyId: null, slaPausedAt: null, slaPausedMins: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  return { ...base, ...overrides };
}

const MIN = 60_000;

// Spec TC4 — the SLA clock pauses while a ticket is pending and the due dates
// shift when it resumes.
describe("slaPausePatch", () => {
  it("stamps the pause when entering pending", () => {
    const now = Date.now();
    const patch = slaPausePatch(ticket({ status: "open" }), "pending", now);
    expect(patch.slaPausedAt).toBe(new Date(now).toISOString());
  });

  it("accumulates paused minutes and shifts due dates when leaving pending", () => {
    const now = Date.now();
    const pausedAt = new Date(now - 30 * MIN).toISOString();
    const dueResponse = new Date(now + 10 * MIN).toISOString();
    const dueResolve = new Date(now + 60 * MIN).toISOString();

    const patch = slaPausePatch(
      ticket({ status: "pending", slaPausedAt: pausedAt, dueResponseAt: dueResponse, dueResolveAt: dueResolve }),
      "in_progress",
      now
    );
    expect(patch.slaPausedAt).toBeNull();
    expect(patch.slaPausedMins).toBe(30);
    // Both deadlines move forward by the paused duration.
    expect(new Date(patch.dueResponseAt!).getTime()).toBe(new Date(dueResponse).getTime() + 30 * MIN);
    expect(new Date(patch.dueResolveAt!).getTime()).toBe(new Date(dueResolve).getTime() + 30 * MIN);
  });

  it("does nothing for transitions that don't touch pending", () => {
    expect(slaPausePatch(ticket({ status: "open" }), "in_progress")).toEqual({});
  });
});

describe("slaStatus with a paused clock", () => {
  it("freezes the clock at the pause timestamp (no breach while waiting)", () => {
    const now = Date.now();
    // Deadline passed 10 minutes ago, but the ticket paused 20 minutes ago.
    const s = slaStatus(
      ticket({
        status: "pending",
        slaPausedAt: new Date(now - 20 * MIN).toISOString(),
        dueResponseAt: new Date(now - 10 * MIN).toISOString(),
        dueResolveAt: new Date(now + 60 * MIN).toISOString(),
      }),
      now
    );
    expect(s.paused).toBe(true);
    expect(s.responseBreached).toBe(false);
  });

  it("flags at_risk once the elapsed fraction crosses the threshold", () => {
    const now = Date.now();
    // 90% of a 100-minute window consumed.
    const s = slaStatus(
      ticket({
        createdAt: new Date(now - 90 * MIN).toISOString(),
        firstRespondedAt: new Date(now - 85 * MIN).toISOString(),
        dueResponseAt: new Date(now - 80 * MIN).toISOString(),
        dueResolveAt: new Date(now + 10 * MIN).toISOString(),
      }),
      now
    );
    expect(s.level).toBe("at_risk");
    expect(s.elapsedFraction).toBeGreaterThanOrEqual(AT_RISK_FRACTION);
  });
});

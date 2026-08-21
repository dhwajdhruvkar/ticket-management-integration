import { describe, it, expect } from "vitest";
import { slaStatus } from "@/server/services/slaService";
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
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null,
  };
  return { ...base, ...overrides };
}

describe("slaStatus", () => {
  it("flags a breach when the response deadline has passed unanswered", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const s = slaStatus(ticket({ dueResponseAt: past, dueResolveAt: past, firstRespondedAt: null }));
    expect(s.responseBreached).toBe(true);
    expect(s.level).toBe("breached");
  });

  it("is on track when the deadline is comfortably in the future", () => {
    const future = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
    const s = slaStatus(ticket({ dueResponseAt: future, dueResolveAt: future }));
    expect(s.responseBreached).toBe(false);
    expect(["on_track", "at_risk"]).toContain(s.level);
  });

  it("counts as met once resolved within deadline", () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const s = slaStatus(
      ticket({ status: "resolved", resolvedAt: new Date().toISOString(), dueResponseAt: future, dueResolveAt: future, firstRespondedAt: new Date().toISOString() })
    );
    expect(s.level).toBe("met");
  });
});

import { describe, expect, it } from "vitest";
import { scoreGroups } from "@/server/services/routingRecommendation";
import type { ArticleRow, AssignmentGroupRow, TicketRow } from "@/server/domain/models";

const NOW = Date.parse("2026-10-01T00:00:00.000Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const text = "VPN fails on laptop from home";

function ticket(overrides: Partial<TicketRow> = {}): TicketRow {
  return { id: "current", tenantId: "org", type: "incident", subject: text, body: text, requesterEmail: "r@example.test", reference: "INC-1",
    status: "service_desk", priority: "medium", category: "Network", channel: "portal", tags: [], ciIds: [], linkedTicketIds: [], slaPausedMins: 0,
    createdAt: iso(NOW), updatedAt: iso(NOW), deletedAt: null, workflowVersion: 0, ...overrides } as TicketRow;
}
function resolved(id: string, groupId: string, overrides: Partial<TicketRow> = {}): TicketRow {
  return ticket({ id, reference: id.toUpperCase(), status: "resolved", assignmentGroupId: groupId, resolvedById: "agent", resolvedAt: iso(NOW - DAY),
    createdAt: iso(NOW - 2 * DAY), subject: text, body: text, ...overrides });
}
function group(id: string, name: string, categories: string[], memberIds: string[] = ["m"]): AssignmentGroupRow {
  return { id, tenantId: "org", name, memberIds, categories, createdAt: iso(NOW), updatedAt: iso(NOW) } as unknown as AssignmentGroupRow;
}
function article(id: string, category: string): ArticleRow {
  return { id, tenantId: "org", title: `Article ${id}`, category, status: "published", content: "x" } as unknown as ArticleRow;
}
const everyone = (groups: AssignmentGroupRow[], count = 1) => Object.fromEntries(groups.map((row) => [row.id, count]));

describe("scoreGroups", () => {
  it("ranks a group with similar resolved tickets above one without, and lists them as evidence", () => {
    const net = group("net", "Network Operations", ["Network"]);
    const other = group("other", "Other", ["Other"]);
    const history = [resolved("h1", "net"), resolved("h2", "net")];
    const result = scoreGroups({ ticket: ticket(), departmentGroups: [net, other], history, kbHits: [], availableCount: everyone([net, other]), now: NOW });
    expect(result.groups.map((row) => row.groupId)).toEqual(["net"]);
    expect(result.groups[0].evidence.tickets.map((row) => row.id).sort()).toEqual(["h1", "h2"]);
    expect(result.groups[0].reasons[0]).toBe("Resolved 2 similar tickets in this group");
  });

  it("ranks the group whose categories match a knowledge article on a KB-only signal", () => {
    const security = group("sec", "Security", ["Access"]);
    const network = group("net", "Network", ["Network"]);
    const result = scoreGroups({ ticket: ticket(), departmentGroups: [security, network], history: [], kbHits: [{ article: article("a1", "Access"), score: 0.8 }],
      availableCount: everyone([security, network]), now: NOW });
    // The ticket is Network-category, so that group also gets the 0.25 ownership bonus and ranks second.
    expect(result.groups.map((row) => row.groupId)).toEqual(["sec", "net"]);
    expect(result.groups[0]).toMatchObject({ groupId: "sec", score: 0.4, confidence: "low" });
    expect(result.groups[1]).toMatchObject({ groupId: "net", score: 0.25 });
    expect(result.groups[0].evidence.articles).toEqual([{ id: "a1", title: "Article a1" }]);
  });

  it("falls back to category mapping with low confidence on cold start, and returns no groups without any mapping", () => {
    const network = group("net", "Network", ["Network"]);
    const mapped = scoreGroups({ ticket: ticket(), departmentGroups: [network], history: [], kbHits: [], availableCount: everyone([network]), now: NOW });
    expect(mapped.groups).toEqual([expect.objectContaining({ groupId: "net", score: 0.25, confidence: "low", reasons: ["Group owns the Network category."] })]);
    const unmapped = scoreGroups({ ticket: ticket(), departmentGroups: [group("hr", "HR", ["HR"])], history: [], kbHits: [], availableCount: {}, now: NOW });
    expect(unmapped.groups).toEqual([]);
    expect(unmapped.recurring).toBeNull();
  });

  it("ignores other-tenant tickets and tickets without a recorded resolver", () => {
    const net = group("net", "Network", ["Other"]);
    const history = [resolved("foreign", "net", { tenantId: "other-org" }), resolved("unattributed", "net", { resolvedById: null })];
    const result = scoreGroups({ ticket: ticket(), departmentGroups: [net], history, kbHits: [], availableCount: everyone([net]), now: NOW });
    expect(result.groups).toEqual([]);
  });

  it("penalises a group with no available members below an otherwise equal group", () => {
    const alpha = group("alpha", "Alpha", ["Network"]);
    const bravo = group("bravo", "Bravo", ["Network"]);
    const history = [resolved("a1", "alpha"), resolved("b1", "bravo")];
    const result = scoreGroups({ ticket: ticket(), departmentGroups: [alpha, bravo], history, kbHits: [], availableCount: { alpha: 0, bravo: 2 }, now: NOW });
    expect(result.groups.map((row) => row.groupId)).toEqual(["bravo", "alpha"]);
    expect(result.groups[1].reasons).toContain("No member is available right now.");
    expect(result.groups[1].score).toBeLessThan(result.groups[0].score);
  });

  it("flags a recurring issue only when three similar tickets were raised in the last 30 days", () => {
    const net = group("net", "Network", ["Network"]);
    const recent = (id: string, problemId: string | null = null) => resolved(id, "net", { createdAt: iso(NOW - 5 * DAY), problemId });
    const three = scoreGroups({ ticket: ticket(), departmentGroups: [net], history: [recent("r1", "prb-7"), recent("r2"), recent("r3")], kbHits: [], availableCount: everyone([net]), now: NOW });
    expect(three.recurring).toEqual({ count: 3, problemId: "prb-7" });
    expect(three.groups[0].reasons).toContain("Recurring issue (3 similar in 30 days)");
    const two = scoreGroups({ ticket: ticket(), departmentGroups: [net], history: [recent("r1"), recent("r2")], kbHits: [], availableCount: everyone([net]), now: NOW });
    expect(two.recurring).toBeNull();
  });
});

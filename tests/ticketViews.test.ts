import { describe, expect, it } from "vitest";
import { searchTicketRows, isTicketViewId } from "@/lib/ticketViews";
import type { TicketRow } from "@/server/domain/models";

const t = (o: Partial<TicketRow>): TicketRow => ({
  id: "x", reference: "NL-1", subject: "Printer", requesterEmail: "a@x.com", status: "open", priority: "medium", category: "IT",
  assigneeId: null, assignmentGroupId: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...o,
}) as TicketRow;

const rows = [
  t({ id: "1", status: "open", assigneeId: "me", updatedAt: "2026-01-02T00:00:00.000Z" }),
  t({ id: "2", status: "open", reference: "NL-2", subject: "VPN down", updatedAt: "2026-01-05T00:00:00.000Z" }),
  t({ id: "3", status: "resolved", assigneeId: "me", updatedAt: "2026-01-04T00:00:00.000Z" }),
  t({ id: "4", status: "pending", priority: "high", updatedAt: "2026-01-03T00:00:00.000Z" }),
];

describe("ticket explorer views", () => {
  it("counts every view over all tickets regardless of filters/search", () => {
    const { counts } = searchTicketRows(rows, { meId: "me", view: "all", filters: { priority: "high" }, q: "vpn" });
    expect(counts).toMatchObject({ your_unsolved: 1, unassigned: 2, all_unsolved: 3, pending: 1, recently_solved: 1, all: 4 });
  });
  it("applies view, filters and search, keeping default order unless the view sorts", () => {
    expect(searchTicketRows(rows, { meId: "me", view: "all_unsolved", filters: {} }).rows.map((r) => r.id)).toEqual(["1", "2", "4"]);
    expect(searchTicketRows(rows, { meId: "me", view: "recently_updated", filters: {} }).rows.map((r) => r.id)).toEqual(["2", "3", "4", "1"]);
    expect(searchTicketRows(rows, { meId: "me", view: "all", filters: { priority: "high" } }).rows.map((r) => r.id)).toEqual(["4"]);
    expect(searchTicketRows(rows, { meId: "me", view: "all", filters: {}, q: "VPN" }).rows.map((r) => r.id)).toEqual(["2"]);
  });
  it("validates view ids", () => {
    expect(isTicketViewId("pending")).toBe(true);
    expect(isTicketViewId("constructor")).toBe(false);
  });
});

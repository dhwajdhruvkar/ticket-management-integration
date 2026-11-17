import { afterAll, describe, expect, it, vi } from "vitest";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mockAuth }));

import { POST as createTicketRoute } from "@/app/api/v1/tickets/route";
import { getStore } from "@/server/data";
import { ISSUE_CONTEXT_LIMITS, sanitizeIssueContext } from "@/shared/issueContext";

const session = { user: { id: "user_dana", name: "Dana Lee", email: "dana.lee@netlink.com", role: "requester", tenantId: "tenant_netlink" } };
const created: string[] = [];

async function create(extra: Record<string, unknown>) {
  mockAuth.mockResolvedValue(session);
  const res = await createTicketRoute(
    new Request("http://issue-context.test/api/v1/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "Screenshot context check", body: "The app shows an error dialog.", requesterEmail: "dana.lee@netlink.com", ...extra }),
    })
  );
  const json = (await res.json()) as { ok: boolean; data: { ticket?: { id: string }; id?: string } };
  expect(res.status, JSON.stringify(json)).toBeLessThan(300);
  const id = json.data.ticket?.id ?? json.data.id!;
  created.push(id);
  return (await (await getStore()).tickets.get(id))!;
}

// The requester's profile location is added by intake when the form sends none, so compare the parts this feature owns.
const ctxOf = (t: { customFields?: unknown }) => (t.customFields as { issueContext?: unknown } | null)?.issueContext ?? null;
const keysOf = (t: { customFields?: unknown }) => Object.keys((t.customFields as object | null) ?? {}).sort();

afterAll(async () => {
  const store = await getStore();
  for (const id of created) await store.tickets.remove(id);
});

describe("issueContext on ticket creation", () => {
  it("stores trimmed notes, occurredAt and activity in customFields.issueContext", async () => {
    const ticket = await create({ issueContext: { notes: "  Error 0x80070005 after clicking Save  ", occurredAt: "2026-11-17T09:30:00Z", activity: "Saving a report" } });
    expect(ctxOf(ticket)).toEqual({ notes: "Error 0x80070005 after clicking Save", occurredAt: "2026-11-17T09:30:00Z", activity: "Saving a report" });
  });

  it("drops over-long and invalid fields but keeps the valid ones", async () => {
    const ticket = await create({
      issueContext: { notes: "x".repeat(ISSUE_CONTEXT_LIMITS.notes + 1), occurredAt: "yesterday-ish", activity: "Printing", extra: "ignored" },
    });
    expect(ctxOf(ticket)).toEqual({ activity: "Printing" });
  });

  it("stores nothing when no usable field is sent, and ignores non-object values", async () => {
    for (const issueContext of [undefined, null, "notes", ["a"], 7, {}, { notes: "   ", occurredAt: 5 }, { unknown: "x" }]) {
      expect(ctxOf(await create({ issueContext }))).toBeNull();
    }
  });

  it("never accepts other customFields from the caller", async () => {
    const ticket = await create({ customFields: { isAdmin: true }, issueContext: { notes: "ok" } });
    expect(ctxOf(ticket)).toEqual({ notes: "ok" });
    expect(keysOf(ticket).every((key) => ["issueContext", "requesterLocation"].includes(key))).toBe(true); // no isAdmin
  });

  it("keeps requesterLocation working, alone and together with issueContext", async () => {
    expect((await create({ requesterLocation: "Pune HQ" })).customFields).toEqual({ requesterLocation: "Pune HQ" });
    const both = await create({ requesterLocation: "Pune HQ", issueContext: { notes: "n" } });
    expect(both.customFields).toEqual({ requesterLocation: "Pune HQ", issueContext: { notes: "n" } });
  });
});

describe("sanitizeIssueContext", () => {
  it("enforces the documented limits at the boundary", () => {
    expect(sanitizeIssueContext({ notes: "n".repeat(ISSUE_CONTEXT_LIMITS.notes) })?.notes).toHaveLength(ISSUE_CONTEXT_LIMITS.notes);
    expect(sanitizeIssueContext({ activity: "a".repeat(ISSUE_CONTEXT_LIMITS.activity + 1) })).toBeNull();
    expect(sanitizeIssueContext({ occurredAt: "2026-11-17" })).toEqual({ occurredAt: "2026-11-17" });
    expect(sanitizeIssueContext({ occurredAt: "2026-13-45" })).toBeNull();
    expect(sanitizeIssueContext({ occurredAt: "2026-11-17T09:30:00Z".padEnd(41, "0") })).toBeNull();
  });
});

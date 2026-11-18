import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mockAuth }));

import { GET as listTickets, POST as postTicket } from "@/app/api/v1/tickets/route";
import { getStore } from "@/server/data";
import type { TicketRow } from "@/server/domain/models";
import { createTicket } from "@/server/services/ticketService";
import { intakeTicket } from "@/server/services/intake";
import { normalizeEmail } from "@/shared/email";
import { bucketOf, BUCKET_STATUSES, compareRequesterTickets } from "@/shared/requesterBuckets";

const BASE = "http://requester-list.test/api/v1";
const T1 = "tenant_netlink";
// Unique addresses: the seed already holds tickets for the demo requesters.
const DANA = "rq.owner@netlink.com";
const SAM = "rq.other@netlink.com";
const session = (id: string, role: string, email: string) => ({ user: { id, name: id, email, role, tenantId: T1 } });
const get = (query: string) => new Request(`${BASE}/tickets?mode=requests&${query}`);
const mk = (n: number, over: Partial<TicketRow> = {}): TicketRow => ({
  id: `rq-${String(n).padStart(3, "0")}`, reference: `RQ-${n}`, tenantId: T1, type: "incident", subject: `Request ${n}`, body: "b", requesterEmail: DANA,
  status: "open", priority: "medium", category: "IT", channel: "portal", tags: [], ciIds: [], linkedTicketIds: [], slaPausedMins: 0,
  createdAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(), updatedAt: new Date(Date.UTC(2026, 10, 2, 0, n)).toISOString(), deletedAt: null, workflowVersion: 0, assigneeId: null, ...over,
}) as TicketRow;

const fetch_ = (body: unknown) => postTicket(new Request(`${BASE}/tickets`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.77" }, body: JSON.stringify(body) }));
const POST_body = (b: unknown) => b;
const json_ = (res: Response) => json(res);

interface Page { ok: boolean; data: TicketRow[]; meta: { total: number; totalPages: number; counts: Record<string, number> }; error?: string }
const json = async (res: Response) => (await res.json()) as Page;
const created: string[] = [];

describe.sequential("GET /tickets?mode=requests (server-side My requests)", () => {
  beforeAll(async () => {
    const store = await getStore();
    const rows = [
      ...Array.from({ length: 40 }, (_, i) => mk(i + 1)), // 40 open
      mk(41, { status: "pending", subject: "Waiting for you", priority: "critical" }),
      mk(42, { status: "pending_agent", category: "HR", subcategory: "Payroll" }),
      mk(43, { status: "resolved" }),
      mk(44, { status: "auto_resolved", priority: "high" }),
      mk(45, { status: "closed" }),
      mk(46, { status: "cancelled" }),
      mk(47, { status: "escalated", priority: "high" }),
      mk(48, { status: "reopened" }),
      mk(49, { status: "open", deletedAt: "2026-11-03T00:00:00.000Z" }),
      mk(50, { requesterEmail: SAM, subject: "Sam private request" }),
    ];
    for (const t of rows) { await store.tickets.create(t); created.push(t.id); }
  });
  afterAll(async () => {
    const store = await getStore();
    for (const id of created) await store.tickets.remove(id);
  });

  it("returns only the signed-in requester's own, non-deleted tickets, a page at a time", async () => {
    mockAuth.mockResolvedValue(session("user_dana", "requester", DANA));
    const first = await json(await listTickets(get("pageSize=30&page=1")));
    expect(first.ok).toBe(true);
    expect(first.data).toHaveLength(30);
    expect(first.meta.total).toBe(48);
    expect(first.meta.totalPages).toBe(2);
    expect(first.data.every((t) => t.requesterEmail === DANA && !t.deletedAt)).toBe(true);
    const second = await json(await listTickets(get("pageSize=30&page=2")));
    expect(second.data).toHaveLength(18);
    const ids = [...first.data, ...second.data].map((t) => t.id);
    expect(new Set(ids).size).toBe(48); // no duplicates or gaps across pages
    expect(ids).not.toContain("rq-050"); // another requester's ticket
    expect(ids).not.toContain("rq-049"); // soft-deleted
  });

  it("KPI counts cover all of the requester's tickets, not just the loaded page", async () => {
    mockAuth.mockResolvedValue(session("user_dana", "requester", DANA));
    const res = await json(await listTickets(get("pageSize=5")));
    expect(res.data).toHaveLength(5);
    expect(res.meta.counts).toEqual({ all: 48, open: 41, waiting: 2, resolved: 2, escalated: 1, closed: 2 });
    // Counts ignore the bucket and search narrowing; total follows it.
    const narrowed = await json(await listTickets(get("bucket=waiting&q=payroll&pageSize=5")));
    expect(narrowed.meta.counts.all).toBe(48);
    expect(narrowed.meta.total).toBe(1);
    expect(narrowed.data.map((t) => t.id)).toEqual(["rq-042"]);
  });

  it("filters by bucket with the same rules as the client buckets", async () => {
    mockAuth.mockResolvedValue(session("user_dana", "requester", DANA));
    const ids = async (bucket: string) => (await json(await listTickets(get(`bucket=${bucket}&pageSize=100`)))).data.map((t) => t.id).sort();
    expect(await ids("waiting")).toEqual(["rq-041", "rq-042"]);
    expect(await ids("resolved")).toEqual(["rq-043", "rq-044"]);
    expect(await ids("closed")).toEqual(["rq-045", "rq-046"]);
    expect(await ids("escalated")).toEqual(["rq-047"]);
    expect((await ids("open")).length).toBe(41); // includes reopened
    expect(await ids("all")).toHaveLength(48);
  });

  it("searches subject, reference, category and subcategory case-insensitively, and treats % and _ literally", async () => {
    mockAuth.mockResolvedValue(session("user_dana", "requester", DANA));
    const found = async (q: string) => (await json(await listTickets(get(`q=${encodeURIComponent(q)}&pageSize=100`)))).data.map((t) => t.id).sort();
    expect(await found("WAITING FOR")).toEqual(["rq-041"]);
    expect(await found("rq-43")).toEqual(["rq-043"]);
    expect(await found("payroll")).toEqual(["rq-042"]);
    expect(await found("hr")).toEqual(["rq-042"]);
    expect(await found("sam private")).toEqual([]); // never reaches another requester's tickets
    expect(await found("%")).toEqual([]);
    expect(await found("_")).toEqual([]);
  });

  it("sorts recent (default), oldest and by priority with stable ties", async () => {
    mockAuth.mockResolvedValue(session("user_dana", "requester", DANA));
    const order = async (sort: string) => (await json(await listTickets(get(`sort=${sort}&pageSize=100`)))).data.map((t) => t.id);
    const recent = await order("recent");
    expect(recent[0]).toBe("rq-048"); // newest updatedAt
    expect(recent.at(-1)).toBe("rq-001");
    const oldest = await order("oldest");
    expect(oldest[0]).toBe("rq-001");
    expect(oldest.at(-1)).toBe("rq-048");
    const priority = await order("priority");
    expect(priority.slice(0, 3)).toEqual(["rq-041", "rq-047", "rq-044"]); // critical, then high newest-first
    expect(priority.at(-1)).toBe("rq-001"); // medium, oldest update last
  });

  it("scopes agents to tickets they themselves raised, never the whole tenant", async () => {
    mockAuth.mockResolvedValue(session("user_agent", "agent", "agent.nobody@netlink.com"));
    const res = await json(await listTickets(get("pageSize=100")));
    expect(res.data.every((t) => t.requesterEmail === "agent.nobody@netlink.com")).toBe(true);
    expect(res.meta.total).toBe(0);
  });

  it("another requester sees only their own", async () => {
    mockAuth.mockResolvedValue(session("user_sam", "requester", SAM));
    const res = await json(await listTickets(get("pageSize=100")));
    expect(res.data.map((t) => t.id)).toEqual(["rq-050"]);
    expect(res.meta.counts.all).toBe(1);
  });

  it("rejects unknown buckets and sorts", async () => {
    mockAuth.mockResolvedValue(session("user_dana", "requester", DANA));
    expect((await listTickets(get("bucket=everything"))).status).toBe(400);
    expect((await listTickets(get("sort=random"))).status).toBe(400);
  });
});

describe("requester bucket rules", () => {
  it("bucketOf agrees with BUCKET_STATUSES and defaults everything else to open", () => {
    for (const [bucket, statuses] of Object.entries(BUCKET_STATUSES)) for (const status of statuses) expect(bucketOf(status)).toBe(bucket);
    for (const status of ["new", "open", "in_progress", "reopened", "anything-else"]) expect(bucketOf(status)).toBe("open");
  });

  it("compareRequesterTickets orders deterministically", () => {
    const a = { id: "a", priority: "high", createdAt: "2026-01-01", updatedAt: "2026-01-02" };
    const b = { id: "b", priority: "high", createdAt: "2026-01-01", updatedAt: "2026-01-02" };
    const c = { id: "c", priority: "low", createdAt: "2026-01-03", updatedAt: "2026-01-04" };
    expect([c, b, a].sort(compareRequesterTickets("recent")).map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect([c, b, a].sort(compareRequesterTickets("priority")).map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect([c, b, a].sort(compareRequesterTickets("oldest")).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe.sequential("requester email normalization", () => {
  const created: string[] = [];
  afterAll(async () => { const store = await getStore(); for (const id of created) await store.tickets.remove(id); });

  it("creation stores the address trimmed and lowercased, whichever path made the ticket", async () => {
    const viaService = await createTicket(T1, { subject: "norm service", body: "b", requesterEmail: "  Norm.One@Example.COM " });
    const viaIntake = await intakeTicket(T1, { subject: "norm intake", body: "b", requesterEmail: "NORM.TWO@Example.com", autoResolve: false });
    created.push(viaService.id, viaIntake.id);
    expect(viaService.requesterEmail).toBe("norm.one@example.com");
    expect(viaIntake.requesterEmail).toBe("norm.two@example.com");
    expect(normalizeEmail("  A@B.C ")).toBe("a@b.c");
  });

  it("the POST route and the list both treat different casings as one requester", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user_norm", name: "Norm", email: "Mixed.Case@netlink.com", role: "requester", tenantId: T1 } });
    const res = await fetch_(POST_body({ subject: "norm post", body: "b", requesterEmail: "other@netlink.com" }));
    const json = (await res.json()) as { data: { id: string; requesterEmail: string } };
    created.push(json.data.id);
    expect(json.data.requesterEmail).toBe("mixed.case@netlink.com"); // requesters always file as themselves, normalized
    const list = await json_(await listTickets(get("pageSize=50")));
    expect(list.data.map((t) => t.id)).toContain(json.data.id);
  });

  it("legacy mixed-case rows still belong to the requester: list, search, buckets and plain list", async () => {
    const store = await getStore();
    const legacy = [
      mk(901, { requesterEmail: "Legacy.Owner@Netlink.COM", subject: "Legacy upper", status: "open" }),
      mk(902, { requesterEmail: "legacy.owner@netlink.com", subject: "Legacy lower", status: "resolved" }),
      mk(903, { requesterEmail: "LEGACY.OWNER@NETLINK.COM", subject: "Legacy shout", status: "pending" }),
      mk(904, { requesterEmail: "legacy.owner@netlink.com", subject: "Legacy foreign tenant", tenantId: "tenant_verify_other" }),
    ];
    for (const t of legacy) { await store.tickets.create(t); created.push(t.id); }
    mockAuth.mockResolvedValue(session("user_legacy", "requester", "legacy.owner@netlink.com"));
    const all = await json(await listTickets(get("pageSize=50")));
    expect(all.data.map((t) => t.id).sort()).toEqual(["rq-901", "rq-902", "rq-903"]); // not the other tenant's rq-904
    expect(all.meta.counts).toMatchObject({ all: 3, open: 1, waiting: 1, resolved: 1 });
    expect((await json(await listTickets(get("q=legacy%20shout&pageSize=50")))).data.map((t) => t.id)).toEqual(["rq-903"]);
    expect((await json(await listTickets(get("bucket=resolved&pageSize=50")))).data.map((t) => t.id)).toEqual(["rq-902"]);
    // The classic list path (no mode) applies the same case-insensitive ownership.
    const plain = (await (await listTickets(new Request(`${BASE}/tickets?pageSize=50`))).json()) as Page;
    expect(plain.data.map((t) => t.id).sort()).toEqual(["rq-901", "rq-902", "rq-903"]);
    // Another requester never sees them.
    mockAuth.mockResolvedValue(session("user_other", "requester", "someone.else@netlink.com"));
    expect((await json(await listTickets(get("pageSize=50")))).data.map((t) => t.id)).toEqual([]);
  });
});

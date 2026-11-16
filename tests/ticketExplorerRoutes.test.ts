import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mockAuth }));

import { GET as listTickets } from "@/app/api/v1/tickets/route";
import { GET as workflowAlerts } from "@/app/api/v1/workflow/alerts/route";
import { getStore } from "@/server/data";
import { config } from "@/server/config";
import type { TicketRow } from "@/server/domain/models";

const BASE = "http://explorer-routes.test/api/v1";
const T1 = "tenant_netlink";
const T2 = "tenant_verify_other";
const STAMP = "2026-11-01T00:00:00.000Z";

const session = (id: string, role: string, email: string, tenantId = T1) => ({ user: { id, name: id, email, role, tenantId } });
const get = (path: string, headers: Record<string, string> = {}) => new Request(`${BASE}${path}`, { headers });
const ticket = (id: string, over: Partial<TicketRow>): TicketRow => ({
  id, reference: `VER-${id}`, tenantId: T1, type: "incident", subject: `verify ${id}`, body: "b", requesterEmail: "dana.lee@netlink.com",
  status: "open", priority: "medium", category: "IT", channel: "portal", tags: [], ciIds: [], linkedTicketIds: [], slaPausedMins: 0,
  createdAt: STAMP, updatedAt: STAMP, deletedAt: null, workflowVersion: 0, assigneeId: null, ...over,
}) as TicketRow;

const created: string[] = [];
describe.sequential("explorer + alert routes: authorization and input handling", () => {
  beforeAll(async () => {
    const store = await getStore();
    await store.tenants.create({ id: T2, name: "Other", slug: "verify-other", isInternal: false, createdAt: STAMP, updatedAt: STAMP } as never);
    await store.users.create({ id: "verify_other_agent", tenantId: T2, name: "Other Agent", email: "agent@other.test", role: "agent", active: true, createdAt: STAMP, updatedAt: STAMP } as never);
    for (const t of [
      ticket("mine-dana", { requesterEmail: "dana.lee@netlink.com", subject: "verify dana only" }),
      ticket("mine-sam", { requesterEmail: "sam.patel@netlink.com", subject: "verify sam only" }),
      ticket("deleted-dana", { requesterEmail: "dana.lee@netlink.com", deletedAt: STAMP }),
      ticket("foreign", { tenantId: T2, requesterEmail: "dana.lee@netlink.com", subject: "verify foreign tenant" }),
    ]) { await store.tickets.create(t); created.push(t.id); }
  });
  afterAll(async () => {
    const store = await getStore();
    for (const id of created) await store.tickets.remove(id);
    await store.users.remove("verify_other_agent");
    await store.tenants.remove(T2);
  });

  const json = async (res: Response) => (await res.json()) as { ok: boolean; data: TicketRow[]; meta?: { total: number; counts?: Record<string, number> }; error?: string };

  it("rejects an inactive/none-role session and an invalid API key", async () => {
    mockAuth.mockResolvedValue(session("user_arjun", "none", "arjun.mehta@netlink.com"));
    expect((await listTickets(get("/tickets?view=all"))).status).toBe(403);
    expect((await workflowAlerts(get("/workflow/alerts"))).status).toBe(403);
    mockAuth.mockResolvedValue(null);
    // With no session and no API key the actor depends on DEMO_MODE: staff-level in demo mode, nothing otherwise.
    const anonymous = await listTickets(get("/tickets?view=all"));
    expect(anonymous.status, `DEMO_MODE=${config.demoMode}`).toBe(config.demoMode ? 200 : 403);
    expect((await listTickets(get("/tickets?view=all", { authorization: "Bearer nlk_invalid_key_000" }))).status).toBe(401);
    expect((await workflowAlerts(get("/workflow/alerts", { authorization: "Bearer nlk_invalid_key_000" }))).status).toBe(401);
  });

  it("blocks a deactivated staff user (valid role in the session, inactive in the database) from workflow alerts", async () => {
    const store = await getStore();
    await store.users.update("user_arjun", { active: false });
    try {
      mockAuth.mockResolvedValue(session("user_arjun", "agent", "arjun.mehta@netlink.com"));
      expect((await workflowAlerts(get("/workflow/alerts"))).status).toBe(403);
    } finally { await store.users.update("user_arjun", { active: true }); }
  });

  it("scopes requesters to their own tickets, including counts, and ignores attempts to widen the scope", async () => {
    mockAuth.mockResolvedValue(session("user_dana", "requester", "dana.lee@netlink.com"));
    for (const q of ["/tickets?view=all", "/tickets?view=all&requesterEmail=sam.patel@netlink.com", "/tickets?view=all&assignee=unassigned&group=x", "/tickets?view=all&q=sam"]) {
      const body = await json(await listTickets(get(q)));
      expect(body.ok, q).toBe(true);
      expect(body.data.every((t) => t.requesterEmail.toLowerCase() === "dana.lee@netlink.com" && t.tenantId === T1 && !t.deletedAt), q).toBe(true);
    }
    const all = await json(await listTickets(get("/tickets?view=all&pageSize=100")));
    expect(all.meta?.counts?.all).toBe(all.meta?.total); // counts cover only the requester's own tickets
    expect(all.data.map((t) => t.id)).toContain("mine-dana");
    expect(all.data.map((t) => t.id)).not.toContain("mine-sam");
    expect(all.data.map((t) => t.id)).not.toContain("foreign");
    expect(all.data.map((t) => t.id)).not.toContain("deleted-dana");
    // A requester has no report.read, so no workflow alerts.
    expect((await workflowAlerts(get("/workflow/alerts"))).status).toBe(403);
  });

  it("isolates tenants for staff in both directions", async () => {
    mockAuth.mockResolvedValue(session("user_priya", "tenant_admin", "priya.sharma@netlink.com"));
    const mine = await json(await listTickets(get("/tickets?view=all&pageSize=100")));
    expect(mine.data.every((t) => t.tenantId === T1)).toBe(true);
    expect(mine.data.map((t) => t.id)).not.toContain("foreign");
    mockAuth.mockResolvedValue(session("verify_other_agent", "agent", "agent@other.test", T2));
    const theirs = await json(await listTickets(get("/tickets?view=all&pageSize=100")));
    expect(theirs.data.map((t) => t.id)).toEqual(["foreign"]);
    expect(theirs.meta?.counts?.all).toBe(1);
  });

  it("rejects invalid view and pagination parameters, and treats odd filter values as non-matching or ignored", async () => {
    mockAuth.mockResolvedValue(session("user_priya", "tenant_admin", "priya.sharma@netlink.com"));
    for (const q of ["view=bogus", "view=constructor", "view=__proto__", "view=toString", "view=all&pageSize=101", "view=all&page=0", "view=all&pageSize=abc", "view=all&sortBy=password", "view=all&pageSize=5&limit=6"]) {
      const res = await listTickets(get(`/tickets?${q}`));
      expect(res.status, q).toBe(400);
    }
    // Inputs that look like SQL are treated as plain text (the memory driver here; PostgreSQL is covered in prismaPostgres.integration.test.ts).
    for (const q of [`q=${encodeURIComponent(`'; DROP TABLE "Ticket"; --`)}`, `status=${encodeURIComponent("open' OR '1'='1")}`, `group=${encodeURIComponent("x' OR 1=1 --")}`]) {
      const res = await listTickets(get(`/tickets?view=all&${q}`));
      expect(res.status, q).toBe(200);
      expect((await json(res)).data.length, q).toBe(0);
    }
    // An unknown workflow phase is ignored by filtersFromParams (never reaches SQL).
    const phaseIgnored = await json(await listTickets(get(`/tickets?view=all&pageSize=100&phase=${encodeURIComponent("' OR 1=1")}`)));
    expect(phaseIgnored.meta?.total).toBe((await json(await listTickets(get("/tickets?view=all&pageSize=100")))).meta?.total);
    // Documented behaviour: invalid priority/category/sla values are ignored (unfiltered), not rejected.
    const ignored = await json(await listTickets(get("/tickets?view=all&priority=bogus&category=bogus&sla=bogus&pageSize=100")));
    const plain = await json(await listTickets(get("/tickets?view=all&pageSize=100")));
    expect(ignored.meta?.total).toBe(plain.meta?.total);
  });

  it("keeps the plain list contract (no ?view=) unchanged: no counts in meta, full rows", async () => {
    mockAuth.mockResolvedValue(session("user_priya", "tenant_admin", "priya.sharma@netlink.com"));
    const body = await json(await listTickets(get("/tickets?pageSize=5")));
    expect(body.meta?.counts).toBeUndefined();
    expect(body.data.length).toBeGreaterThan(0);
    expect("body" in body.data[0]).toBe(true);
  });
});

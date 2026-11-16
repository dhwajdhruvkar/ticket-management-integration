// Runs the REAL PrismaStore (real Prisma client, real migrations) against a
// PostgreSQL engine and checks it against the MemoryStore on the same data.
//
// Needs PGLITE_DIR: a directory with @electric-sql/pglite, pglite-socket and
// pglite-pgvector installed (none are project dependencies). Without it the
// suite is skipped; it is never run against a hosted database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaStore } from "@/server/data/prismaStore";
import { MemoryStore } from "@/server/data/memoryStore";
import type { TicketSearchSpec } from "@/server/data/store";
import { ticketSearchQueries } from "@/server/data/ticketSql";
import { TICKET_VIEW_RULES, type TicketViewId } from "@/lib/ticketViews";
import { slaStateOf, type TicketFilters } from "@/lib/ticketFilters";
import { getWorkflowAlerts } from "@/server/services/workflowBoard";
import { defaultWorkflowSettings } from "@/shared/workflow";
import type { TicketRow, UserRow } from "@/server/domain/models";
import { buildFixture } from "./helpers/ticketFixture";

const DIR = process.env.PGLITE_DIR;
const PORT = 54331;
const STAMP = "2026-09-30T09:00:00.000Z";

async function importFrom(pkg: string, file: string) {
  return import(pathToFileURL(path.join(DIR!, "node_modules", pkg, file)).href);
}

describe.skipIf(!DIR)("PrismaStore on real PostgreSQL vs MemoryStore", () => {
  let prisma: PrismaClient;
  let pg: PrismaStore;
  let mem: MemoryStore;
  let stop: () => Promise<void>;
  let fixtureNow: Date;

  beforeAll(async () => {
    const { PGlite } = await importFrom("@electric-sql/pglite", "dist/index.js");
    const { vector } = await importFrom("@electric-sql/pglite-pgvector", "dist/index.js");
    const { pgcrypto } = await importFrom("@electric-sql/pglite", "dist/contrib/pgcrypto.js");
    const { PGLiteSocketServer } = await importFrom("@electric-sql/pglite-socket", "dist/index.js");
    const db = await PGlite.create({ extensions: { vector, pgcrypto } });
    const migrations = path.join(process.cwd(), "prisma/migrations");
    for (const m of fs.readdirSync(migrations).sort()) {
      const file = path.join(migrations, m, "migration.sql");
      if (fs.existsSync(file)) await db.exec(fs.readFileSync(file, "utf8"));
    }
    const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
    await server.start();
    prisma = new PrismaClient({ datasources: { db: { url: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?connection_limit=1&sslmode=disable` } } });
    pg = new PrismaStore(prisma);
    mem = new MemoryStore(false);
    stop = async () => { await prisma.$disconnect(); await server.stop(); await db.close(); };

    // Same tenants/users/groups in both stores.
    for (const store of [pg, mem]) {
      for (const id of ["org", "other"]) await store.tenants.create({ id, name: id, slug: id, isInternal: false, createdAt: STAMP, updatedAt: STAMP, workflowSettings: id === "org" ? { ...defaultWorkflowSettings(), enabled: true } : undefined } as never);
      for (const [id, role] of [["u1", "agent"], ["u2", "agent"], ["admin", "tenant_admin"], ["mgr", "manager"], ["solo", "agent"]]) {
        await store.users.create({ id, tenantId: "org", name: id, email: `${id}@example.test`, role, active: true, createdAt: STAMP, updatedAt: STAMP } as UserRow);
      }
      for (const [id, memberIds] of [["g1", ["u1"]], ["g2", ["u2"]]] as const) await store.groups.create({ id, tenantId: "org", name: id, memberIds: [...memberIds], categories: [], createdAt: STAMP, updatedAt: STAMP });
    }
    fixtureNow = new Date();
    // A foreign-keyed '' assignee cannot exist in PostgreSQL, so normalise it away in both stores.
    const rows = buildFixture(fixtureNow).map((t) => ({ ...t, assigneeId: t.assigneeId || null, body: "b", tenantId: t.tenantId === "other" ? "other" : "org" }));
    for (const t of rows) {
      const { workflow, ...rest } = t;
      await prisma.ticket.create({ data: { ...rest, workflow: workflow ?? Prisma.DbNull } as never });
      await mem.tickets.create(t as TicketRow);
    }
    // A JSON-null workflow (distinct from SQL NULL) in Postgres; plain null in memory.
    const jn = { ...rows[1], id: "jsonnull", reference: "NL-JSONNULL", tenantId: "org", deletedAt: null, status: "open", workflow: null };
    await prisma.ticket.create({ data: { ...jn, workflow: Prisma.JsonNull } as never });
    await mem.tickets.create(jn as unknown as TicketRow);
  }, 120_000);

  afterAll(async () => { await stop?.(); });

  const FILTERS: TicketFilters[] = [
    {}, { priority: "high" }, { groupId: "g1" }, { assigneeId: "unassigned" }, { assigneeId: "u1" }, { category: "IT" }, { assigned: true },
    { phase: "department" }, { escalated: true }, { overdue: true }, { slaState: "breached" }, { slaState: "at_risk" },
    { slaState: "on_track" }, { slaState: "paused" }, { slaState: "met" }, { category: "Network", overdue: true, assigned: true },
  ];

  async function expectSame(spec: TicketSearchSpec, label: string) {
    const [a, b] = [await pg.searchTickets("org", spec), await mem.searchTickets("org", spec)];
    expect(a.data.map((t) => t.id), label).toEqual(b.data.map((t) => t.id));
    expect(a.total, label).toBe(b.total);
    expect(a.counts, label).toEqual(b.counts);
    return a;
  }

  it("matches the MemoryStore for every view x filter x search through the real Prisma client", async () => {
    let nonEmpty = 0;
    for (const view of Object.keys(TICKET_VIEW_RULES) as TicketViewId[]) {
      for (const filters of FILTERS) {
        for (const q of [undefined, "vpn", "B@X.COM", "nl-1002", "50%", "slower_login", "zzz-none"]) {
          const res = await expectSame({ scope: {}, meId: "u1", view, filters, q, skip: 0, take: 1000 }, JSON.stringify({ view, filters, q }));
          if (res.total > 0) nonEmpty++;
        }
      }
    }
    expect(nonEmpty).toBeGreaterThan(100); // not vacuous
  }, 120_000);

  it("pages consistently, honours scope, excludes deleted and foreign tickets, omits body", async () => {
    const seen: string[] = [];
    for (let skip = 0; ; skip += 7) {
      const page = await pg.searchTickets("org", { scope: {}, meId: "u1", view: "all", filters: {}, skip, take: 7 });
      if (!page.data.length) break;
      seen.push(...page.data.map((t) => t.id));
      expect(page.data.every((t) => t.tenantId === "org" && !t.deletedAt)).toBe(true);
      expect(page.data.every((t) => !("body" in t))).toBe(true);
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength((await pg.searchTickets("org", { scope: {}, meId: "u1", view: "all", filters: {}, skip: 0, take: 1 })).total);
    for (const scope of [{ requesterEmail: "a@x.com" }, { assigneeId: null }, { status: "open" as const }, { assignmentGroupId: "g1" }, { status: "bogus" as never }]) {
      await expectSame({ scope, meId: "u1", view: "all_unsolved", filters: {}, skip: 0, take: 100 }, JSON.stringify(scope));
    }
    expect((await pg.searchTickets("org", { scope: {}, meId: "u1", view: "all", filters: {}, skip: 10_000, take: 10 })).data).toEqual([]);
  });

  it("is unaffected by SQL-injection attempts in search, filters and scope", async () => {
    const before = await prisma.ticket.count();
    const evil = [`'; DROP TABLE "Ticket"; --`, `" OR 1=1 --`, "%", "_", "\\", `x') OR ('1'='1`, "\u0000", "Robert'); DELETE FROM \"Ticket\";--"];
    for (const text of evil) {
      const spec: TicketSearchSpec = { scope: { requesterEmail: text }, meId: text, view: "all", filters: { priority: text, groupId: text, assigneeId: text, category: text, phase: text }, q: text, skip: 0, take: 10 };
      const res = await pg.searchTickets("org", { ...spec, scope: {}, meId: "u1" }).catch((e) => e as Error);
      // NUL bytes are rejected by PostgreSQL itself; anything else must simply match nothing.
      if (res instanceof Error) expect(text).toBe("\u0000");
      else expect(res.total).toBe(0);
      for (const f of [{ q: text }, { filters: { phase: text } }, { filters: { priority: text } }, { scope: { status: text as never } }]) {
        const r = await pg.searchTickets("org", { scope: {}, meId: "u1", view: "all", filters: {}, skip: 0, take: 10, ...f }).catch((e) => e as Error);
        if (r instanceof Error) continue;
        // "%", "_" and "\\" appear literally in some fixture subjects; they must match exactly those rows (no wildcard behaviour), same as the JS rules.
        const m = await mem.searchTickets("org", { scope: {}, meId: "u1", view: "all", filters: {}, skip: 0, take: 10, ...f });
        expect(r.total, JSON.stringify(f)).toBe(m.total);
        if (!["%", "_", "\\"].includes(text)) expect(r.total, JSON.stringify(f)).toBe(0);
      }
    }
    expect(await prisma.ticket.count()).toBe(before);
  });

  it("gives the same answers under a non-UTC session time zone", async () => {
    await prisma.$executeRawUnsafe(`SET TIME ZONE 'Asia/Kolkata'`);
    try {
      for (const filters of [{ slaState: "breached" as const }, { slaState: "at_risk" as const }, { overdue: true }, { slaState: "met" as const }]) {
        await expectSame({ scope: {}, meId: "u1", view: "all", filters, skip: 0, take: 1000 }, `tz ${JSON.stringify(filters)}`);
      }
    } finally { await prisma.$executeRawUnsafe(`SET TIME ZONE 'UTC'`); }
  });

  it("evaluates SLA at-risk / breached boundaries exactly like slaStateOf (millisecond precision)", async () => {
    const at = new Date("2027-01-01T00:00:00.000Z");
    const created = at.getTime() - 800_000; // 1,000,000 ms lifetime -> 80% elapsed exactly at `at`
    const mk = (id: string, createdMs: number, dueMs: number, extra: Partial<TicketRow> = {}) => ({
      id, reference: `NL-B-${id}`, tenantId: "boundary", subject: id, body: "b", requesterEmail: "b@x.com", status: "open", priority: "low", category: "IT", type: "incident",
      createdAt: new Date(createdMs).toISOString(), updatedAt: new Date(createdMs).toISOString(), dueResponseAt: new Date(dueMs).toISOString(), slaPausedMins: 0, workflowVersion: 0, ...extra,
    });
    await prisma.tenant.create({ data: { id: "boundary", name: "b", slug: "boundary", isInternal: false } as never });
    const cases = [
      mk("exact80", created, created + 1_000_000),
      mk("just-under80", created + 1, created + 1_000_001), // elapsed 799,999 / 1,000,000
      mk("just-over80", created - 1, created + 999_999),
      mk("due-equals-now", created - 100, at.getTime()),
      mk("due-1ms-ago", created - 100, at.getTime() - 1),
      mk("due-1ms-ahead", created - 100, at.getTime() + 1),
      mk("zero-window", at.getTime(), at.getTime()),
      mk("due-before-created", at.getTime() + 5, at.getTime()),
      mk("paused", created, at.getTime() - 5, { slaPausedAt: new Date(created).toISOString() }),
      mk("responded-uses-resolve-due", created, at.getTime() + 9_999_999, { firstRespondedAt: new Date(created + 10).toISOString(), dueResolveAt: new Date(at.getTime() - 1).toISOString() }),
    ];
    for (const c of cases) await prisma.ticket.create({ data: c as never });
    for (const state of ["on_track", "at_risk", "breached", "paused", "met"] as const) {
      const q = ticketSearchQueries("boundary", { scope: {}, meId: "x", view: "all", filters: { slaState: state }, skip: 0, take: 100 }, at);
      const got = ((await prisma.$queryRaw(q.rows)) as { id: string }[]).map((r) => r.id).sort();
      const want = cases.filter((c) => slaStateOf(c as unknown as TicketRow, at.getTime()) === state).map((c) => c.id).sort();
      expect(got, state).toEqual(want);
    }
  });

  it("workflowAlertTickets matches the MemoryStore, incl. SQL NULL vs JSON null workflow", async () => {
    for (const visibleTo of [null, { userId: "u1", groupIds: ["g1"] }, { userId: "u2", groupIds: [] }, { userId: "nobody", groupIds: ["g2", "g1"] }]) {
      const [a, b] = [await pg.workflowAlertTickets("org", visibleTo), await mem.workflowAlertTickets("org", visibleTo)];
      // Same set AND same order on both stores (ids in byte order).
      expect(a.tickets.map((t) => t.id), JSON.stringify(visibleTo)).toEqual(b.tickets.map((t) => t.id));
      expect(a.workflowCount).toBe(b.workflowCount);
    }
    const all = await pg.workflowAlertTickets("org", null);
    expect(all.tickets.some((t) => t.id === "jsonnull")).toBe(false);
    expect(all.tickets.every((t) => t.tenantId === "org" && !t.deletedAt && !["closed", "cancelled"].includes(t.status))).toBe(true);
    expect(Object.keys(all.tickets[0]).sort()).toEqual(["assigneeId", "assignmentGroupId", "deletedAt", "dueResolveAt", "id", "priority", "reference", "slaPausedAt", "slaPausedMins", "status", "subject", "tenantId", "workflow"]);
    expect((await pg.workflowAlertTickets("other", null)).tickets.every((t) => t.tenantId === "other")).toBe(true);
  });

  it("getWorkflowAlerts returns identical output on PrismaStore and MemoryStore for every role", async () => {
    // bucketHealth() needs queuedAt, so give every workflow ticket a well-formed workflow with varied ages.
    let n = 0;
    for (const t of await mem.tickets.list({ tenantId: "org" })) {
      if (!t.workflow) continue;
      const workflow = { ...t.workflow, visitId: "v", queuedAt: new Date(fixtureNow.getTime() - (1 + (n++ % 14)) * 60_000).toISOString(), queuedPauseMins: 0 };
      await prisma.ticket.update({ where: { id: t.id }, data: { workflow } as never });
      await mem.tickets.update(t.id, { workflow });
    }
    const g = globalThis as unknown as { __netlinkStore?: Promise<unknown> };
    try {
      for (const id of ["admin", "mgr", "u1", "u2", "solo"]) {
        g.__netlinkStore = Promise.resolve(pg);
        const fromPg = await getWorkflowAlerts("org", { id } as never);
        g.__netlinkStore = Promise.resolve(mem);
        const fromMem = await getWorkflowAlerts("org", { id } as never);
        // R2: alert order is now deterministic (severity, due date, id), so the two stores agree exactly, including order.
        expect(fromPg, id).toEqual(fromMem);
        if (id === "admin") expect(new Set(fromMem.alerts.map((a) => a.level)).size).toBeGreaterThan(1); // several severities exercised
      }
    } finally { delete g.__netlinkStore; }
  });

});

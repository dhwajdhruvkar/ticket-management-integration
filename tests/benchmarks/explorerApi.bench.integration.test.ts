// Reproducible LOCAL benchmark of the explorer and workflow-alert request paths.
//
//   BENCH=1 PGLITE_DIR=<dir with @electric-sql/pglite, -socket, -pgvector> \
//   BENCH_SIZES=1000,10000 BENCH_OUT=<file.json> npx vitest run tests/benchmarks --testTimeout=3600000
//
// It drives the real route handlers / services through the real PrismaStore and
// Prisma client against PGlite (WebAssembly PostgreSQL, one connection, no
// network). Numbers are therefore NOT Vercel or Neon timings: they compare the
// old and new code paths on identical data and show query counts and payload.
// The "old" explorer is the unchanged plain list route paged exactly like the
// previous client (apiGetAll: pageSize=100 until the last page); the "old"
// alerts path is getWorkflowBoard(..., lightweight=true).monitoring. Synthetic
// data only.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaStore } from "@/server/data/prismaStore";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mockAuth }));

const ENABLED = !!process.env.BENCH && !!process.env.PGLITE_DIR;
const DIR = process.env.PGLITE_DIR!;
const SIZES = (process.env.BENCH_SIZES ?? "1000").split(",").map(Number);
const PORT = 54340;
const importFrom = (pkg: string, file: string) => import(pathToFileURL(path.join(DIR, "node_modules", pkg, file)).href);

interface QueryEvent { duration: number; query: string }
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(2); };
const stats = (xs: number[]) => ({ n: xs.length, avg: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2), p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), max: +Math.max(...xs).toFixed(2) });
const kind = (q: string) => (q.includes('AS "total"') ? "total" : q.includes("FILTER (WHERE") ? "counts" : q.includes("LIMIT") && q.includes("ORDER BY") ? "page" : q.includes("jsonb_typeof") ? "alerts" : "other");

describe.skipIf(!ENABLED)("benchmark: explorer + alerts request paths (PGlite, local)", () => {
  const report: Record<string, unknown> = {};
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let db: { exec(s: string): Promise<unknown>; close(): Promise<void> };
  const events: QueryEvent[] = [];

  beforeAll(async () => {
    const { PGlite } = await importFrom("@electric-sql/pglite", "dist/index.js");
    const { vector } = await importFrom("@electric-sql/pglite-pgvector", "dist/index.js");
    const { pgcrypto } = await importFrom("@electric-sql/pglite", "dist/contrib/pgcrypto.js");
    const { PGLiteSocketServer } = await importFrom("@electric-sql/pglite-socket", "dist/index.js");
    db = await PGlite.create({ extensions: { vector, pgcrypto } });
    const dir = path.join(process.cwd(), "prisma/migrations");
    for (const m of fs.readdirSync(dir).sort()) { const f = path.join(dir, m, "migration.sql"); if (fs.existsSync(f)) await db.exec(fs.readFileSync(f, "utf8")); }
    const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
    await server.start();
    prisma = new PrismaClient({ datasources: { db: { url: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?connection_limit=1&sslmode=disable` } }, log: [{ emit: "event", level: "query" }] });
    (prisma as unknown as { $on(e: string, cb: (x: QueryEvent) => void): void }).$on("query", (e) => events.push({ duration: e.duration, query: e.query }));
    (globalThis as { __netlinkStore?: unknown }).__netlinkStore = Promise.resolve(new PrismaStore(prisma));
    stop = async () => { await prisma.$disconnect(); await server.stop(); await db.close(); };
  }, 120_000);
  afterAll(async () => {
    if (process.env.BENCH_OUT) fs.writeFileSync(process.env.BENCH_OUT, JSON.stringify(report, null, 1));
    await stop?.();
  });

  async function seed(N: number) {
    await db.exec(`TRUNCATE "Ticket","AssignmentGroup","User","Tenant" CASCADE`);
    await db.exec(`INSERT INTO "Tenant" ("id","name","slug","isInternal","updatedAt") VALUES ('bench','bench','bench',false,now()),('other','other','other',false,now())`);
    await db.exec(`INSERT INTO "User" ("id","tenantId","name","email","role","updatedAt") SELECT 'u'||g,'bench','u'||g,'u'||g||'@bench.test',(CASE WHEN g=1 THEN 'tenant_admin' ELSE 'agent' END)::"Role",now() FROM generate_series(1,20) g`);
    await db.exec(`INSERT INTO "AssignmentGroup" ("id","tenantId","name","updatedAt") SELECT 'g'||g,'bench','g'||g,now() FROM generate_series(1,5) g`);
    await db.exec(`
      INSERT INTO "Ticket" ("id","reference","tenantId","subject","body","requesterEmail","status","priority","category","assigneeId","assignmentGroupId","createdAt","updatedAt","dueResponseAt","dueResolveAt","firstRespondedAt","resolvedAt","slaPausedAt","workflow","deletedAt")
      SELECT 'tk'||g,'NL-'||g,CASE WHEN g % 20 = 0 THEN 'other' ELSE 'bench' END,
        (ARRAY['Printer jam','VPN down','Reset password','Laptop slow','Access request'])[1 + g % 5] || ' #' || g,
        repeat('lorem ipsum dolor sit amet ', 40),'user'||(g % 500)||'@x.test',
        (ARRAY['new','open','in_progress','pending','resolved','closed','open','open','pending_agent','escalated'])[1 + g % 10]::"TicketStatus",
        (ARRAY['critical','high','medium','low','very_low'])[1 + g % 5]::"TicketPriority",
        (ARRAY['IT','HR','Access','Software','Hardware','Network','Billing','Other'])[1 + g % 8]::"TicketCategory",
        CASE WHEN g % 3 = 0 THEN NULL ELSE 'u'||(2 + g % 19) END, CASE WHEN g % 4 = 0 THEN NULL ELSE 'g'||(1 + g % 5) END,
        now() - (g || ' minutes')::interval * 0.5, now() - ((g % 5000) || ' minutes')::interval,
        now() - ((g % 9000) || ' minutes')::interval + interval '3 hours', now() - ((g % 9000) || ' minutes')::interval + interval '1 day',
        CASE WHEN g % 3 = 0 THEN now() - ((g % 3000) || ' minutes')::interval END,
        CASE WHEN g % 10 IN (4,5) THEN now() - ((g % 2000) || ' minutes')::interval END,
        CASE WHEN g % 17 = 0 THEN now() - interval '10 minutes' END,
        CASE WHEN g % 6 = 0 THEN jsonb_build_object('phase',(ARRAY['department','in_progress','awaiting_acceptance'])[1 + g % 3],'visitId','v','queuedAt',to_char(now() - ((g % 30) || ' minutes')::interval,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),'queuedPauseMins',0) END,
        CASE WHEN g % 20 = 5 THEN now() END
      FROM generate_series(1, ${Math.round(N * 1.05)}) g`);
    await db.exec(`ANALYZE "Ticket"`);
    mockAuth.mockResolvedValue({ user: { id: "u1", name: "u1", email: "u1@bench.test", role: "tenant_admin", tenantId: "bench" } });
  }

  async function run(fn: () => Promise<{ bytes: number; requests: number }>, iters: number, warm: number) {
    for (let i = 0; i < warm; i++) await fn();
    const wall: number[] = []; const queryCount: number[] = []; const queryMs: Record<string, number[]> = {}; const bytes: number[] = []; const requests: number[] = []; const peakRss: number[] = [];
    for (let i = 0; i < iters; i++) {
      events.length = 0; global.gc?.();
      const base = process.memoryUsage().rss; let peak = base;
      const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 5);
      const t = performance.now(); const r = await fn(); wall.push(performance.now() - t);
      clearInterval(timer); peak = Math.max(peak, process.memoryUsage().rss);
      bytes.push(r.bytes); requests.push(r.requests); queryCount.push(events.length); peakRss.push((peak - base) / 1048576);
      const byKind: Record<string, number> = {};
      for (const e of events) byKind[kind(e.query)] = (byKind[kind(e.query)] ?? 0) + e.duration;
      for (const [k, v] of Object.entries(byKind)) (queryMs[k] ??= []).push(v);
    }
    return { wallMs: stats(wall), apiRequests: requests[0], queriesPerRun: queryCount[0], payloadKB: +(bytes[0] / 1024).toFixed(1), peakRssDeltaMB: +Math.max(...peakRss).toFixed(1), dbMsByQueryKind: Object.fromEntries(Object.entries(queryMs).map(([k, v]) => [k, stats(v)])) };
  }

  it("measures each size", async () => {
    const { GET: listTickets } = await import("@/app/api/v1/tickets/route");
    const { GET: alertsRoute } = await import("@/app/api/v1/workflow/alerts/route");
    const { getWorkflowBoard } = await import("@/server/services/workflowBoard");
    const call = async (url: string) => { const res = await listTickets(new Request(`http://bench.test/api/v1/tickets?${url}`)); const text = await res.text(); return { json: JSON.parse(text) as { data: unknown[]; meta: { total: number; totalPages: number } }, bytes: text.length }; };
    for (const N of SIZES) {
      await seed(N);
      const out: Record<string, unknown> = { tenantLiveTickets: await prisma.ticket.count({ where: { tenantId: "bench", deletedAt: null } }) };
      report[String(N)] = out;
      // Each scenario is recorded as soon as it finishes; a failure (e.g. the local engine dropping the
      // connection under load) is recorded instead of discarding the scenarios that already completed.
      const scenario = async (name: string, fn: () => Promise<{ bytes: number; requests: number }>, iters: number, warm: number) => {
        try { out[name] = await run(fn, iters, warm); } catch (e) { out[name] = { error: String((e as Error).message).slice(0, 200) }; }
        if (process.env.BENCH_OUT) fs.writeFileSync(process.env.BENCH_OUT, JSON.stringify(report, null, 1));
      };
      const newPage = (q: string) => async () => { const r = await call(q); return { bytes: r.bytes, requests: 1 }; };
      await scenario("NEW explorer: view=all page 1", newPage("view=all&pageSize=100&page=1"), 30, 3);
      await scenario("NEW explorer: your_unsolved page 1", newPage("view=your_unsolved&pageSize=100&page=1"), 30, 3);
      await scenario("NEW explorer: all_unsolved + priority=high + sla=at_risk", newPage("view=all_unsolved&priority=high&sla=at_risk&pageSize=100"), 30, 3);
      await scenario("NEW explorer: search q=vpn", newPage("view=all&q=vpn&pageSize=100"), 30, 3);
      const alertsNew = async () => { const res = await alertsRoute(new Request("http://bench.test/api/v1/workflow/alerts")); const text = await res.text(); expect(res.status).toBe(200); return { bytes: text.length, requests: 1 }; };
      const alertsOld = async () => { const board = await getWorkflowBoard("bench", { id: "u1" } as never, true); return { bytes: JSON.stringify(board.monitoring).length, requests: 1 }; };
      await scenario("NEW alerts: route", alertsNew, N >= 50000 ? 8 : 20, 2);
      await scenario("OLD alerts: getWorkflowBoard(lightweight).monitoring", alertsOld, N >= 50000 ? 4 : 10, 1);
      // OLD list route, single pages at increasing offsets (basis for extrapolating the full read when it cannot finish locally).
      {
        const first = await call("pageSize=100&page=1");
        const T = first.json.meta.totalPages;
        for (const k of [1, Math.ceil(T / 4), Math.ceil(T / 2), T]) {
          await scenario(`OLD list route: single page ${k} of ${T}`, async () => { const r = await call(`pageSize=100&page=${k}`); return { bytes: r.bytes, requests: 1 }; }, 7, 1);
        }
      }
      // Run last: it is by far the heaviest and can exhaust the local engine at large sizes.
      // OLD explorer: the plain list route read page by page (the previous client's apiGetAll), then filtered in the browser.
      const oldAll = async () => {
        let page = 1; let bytes = 0; let requests = 0; let rows = 0;
        for (;;) { const r = await call(`pageSize=100&page=${page}`); bytes += r.bytes; requests++; rows += r.json.data.length; if (page >= r.json.meta.totalPages) break; page++; }
        expect(rows).toBeGreaterThan(0);
        return { bytes, requests };
      };
      await scenario("OLD explorer: load every page (apiGetAll)", oldAll, N >= 50000 ? 2 : N >= 10000 ? 4 : 8, N >= 50000 ? 0 : 1);

    }
  }, 3_600_000);
});

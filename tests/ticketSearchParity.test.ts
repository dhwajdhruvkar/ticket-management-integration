// Runs the explorer and workflow-alert SQL against a real PostgreSQL engine
// (PGlite) and checks it against the shared JS rules the MemoryStore uses.
// PGlite is not a project dependency: set PGLITE_PATH to an installed
// @electric-sql/pglite entry (e.g. its dist/index.js) to run this; otherwise
// the suite is skipped.
import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import type { Prisma } from "@prisma/client";
import { ticketSearchQueries, workflowAlertQueries } from "@/server/data/ticketSql";
import { searchTicketRows, TICKET_VIEW_RULES, type TicketViewId } from "@/lib/ticketViews";
import type { TicketFilters } from "@/lib/ticketFilters";
import type { TicketRow } from "@/server/domain/models";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const ms = (offsetMin: number) => new Date(NOW.getTime() + offsetMin * 60_000).toISOString();

const STATUSES = ["new", "open", "in_progress", "pending", "auto_resolved", "pending_agent", "escalated", "resolved", "reopened", "closed", "cancelled"] as const;
const PRIORITIES = ["critical", "high", "medium", "low", "very_low"] as const;
const CATEGORIES = ["IT", "HR", "Access", "Software", "Hardware", "Network", "Billing", "Other"] as const;
const WORKFLOWS: (Record<string, unknown> | null)[] = [
  null, { phase: "department" }, { phase: "in_progress" }, { phase: "awaiting_acceptance", managerEscalatedAt: ms(-5) },
  { phase: "department", rmEscalatedAt: "" }, { phase: "department", resolutionEscalatedAt: ms(-1) },
];

function buildFixture(): TicketRow[] {
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % n; };
  const rows: Partial<TicketRow>[] = [];
  for (let i = 0; i < 90; i++) {
    const created = -600 - rnd(5000);
    const dueKind = rnd(9);
    // Deadlines around "now": past, future, exactly now, and fractions of the 80% at-risk line.
    const due = dueKind === 0 ? null : dueKind === 1 ? ms(-30) : dueKind === 2 ? ms(0) : dueKind === 3 ? ms(500) : dueKind === 4 ? ms(created + (0 - created) * 1.25) : dueKind === 6 ? ms(created + (0 - created) * 1.1) : dueKind === 7 ? ms(created + (0 - created) * 2) : ms(created);
    const status = STATUSES[rnd(STATUSES.length)];
    const solved = ["resolved", "closed", "auto_resolved"].includes(status);
    rows.push({
      id: `t${String(i).padStart(3, "0")}`, reference: `NL-${1000 + i}`, tenantId: i % 9 === 0 ? "other" : "org",
      subject: ["Printer jam", "VPN down", "Reset password", "50% slower_login"][rnd(4)], requesterEmail: ["a@x.com", "B@x.com", "c@y.com"][rnd(3)],
      status, priority: PRIORITIES[rnd(5)], category: CATEGORIES[rnd(8)], type: "incident",
      assigneeId: [null, "u1", "u2", ""][rnd(4)] as string | null, assignmentGroupId: [null, "g1", "g2"][rnd(3)],
      createdAt: ms(created), updatedAt: ms(-(rnd(40) * 10)),
      dueResponseAt: due, dueResolveAt: rnd(2) ? due : ms(-rnd(100)),
      firstRespondedAt: rnd(3) === 0 ? ms(created + 5) : null,
      resolvedAt: solved ? ms(created + rnd(900)) : rnd(15) === 0 ? ms(-3) : null,
      slaPausedAt: rnd(8) === 0 ? ms(-20) : null, slaPausedMins: 0, workflowVersion: 0,
      workflow: WORKFLOWS[rnd(WORKFLOWS.length)] as TicketRow["workflow"],
      deletedAt: i % 11 === 0 ? ms(-10) : null,
    });
  }
  return rows as TicketRow[];
}

const DDL = `
CREATE TYPE "TicketStatus" AS ENUM ('new','open','in_progress','pending','auto_resolved','pending_agent','escalated','resolved','reopened','closed','cancelled');
CREATE TYPE "TicketPriority" AS ENUM ('critical','high','medium','low','very_low');
CREATE TYPE "TicketCategory" AS ENUM ('IT','HR','Access','Software','Hardware','Network','Billing','Other');
CREATE TYPE "TicketType" AS ENUM ('incident','service_request','problem','change');
CREATE TABLE "Ticket" (
  "id" text PRIMARY KEY, "workflow" jsonb, "workflowVersion" int NOT NULL DEFAULT 0, "resolvedById" text, "reference" text NOT NULL, "tenantId" text NOT NULL,
  "type" "TicketType" NOT NULL DEFAULT 'incident', "subject" text NOT NULL, "body" text NOT NULL DEFAULT '', "status" "TicketStatus" NOT NULL,
  "priority" "TicketPriority" NOT NULL, "impact" text, "urgency" text, "category" "TicketCategory" NOT NULL, "subcategory" text, "channel" text, "source" text,
  "tags" text[] NOT NULL DEFAULT '{}', "customFields" jsonb, "requesterEmail" text NOT NULL, "requesterId" text, "externalTicketId" text,
  "idempotencyScopeHash" text, "idempotencyRequestHash" text, "integrationKeyId" text, "assigneeId" text, "assignmentGroupId" text, "problemId" text,
  "changeId" text, "catalogItemId" text, "ciIds" text[] NOT NULL DEFAULT '{}', "linkedTicketIds" text[] NOT NULL DEFAULT '{}', "mergedIntoId" text,
  "satisfaction" text, "resolutionNotes" text, "escalationReason" text, "escalatedById" text, "escalatedAt" timestamp(3), "firstRespondedAt" timestamp(3),
  "resolvedAt" timestamp(3), "closedAt" timestamp(3), "dueResponseAt" timestamp(3), "dueResolveAt" timestamp(3), "slaPolicyId" text, "slaPausedAt" timestamp(3),
  "slaPausedMins" int NOT NULL DEFAULT 0, "createdAt" timestamp(3) NOT NULL, "updatedAt" timestamp(3) NOT NULL, "deletedAt" timestamp(3)
);`;

const pglitePath = process.env.PGLITE_PATH;

interface Db { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; exec(sql: string): Promise<unknown> }
async function openDb(): Promise<Db> {
  const mod = (await import(pathToFileURL(pglitePath!).href)) as { PGlite: new () => Db };
  const db = new mod.PGlite();
  await db.exec(DDL);
  const data = buildFixture();
  for (const t of data) {
    const c = ["id", "reference", "tenantId", "subject", "requesterEmail", "status", "priority", "category", "assigneeId", "assignmentGroupId", "createdAt", "updatedAt", "dueResponseAt", "dueResolveAt", "firstRespondedAt", "resolvedAt", "slaPausedAt", "deletedAt"] as const;
    await db.query(`INSERT INTO "Ticket" (${c.map((n) => `"${n}"`).join(",")}, "workflow") VALUES (${c.map((_, i) => `$${i + 1}`).join(",")}, $${c.length + 1}::jsonb)`,
      [...c.map((n) => (t as unknown as Record<string, unknown>)[n] ?? null), t.workflow === null ? null : JSON.stringify(t.workflow)]);
  }
  // A JSON-null workflow (not SQL NULL) must also count as "no workflow".
  await db.query(`INSERT INTO "Ticket" ("id","reference","tenantId","subject","requesterEmail","status","priority","category","createdAt","updatedAt","workflow") VALUES ('jsonnull','NL-J','org','x','a@x.com','open','low','IT',$1,$1,'null'::jsonb)`, [ms(-10)]);
  return db;
}
const run = (db: Db, q: Prisma.Sql) => db.query(q.text, q.values as unknown[]);

describe.skipIf(!pglitePath)("explorer + alert SQL parity with the shared JS rules (PostgreSQL)", () => {
  const FILTER_SETS: TicketFilters[] = [
    {}, { priority: "high" }, { groupId: "g1" }, { assigneeId: "unassigned" }, { assigneeId: "u1" }, { category: "IT" }, { assigned: true },
    { phase: "department" }, { escalated: true }, { overdue: true },
    { slaState: "breached" }, { slaState: "at_risk" }, { slaState: "on_track" }, { slaState: "paused" }, { slaState: "met" },
    { priority: "critical", slaState: "breached" }, { category: "Network", overdue: true, assigned: true },
  ];
  const QUERIES: (string | undefined)[] = [undefined, "vpn", "B@X.COM", "nl-1002", "50%", "slower_login", "zzz-none"];

  it("returns the same rows, order, totals and per-view counts as the JS rules", async () => {
    const db = await openDb();
    // Plus the JSON-null-workflow row openDb() adds.
    const all = [...buildFixture(), { id: "jsonnull", reference: "NL-J", tenantId: "org", subject: "x", requesterEmail: "a@x.com", status: "open", priority: "low", category: "IT", createdAt: ms(-10), updatedAt: ms(-10), workflow: null, deletedAt: null } as unknown as TicketRow];
    for (const view of Object.keys(TICKET_VIEW_RULES) as TicketViewId[]) {
      for (const filters of FILTER_SETS) {
        for (const q of QUERIES) {
          const spec = { scope: {}, meId: "u1", view, filters, q, skip: 0, take: 1000 };
          const queries = ticketSearchQueries("org", spec, NOW);
          const [rows, total, counts] = await Promise.all([run(db, queries.rows), run(db, queries.total), run(db, queries.counts)]);
          const visible = all.filter((t) => t.tenantId === "org" && !t.deletedAt)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
          const expected = searchTicketRows(visible, { meId: "u1", view, filters, q }, NOW.getTime());
          const label = JSON.stringify({ view, filters, q });
          expect(rows.rows.map((r) => r.id), label).toEqual(expected.rows.map((r) => r.id));
          expect(total.rows[0].total, label).toBe(expected.rows.length);
          expect(counts.rows[0], label).toEqual(expected.counts);
          // Guard against a vacuous fixture: every SLA state and boundary must actually occur.
          if (view === "all" && !q && Object.keys(filters).length === 1 && filters.slaState) expect(rows.rows.length, label).toBeGreaterThan(0);
        }
      }
    }
  }, 60_000);

  it("pages without gaps or repeats and honours caller scope", async () => {
    const db = await openDb();
    const seen: unknown[] = [];
    for (let skip = 0; ; skip += 7) {
      const { rows } = await run(db, ticketSearchQueries("org", { scope: {}, meId: "u1", view: "all", filters: {}, skip, take: 7 }, NOW).rows);
      if (!rows.length) break;
      seen.push(...rows.map((r) => r.id));
    }
    const total = (await run(db, ticketSearchQueries("org", { scope: {}, meId: "u1", view: "all", filters: {}, skip: 0, take: 1 }, NOW).total)).rows[0].total;
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(total as number);
    const scoped = await run(db, ticketSearchQueries("org", { scope: { requesterEmail: "a@x.com", assigneeId: null }, meId: "u1", view: "all", filters: {}, skip: 0, take: 1000 }, NOW).rows);
    expect(scoped.rows.every((r) => r.requesterEmail === "a@x.com" && r.assigneeId === null)).toBe(true);
    expect((await run(db, ticketSearchQueries("org", { scope: { status: "bogus" as never }, meId: "u1", view: "all", filters: {}, skip: 0, take: 5 }, NOW).total)).rows[0].total).toBe(0);
  });

  it("selects exactly the workflow tickets (SQL NULL and JSON null excluded) with the same visibility rules", async () => {
    const db = await openDb();
    const all = buildFixture().filter((t) => t.tenantId === "org" && !t.deletedAt && !!t.workflow && !["closed", "cancelled"].includes(t.status));
    const everyone = workflowAlertQueries("org", null);
    expect((await run(db, everyone.rows)).rows.map((r) => r.id).sort()).toEqual(all.map((t) => t.id).sort());
    expect((await run(db, everyone.count)).rows[0].total).toBe(all.length);
    const mine = workflowAlertQueries("org", { userId: "u1", groupIds: ["g1"] });
    const expected = all.filter((t) => t.assigneeId === "u1" || t.assignmentGroupId === "g1").map((t) => t.id).sort();
    expect((await run(db, mine.rows)).rows.map((r) => r.id).sort()).toEqual(expected);
    expect((await run(db, mine.count)).rows[0].total).toBe(all.length);
    const noGroups = workflowAlertQueries("org", { userId: "u2", groupIds: [] });
    expect((await run(db, noGroups.rows)).rows.map((r) => r.id).sort()).toEqual(all.filter((t) => t.assigneeId === "u2").map((t) => t.id).sort());
    expect((await run(db, workflowAlertQueries("nobody", null).rows)).rows).toEqual([]);
  });
});

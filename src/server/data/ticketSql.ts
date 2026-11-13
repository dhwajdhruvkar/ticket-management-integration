// =============================================================================
// SQL for the two ticket reads that must not load whole tenant collections:
// the explorer search (views + filters + search + paging + counts) and the
// workflow-alert candidate set. Every predicate mirrors a rule that the
// MemoryStore evaluates with the shared JS code (lib/ticketViews, lib/
// ticketFilters), and tests run both against the same fixtures.
//
// Only constants from this file are inlined (Prisma.raw); every caller-supplied
// value is a bound parameter. Enum columns are compared as ::text for
// caller-supplied values so an unknown value matches nothing instead of
// erroring on an enum cast.
// =============================================================================

import { Prisma } from "@prisma/client";
import type { TicketSearchSpec } from "./store";
import { TICKET_VIEW_RULES, type TicketViewId } from "@/lib/ticketViews";

/** Every Ticket column except `body`, which the explorer table never shows. */
export const TICKET_LIST_COLUMNS = [
  "id", "workflow", "workflowVersion", "resolvedById", "reference", "tenantId", "type", "subject",
  "status", "priority", "impact", "urgency", "category", "subcategory", "channel", "source",
  "tags", "customFields", "requesterEmail", "requesterId", "externalTicketId", "idempotencyScopeHash",
  "idempotencyRequestHash", "integrationKeyId", "assigneeId", "assignmentGroupId", "problemId", "changeId",
  "catalogItemId", "ciIds", "linkedTicketIds", "mergedIntoId", "satisfaction", "resolutionNotes",
  "escalationReason", "escalatedById", "escalatedAt", "firstRespondedAt", "resolvedAt", "closedAt",
  "dueResponseAt", "dueResolveAt", "slaPolicyId", "slaPausedAt", "slaPausedMins", "createdAt",
  "updatedAt", "deletedAt",
] as const;

/** The only columns bucketHealth() and the alert summary read. */
export const WORKFLOW_ALERT_COLUMNS = [
  "id", "reference", "subject", "tenantId", "status", "priority", "workflow", "slaPausedAt", "slaPausedMins",
  "deletedAt", "dueResolveAt", "assignmentGroupId", "assigneeId",
] as const;

const cols = (names: readonly string[]) => Prisma.raw(names.map((n) => `"${n}"`).join(", "));
const UNSOLVED = Prisma.raw("('new','open','in_progress','pending','pending_agent','escalated','reopened')");
const SOLVED = Prisma.raw("('auto_resolved','resolved','closed')");
const NOT_FINAL_WORKFLOW = Prisma.raw("('closed','cancelled')");
const unassigned = Prisma.sql`COALESCE("assigneeId", '') = ''`;

function viewPredicate(view: TicketViewId, meId: string): Prisma.Sql {
  switch (view) {
    case "your_unsolved": return Prisma.sql`("assigneeId" = ${meId} AND "status" IN ${UNSOLVED})`;
    case "unassigned": return Prisma.sql`(${unassigned} AND "status" IN ${UNSOLVED})`;
    case "all_unsolved": return Prisma.sql`"status" IN ${UNSOLVED}`;
    case "pending": return Prisma.sql`"status" IN ('pending_agent','pending')`;
    case "recently_solved": return Prisma.sql`"status" IN ${SOLVED}`;
    case "recently_updated":
    case "all": return Prisma.sql`TRUE`;
  }
}

/** Mirrors slaStateOf() in lib/ticketFilters. `now` is a UTC timestamp. */
function slaStateSql(now: Prisma.Sql): Prisma.Sql {
  const nextDue = Prisma.sql`CASE WHEN "firstRespondedAt" IS NOT NULL THEN "dueResolveAt" ELSE "dueResponseAt" END`;
  const secs = (a: Prisma.Sql, b: Prisma.Sql) => Prisma.sql`EXTRACT(EPOCH FROM (${a} - ${b}))`;
  return Prisma.sql`CASE
    WHEN ("status" IN ${SOLVED} OR "resolvedAt" IS NOT NULL) THEN
      CASE WHEN "dueResolveAt" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolvedAt" > "dueResolveAt" THEN 'breached' ELSE 'met' END
    WHEN "slaPausedAt" IS NOT NULL THEN 'paused'
    WHEN (${nextDue}) IS NULL THEN 'on_track'
    WHEN ${now} > (${nextDue}) THEN 'breached'
    WHEN (${nextDue}) > "createdAt" AND ${secs(now, Prisma.sql`"createdAt"`)} >= 0.8 * ${secs(nextDue, Prisma.sql`"createdAt"`)} THEN 'at_risk'
    ELSE 'on_track' END`;
}

function filterPredicates(spec: TicketSearchSpec, now: Prisma.Sql): Prisma.Sql[] {
  const f = spec.filters;
  const out: Prisma.Sql[] = [];
  if (f.priority) out.push(Prisma.sql`"priority"::text = ${f.priority}`);
  if (f.groupId) out.push(Prisma.sql`"assignmentGroupId" = ${f.groupId}`);
  if (f.assigneeId === "unassigned") out.push(unassigned);
  else if (f.assigneeId) out.push(Prisma.sql`"assigneeId" = ${f.assigneeId}`);
  if (f.category) out.push(Prisma.sql`"category"::text = ${f.category}`);
  if (f.slaState) out.push(Prisma.sql`(${slaStateSql(now)}) = ${f.slaState}`);
  if (f.phase) out.push(Prisma.sql`"workflow"->>'phase' = ${f.phase}`);
  if (f.assigned) out.push(Prisma.sql`NOT (${unassigned})`);
  if (f.overdue) out.push(Prisma.sql`NOT ("status" IN ${SOLVED} OR "resolvedAt" IS NOT NULL) AND (${slaStateSql(now)}) = 'breached'`);
  if (f.escalated) out.push(Prisma.sql`("status" = 'escalated' OR COALESCE("workflow"->>'managerEscalatedAt', '') <> '' OR COALESCE("workflow"->>'rmEscalatedAt', '') <> '' OR COALESCE("workflow"->>'resolutionEscalatedAt', '') <> '')`);
  return out;
}

/** Tenant + soft-delete + caller scope. Tenant is a required argument, never optional. */
function baseWhere(tenantId: string, scope: TicketSearchSpec["scope"]): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`"tenantId" = ${tenantId}`, Prisma.sql`"deletedAt" IS NULL`];
  if (scope.status) parts.push(Prisma.sql`"status"::text = ${scope.status}`);
  if (scope.type) parts.push(Prisma.sql`"type"::text = ${scope.type}`);
  if (scope.assigneeId === null) parts.push(Prisma.sql`"assigneeId" IS NULL`);
  else if (scope.assigneeId !== undefined) parts.push(Prisma.sql`"assigneeId" = ${scope.assigneeId}`);
  if (scope.assignmentGroupId !== undefined) parts.push(Prisma.sql`"assignmentGroupId" = ${scope.assignmentGroupId}`);
  if (scope.requesterEmail !== undefined) parts.push(Prisma.sql`"requesterEmail" = ${scope.requesterEmail}`);
  return Prisma.join(parts, " AND ");
}

export function ticketSearchQueries(tenantId: string, spec: TicketSearchSpec, at = new Date()) {
  const now = Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const base = baseWhere(tenantId, spec.scope);
  const matching: Prisma.Sql[] = [base, viewPredicate(spec.view, spec.meId), ...filterPredicates(spec, now)];
  const needle = spec.q?.toLowerCase();
  if (needle) {
    matching.push(Prisma.sql`(position(${needle} in lower("subject")) > 0 OR position(${needle} in lower("requesterEmail")) > 0 OR position(${needle} in lower("reference")) > 0)`);
  }
  const where = Prisma.join(matching.map((p) => Prisma.sql`(${p})`), " AND ");
  const sorted = !!(TICKET_VIEW_RULES[spec.view] as { sort?: unknown }).sort;
  const order = sorted ? Prisma.sql`"updatedAt" DESC, "createdAt" DESC, "id" ASC` : Prisma.sql`"createdAt" DESC, "id" ASC`;
  const viewIds = Object.keys(TICKET_VIEW_RULES) as TicketViewId[];
  const countCols = Prisma.join(viewIds.map((id) => Prisma.sql`(count(*) FILTER (WHERE ${viewPredicate(id, spec.meId)}))::int AS ${Prisma.raw(`"${id}"`)}`), ", ");
  return {
    rows: Prisma.sql`SELECT ${cols(TICKET_LIST_COLUMNS)} FROM "Ticket" WHERE ${where} ORDER BY ${order} LIMIT ${spec.take} OFFSET ${spec.skip}`,
    total: Prisma.sql`SELECT count(*)::int AS "total" FROM "Ticket" WHERE ${where}`,
    counts: Prisma.sql`SELECT ${countCols} FROM "Ticket" WHERE ${base}`,
  };
}

export interface WorkflowAlertVisibility { userId: string; groupIds: string[] }

/**
 * Tickets that take part in workflow monitoring: not deleted, workflow present
 * (SQL NULL and JSON null both mean "none"), and not closed/cancelled. A null
 * `visibleTo` means dispatcher-level visibility.
 */
export function workflowAlertQueries(tenantId: string, visibleTo: WorkflowAlertVisibility | null) {
  const where = Prisma.sql`"tenantId" = ${tenantId} AND "deletedAt" IS NULL AND "workflow" IS NOT NULL AND jsonb_typeof("workflow") <> 'null' AND "status" NOT IN ${NOT_FINAL_WORKFLOW}`;
  const visible = visibleTo
    ? Prisma.sql`AND ("assigneeId" = ${visibleTo.userId}${visibleTo.groupIds.length ? Prisma.sql` OR "assignmentGroupId" IN (${Prisma.join(visibleTo.groupIds)})` : Prisma.empty})`
    : Prisma.empty;
  return {
    rows: Prisma.sql`SELECT ${cols(WORKFLOW_ALERT_COLUMNS)} FROM "Ticket" WHERE ${where} ${visible}`,
    count: Prisma.sql`SELECT count(*)::int AS "total" FROM "Ticket" WHERE ${where}`,
  };
}

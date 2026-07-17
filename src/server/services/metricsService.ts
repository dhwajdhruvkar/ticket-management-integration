// =============================================================================
// Analytics & reporting.
//
// Aggregates tenant operational metrics for dashboards and exports: volumes by
// type/status, deflection/containment, MTTR & first-response time, SLA health,
// CSAT, an agent leaderboard, and an ROI estimate (hours + cost saved).
// =============================================================================

import { getStore } from "../data";
import { slaStatus } from "./slaService";
import type { TicketRow } from "../domain/models";

const ROI_MINUTES_PER_TICKET = 12;
const ROI_AGENT_HOURLY_COST = 45;
const OPEN = ["new", "open", "in_progress", "pending", "pending_agent", "escalated", "reopened"];
const RESOLVED = ["auto_resolved", "resolved", "closed"];

export interface AgentStat {
  id: string;
  name: string;
  resolved: number;
  open: number;
}

export interface PrioritySlaStat {
  priority: string;
  total: number;
  met: number;
  /** % of finished tickets that met their SLA (1 when none finished). */
  compliance: number;
}

export interface GroupBacklogStat {
  groupId: string;
  name: string;
  open: number;
}

export interface Metrics {
  totalTickets: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  openCount: number;
  resolvedCount: number;
  processed: number;
  autoResolved: number;
  suggested: number;
  escalated: number;
  deflectionRate: number;
  containmentRate: number;
  avgConfidence: number;
  avgFirstResponseMins: number;
  mttrMins: number;
  csat: number;
  slaAtRisk: number;
  slaBreached: number;
  /** SLA compliance among finished tickets, by priority (spec KPI "% SLA met"). */
  slaCompliance: PrioritySlaStat[];
  /** Share of tickets that were reopened at least once. */
  reopenRate: number;
  /** Open backlog per assignment group. */
  backlogByGroup: GroupBacklogStat[];
  kbArticles: number;
  auditBlocks: number;
  agentHoursSaved: number;
  costSaved: number;
  leaderboard: AgentStat[];
}

const PRIORITY_ORDER = ["critical", "high", "medium", "low", "very_low"];

export async function computeMetrics(tenantId: string): Promise<Metrics> {
  const store = await getStore();
  const [tickets, resolutions, articles, audit, users, groups, events] = await Promise.all([
    store.tickets.list({ tenantId }),
    store.resolutions.list(),
    store.articles.list({ tenantId }),
    store.audit.list({ tenantId }),
    store.users.list({ tenantId }),
    store.groups.list({ tenantId }),
    store.events.list(),
  ]);

  const byType = countBy(tickets, (t) => t.type);
  const byStatus = countBy(tickets, (t) => t.status);
  const byCategory = countBy(tickets, (t) => t.category);
  const byPriority = countBy(tickets, (t) => t.priority);
  const openCount = tickets.filter((t) => OPEN.includes(t.status)).length;
  const resolvedCount = tickets.filter((t) => RESOLVED.includes(t.status)).length;

  const resByTicket = new Map(resolutions.map((r) => [r.ticketId, r]));
  const processed = tickets.filter((t) => resByTicket.has(t.id));
  const autoResolved = processed.filter((t) => resByTicket.get(t.id)?.decision === "auto_resolve").length;
  const suggested = processed.filter((t) => resByTicket.get(t.id)?.decision === "suggest").length;
  const escalated = processed.filter((t) => resByTicket.get(t.id)?.decision === "escalate").length;
  const confidences = processed.map((t) => resByTicket.get(t.id)!.confidence);

  const frtSamples = tickets
    .filter((t) => t.firstRespondedAt)
    .map((t) => minutes(t.createdAt, t.firstRespondedAt!));
  const mttrSamples = tickets
    .filter((t) => t.resolvedAt)
    .map((t) => minutes(t.createdAt, t.resolvedAt!));

  const withCsat = tickets.filter((t) => t.satisfaction);
  const satisfied = withCsat.filter((t) => t.satisfaction === "satisfied").length;

  let slaAtRisk = 0;
  let slaBreached = 0;
  for (const t of tickets) {
    if (!OPEN.includes(t.status)) continue;
    const level = slaStatus(t).level;
    if (level === "breached") slaBreached++;
    else if (level === "at_risk") slaAtRisk++;
  }

  // SLA compliance by priority among finished tickets.
  const slaCompliance: PrioritySlaStat[] = PRIORITY_ORDER.map((priority) => {
    const finished = tickets.filter((t) => t.priority === priority && RESOLVED.includes(t.status));
    const met = finished.filter((t) => slaStatus(t).level === "met").length;
    return {
      priority,
      total: finished.length,
      met,
      compliance: finished.length ? met / finished.length : 1,
    };
  });

  // Reopen rate: tickets with at least one "reopened" lifecycle event.
  const ticketIds = new Set(tickets.map((t) => t.id));
  const reopenedIds = new Set(
    events.filter((e) => e.type === "reopened" && ticketIds.has(e.ticketId)).map((e) => e.ticketId)
  );
  const reopenRate = tickets.length ? reopenedIds.size / tickets.length : 0;

  const backlogByGroup: GroupBacklogStat[] = groups
    .map((g) => ({
      groupId: g.id,
      name: g.name,
      open: tickets.filter((t) => t.assignmentGroupId === g.id && OPEN.includes(t.status)).length,
    }))
    .sort((a, b) => b.open - a.open);

  const agentMap = new Map<string, AgentStat>();
  for (const t of tickets) {
    if (!t.assigneeId) continue;
    const name = users.find((u) => u.id === t.assigneeId)?.name ?? t.assigneeId;
    const stat = agentMap.get(t.assigneeId) ?? { id: t.assigneeId, name, resolved: 0, open: 0 };
    if (OPEN.includes(t.status)) stat.open++;
    else stat.resolved++;
    agentMap.set(t.assigneeId, stat);
  }

  const minutesSaved = autoResolved * ROI_MINUTES_PER_TICKET + suggested * ROI_MINUTES_PER_TICKET * 0.6;
  const agentHoursSaved = minutesSaved / 60;

  return {
    totalTickets: tickets.length,
    byType,
    byStatus,
    byCategory,
    byPriority,
    openCount,
    resolvedCount,
    processed: processed.length,
    autoResolved,
    suggested,
    escalated,
    deflectionRate: processed.length ? autoResolved / processed.length : 0,
    containmentRate: processed.length ? (autoResolved + suggested) / processed.length : 0,
    avgConfidence: avg(confidences),
    avgFirstResponseMins: avg(frtSamples),
    mttrMins: avg(mttrSamples),
    csat: withCsat.length ? satisfied / withCsat.length : 0,
    slaAtRisk,
    slaBreached,
    slaCompliance,
    reopenRate,
    backlogByGroup,
    kbArticles: articles.length,
    auditBlocks: audit.length,
    agentHoursSaved,
    costSaved: agentHoursSaved * ROI_AGENT_HOURLY_COST,
    leaderboard: [...agentMap.values()].sort((a, b) => b.resolved - a.resolved || b.open - a.open),
  };
}

/** Flat report rows for CSV/PDF export (one row per ticket). */
export async function reportRows(tenantId: string): Promise<Record<string, string | number>[]> {
  const store = await getStore();
  const [tickets, groups] = await Promise.all([
    store.tickets.list({ tenantId }),
    store.groups.list({ tenantId }),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  return tickets.map((t) => ({
    reference: t.reference,
    type: t.type,
    status: t.status,
    priority: t.priority,
    impact: t.impact ?? "",
    urgency: t.urgency ?? "",
    category: t.category,
    subcategory: t.subcategory ?? "",
    group: t.assignmentGroupId ? groupName.get(t.assignmentGroupId) ?? "" : "",
    requester: t.requesterEmail,
    createdAt: t.createdAt,
    resolvedAt: t.resolvedAt ?? "",
    firstResponseMins: t.firstRespondedAt ? Math.round(minutes(t.createdAt, t.firstRespondedAt)) : "",
    resolutionMins: t.resolvedAt ? Math.round(minutes(t.createdAt, t.resolvedAt)) : "",
    slaPausedMins: t.slaPausedMins ?? 0,
    slaLevel: slaStatus(t).level,
  }));
}

// ---------------------------------------------------------------------------
// Daily trend series (created/resolved/auto-resolved/SLA/CSAT per day).
//
// Computed on the fly from tickets — accurate from day one with no rollup
// table. A MetricsDaily rollup becomes worthwhile only at ~100k+ tickets
// (documented deferral).
// ---------------------------------------------------------------------------

export interface TrendPoint {
  /** YYYY-MM-DD (UTC). */
  date: string;
  created: number;
  resolved: number;
  autoResolved: number;
  slaMet: number;
  slaBreached: number;
  csatSatisfied: number;
  csatRated: number;
}

export async function computeTrends(tenantId: string, days = 30): Promise<TrendPoint[]> {
  const store = await getStore();
  const tickets = await store.tickets.list({ tenantId });

  const span = Math.max(1, Math.min(days, 365));
  const points = new Map<string, TrendPoint>();
  const today = new Date();
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    points.set(key, {
      date: key,
      created: 0,
      resolved: 0,
      autoResolved: 0,
      slaMet: 0,
      slaBreached: 0,
      csatSatisfied: 0,
      csatRated: 0,
    });
  }

  for (const t of tickets) {
    const createdKey = t.createdAt.slice(0, 10);
    const createdPoint = points.get(createdKey);
    if (createdPoint) createdPoint.created++;

    if (t.resolvedAt) {
      const resolvedKey = t.resolvedAt.slice(0, 10);
      const resolvedPoint = points.get(resolvedKey);
      if (resolvedPoint) {
        resolvedPoint.resolved++;
        if (t.status === "auto_resolved") resolvedPoint.autoResolved++;
        const level = slaStatus(t).level;
        if (level === "breached") resolvedPoint.slaBreached++;
        else resolvedPoint.slaMet++;
        if (t.satisfaction) {
          resolvedPoint.csatRated++;
          if (t.satisfaction === "satisfied") resolvedPoint.csatSatisfied++;
        }
      }
    }
  }
  return [...points.values()];
}

function countBy<T>(rows: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
function minutes(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000;
}
function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

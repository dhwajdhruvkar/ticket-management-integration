import type { TicketEventRow, TicketRow, UserRow } from "../domain/models";
import { getStore } from "../data";
import { WorkflowError } from "./workflowService";

export type PerformanceRange = "week" | "month" | "year" | "custom";
export interface PerformancePeriod { range: PerformanceRange; timezone: string; from: string; to: string; startAt: string; endBefore: string }
export type Granularity = "day" | "week" | "month";
export interface AgentPerformanceRow {
  id: string; name: string; active: boolean; resolutions: number; liveOpen: number;
  resolvedToday: number; resolvedThisWeek: number; resolvedThisMonth: number;
  avgResolutionMins: number | null; slaMet: number; slaMeasured: number; slaCompliance: number | null;
  reopened: number; oldestOpenAgeMins: number | null; avgOpenAgeMins: number | null;
}
export interface SeriesPoint { bucket: string; total: number; counts: Record<string, number> }
export interface AgentPerformanceReport { period: PerformancePeriod; granularity: Granularity; rows: AgentPerformanceRow[]; series: SeriesPoint[] }

const DAY_MS = 86_400_000;
const ASSIGNABLE_ROLES = ["agent", "manager", "tenant_admin", "super_admin"];
const LIVE_OPEN_STATUSES = ["new", "open", "in_progress", "pending", "pending_agent", "escalated", "reopened"];

function dateFormatter(timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }); }
function dayInZone(date: Date, formatter: Intl.DateTimeFormat): string {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function validDay(value?: string): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100 && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function shiftDay(value: string, days: number) { return new Date(Date.parse(value) + days * DAY_MS).toISOString().slice(0, 10); }
function startOfLocalDay(value: string, formatter: Intl.DateTimeFormat): string {
  // Find the first instant of the local date, including short/long DST days.
  let low = Date.parse(value) - 2 * DAY_MS, high = Date.parse(value) + 2 * DAY_MS;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dayInZone(new Date(mid), formatter) < value) low = mid + 1; else high = mid;
  }
  return new Date(low).toISOString();
}
export function performancePeriod(range: PerformanceRange, timezone: string, from?: string, to?: string, at = new Date()): PerformancePeriod {
  let formatter: Intl.DateTimeFormat;
  try { formatter = dateFormatter(timezone); } catch { throw new WorkflowError("Invalid reporting timezone.", 400); }
  const today = dayInZone(at, formatter);
  if (range === "week") { const day = new Date(today).getUTCDay(); from = shiftDay(today, -((day + 6) % 7)); to = shiftDay(from, 6); }
  else if (range === "month") { from = `${today.slice(0, 7)}-01`; const next = new Date(from); next.setUTCMonth(next.getUTCMonth() + 1); to = shiftDay(next.toISOString().slice(0, 10), -1); }
  else if (range === "year") { from = `${today.slice(0, 4)}-01-01`; to = `${today.slice(0, 4)}-12-31`; }
  if (!validDay(from) || !validDay(to) || from > to || Date.parse(to) - Date.parse(from) > 5 * 366 * DAY_MS) throw new WorkflowError("Choose valid start/end dates in order (maximum five years).", 400);
  return { range, timezone, from, to, startAt: startOfLocalDay(from, formatter), endBefore: startOfLocalDay(shiftDay(to, 1), formatter) };
}

function blankRow(id: string, name: string, active: boolean): AgentPerformanceRow {
  return { id, name, active, resolutions: 0, liveOpen: 0, resolvedToday: 0, resolvedThisWeek: 0, resolvedThisMonth: 0,
    avgResolutionMins: null, slaMet: 0, slaMeasured: 0, slaCompliance: null, reopened: 0, oldestOpenAgeMins: null, avgOpenAgeMins: null };
}
const inWindow = (createdAt: string, window: PerformancePeriod) => createdAt >= window.startAt && createdAt < window.endBefore;

export function summarizeAgentPerformance(tenantId: string, users: UserRow[], tickets: TicketRow[], events: TicketEventRow[], period: PerformancePeriod,
  options: { reopenEvents?: TicketEventRow[]; at?: Date } = {}): AgentPerformanceRow[] {
  const at = options.at ?? new Date();
  const today = dayInZone(at, dateFormatter(period.timezone));
  // Fixed windows ignore the selected period: "today", "this week", "this month" in organization time.
  const windows = {
    today: performancePeriod("custom", period.timezone, today, today, at),
    week: performancePeriod("week", period.timezone, undefined, undefined, at),
    month: performancePeriod("month", period.timezone, undefined, undefined, at),
  };
  const rows = new Map<string, AgentPerformanceRow>();
  for (const user of users) if (user.tenantId === tenantId && ASSIGNABLE_ROLES.includes(user.role)) rows.set(user.id, blankRow(user.id, user.name, user.active));
  const rowFor = (id: string) => {
    let row = rows.get(id);
    if (!row) { row = blankRow(id, "Former staff member", false); rows.set(id, row); }
    return row;
  };
  const ticketsById = new Map(tickets.filter((ticket) => ticket.tenantId === tenantId).map((ticket) => [ticket.id, ticket]));
  const inPeriod = (createdAt: string) => createdAt >= period.startAt && createdAt < period.endBefore;

  const resolutions = events.filter((event) => event.tenantId === tenantId && event.type === "resolution_recorded").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const timed = new Map<string, { mins: number; count: number }>();
  for (const event of resolutions) {
    const resolverId = event.resolverId;
    if (!resolverId) continue;
    if (inWindow(event.createdAt, windows.today)) rowFor(resolverId).resolvedToday++;
    if (inWindow(event.createdAt, windows.week)) rowFor(resolverId).resolvedThisWeek++;
    if (inWindow(event.createdAt, windows.month)) rowFor(resolverId).resolvedThisMonth++;
    if (!inPeriod(event.createdAt)) continue;
    const row = rowFor(resolverId);
    row.resolutions++;
    const ticket = ticketsById.get(event.ticketId);
    if (!ticket) continue;
    const entry = timed.get(resolverId) ?? { mins: 0, count: 0 };
    entry.mins += Math.max(0, (Date.parse(event.createdAt) - Date.parse(ticket.createdAt)) / 60_000 - (ticket.slaPausedMins ?? 0));
    entry.count++;
    timed.set(resolverId, entry);
    if (ticket.dueResolveAt) {
      row.slaMeasured++;
      if (Date.parse(event.createdAt) <= Date.parse(ticket.dueResolveAt)) row.slaMet++;
    }
  }
  for (const row of rows.values()) {
    const entry = timed.get(row.id);
    if (entry) row.avgResolutionMins = entry.mins / entry.count;
    row.slaCompliance = row.slaMeasured ? row.slaMet / row.slaMeasured : null;
  }

  // A reopen is credited to whoever made the most recent resolution before it, not the current assignee.
  const resolutionsByTicket = new Map<string, TicketEventRow[]>();
  for (const event of resolutions) {
    const list = resolutionsByTicket.get(event.ticketId) ?? [];
    list.push(event);
    resolutionsByTicket.set(event.ticketId, list);
  }
  for (const reopen of options.reopenEvents ?? []) {
    if (reopen.type !== "reopened" || !ticketsById.has(reopen.ticketId) || !inPeriod(reopen.createdAt)) continue;
    const prior = (resolutionsByTicket.get(reopen.ticketId) ?? []).filter((event) => event.createdAt <= reopen.createdAt);
    const resolverId = prior[prior.length - 1]?.resolverId;
    if (resolverId) rowFor(resolverId).reopened++;
  }

  const aging = new Map<string, { sum: number; count: number; max: number }>();
  for (const ticket of tickets) {
    if (ticket.tenantId !== tenantId || ticket.deletedAt || !LIVE_OPEN_STATUSES.includes(ticket.status)) continue;
    const row = ticket.assigneeId ? rows.get(ticket.assigneeId) : undefined;
    if (!row) continue;
    row.liveOpen++;
    const age = (at.getTime() - Date.parse(ticket.createdAt)) / 60_000;
    const entry = aging.get(row.id) ?? { sum: 0, count: 0, max: age };
    entry.sum += age; entry.count++; entry.max = Math.max(entry.max, age);
    aging.set(row.id, entry);
  }
  for (const row of rows.values()) {
    const entry = aging.get(row.id);
    if (entry) { row.oldestOpenAgeMins = entry.max; row.avgOpenAgeMins = entry.sum / entry.count; }
  }

  return [...rows.values()]
    .filter((row) => row.active || row.resolutions > 0 || row.liveOpen > 0 || row.resolvedToday + row.resolvedThisWeek + row.resolvedThisMonth + row.reopened > 0)
    .sort((a, b) => b.resolutions - a.resolutions || a.name.localeCompare(b.name));
}

export function defaultGranularity(period: PerformancePeriod): Granularity {
  const days = (Date.parse(period.to) - Date.parse(period.from)) / DAY_MS + 1;
  return days <= 31 ? "day" : days <= 180 ? "week" : "month";
}

/** Resolutions per bucket for the selected dates; zero-filled, in organization-local dates. */
export function buildResolutionSeries(tenantId: string, events: TicketEventRow[], period: PerformancePeriod, granularity: Granularity): SeriesPoint[] {
  const formatter = dateFormatter(period.timezone);
  const bucketOf = (day: string) => granularity === "day" ? day : granularity === "month" ? day.slice(0, 7) : shiftDay(day, -((new Date(day).getUTCDay() + 6) % 7));
  const series = new Map<string, SeriesPoint>();
  for (let day = period.from; day <= period.to; day = shiftDay(day, 1)) {
    const bucket = bucketOf(day);
    if (!series.has(bucket)) series.set(bucket, { bucket, total: 0, counts: {} });
  }
  for (const event of events) {
    if (event.tenantId !== tenantId || event.type !== "resolution_recorded" || !event.resolverId || !inWindow(event.createdAt, period)) continue;
    const point = series.get(bucketOf(dayInZone(new Date(event.createdAt), formatter)));
    if (!point) continue;
    point.counts[event.resolverId] = (point.counts[event.resolverId] ?? 0) + 1;
    point.total++;
  }
  return [...series.values()];
}

export async function getAgentPerformance(tenantId: string, range: PerformanceRange, from?: string, to?: string, granularity?: Granularity): Promise<AgentPerformanceReport> {
  const store = await getStore();
  const timezone = (await store.tenants.get(tenantId))?.workflowSettings?.timezone ?? "UTC";
  const period = performancePeriod(range, timezone, from, to);
  // Reopen events carry no tenant id, so they are scoped by this tenant's ticket ids.
  const [users, tickets, events, reopens] = await Promise.all([
    store.users.list({ tenantId }), store.tickets.list({ tenantId, deletedAt: null }),
    store.events.list({ tenantId, type: "resolution_recorded" }), store.events.list({ type: "reopened" }),
  ]);
  const ticketIds = new Set(tickets.map((ticket) => ticket.id));
  const reopenEvents = reopens.filter((event) => ticketIds.has(event.ticketId));
  const resolvedGranularity = granularity ?? defaultGranularity(period);
  return {
    period, granularity: resolvedGranularity,
    rows: summarizeAgentPerformance(tenantId, users, tickets, events, period, { reopenEvents }),
    series: buildResolutionSeries(tenantId, events, period, resolvedGranularity),
  };
}

import type { TicketEventRow, TicketRow, UserRow } from "../domain/models";
import { getStore } from "../data";
import { WorkflowError } from "./workflowService";

export type PerformanceRange = "week" | "month" | "year" | "custom";
export interface PerformancePeriod { range: PerformanceRange; timezone: string; from: string; to: string; startAt: string; endBefore: string }
export interface AgentPerformanceRow { id: string; name: string; active: boolean; resolutions: number; liveOpen: number }
export interface AgentPerformanceReport { period: PerformancePeriod; rows: AgentPerformanceRow[] }

function dateFormatter(timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }); }
function dayInZone(date: Date, formatter: Intl.DateTimeFormat): string {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function validDay(value?: string): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100 && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function shiftDay(value: string, days: number) { return new Date(Date.parse(value) + days * 86_400_000).toISOString().slice(0, 10); }
function startOfLocalDay(value: string, formatter: Intl.DateTimeFormat): string {
  // Find the first instant of the local date, including short/long DST days.
  let low = Date.parse(value) - 2 * 86_400_000, high = Date.parse(value) + 2 * 86_400_000;
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
  if (!validDay(from) || !validDay(to) || from > to || Date.parse(to) - Date.parse(from) > 5 * 366 * 86_400_000) throw new WorkflowError("Choose valid start/end dates in order (maximum five years).", 400);
  return { range, timezone, from, to, startAt: startOfLocalDay(from, formatter), endBefore: startOfLocalDay(shiftDay(to, 1), formatter) };
}

export function summarizeAgentPerformance(tenantId: string, users: UserRow[], tickets: TicketRow[], events: TicketEventRow[], period: PerformancePeriod): AgentPerformanceRow[] {
  const rows = new Map<string, AgentPerformanceRow>();
  for (const user of users) if (user.tenantId === tenantId && ["agent", "manager", "tenant_admin", "super_admin"].includes(user.role)) rows.set(user.id, { id: user.id, name: user.name, active: user.active, resolutions: 0, liveOpen: 0 });
  for (const event of events) {
    if (event.tenantId !== tenantId || event.type !== "resolution_recorded" || !event.resolverId || event.createdAt < period.startAt || event.createdAt >= period.endBefore) continue;
    const row = rows.get(event.resolverId) ?? { id: event.resolverId, name: "Former staff member", active: false, resolutions: 0, liveOpen: 0 };
    row.resolutions++; rows.set(row.id, row);
  }
  for (const ticket of tickets) {
    if (ticket.tenantId !== tenantId || ticket.deletedAt || !["new", "open", "in_progress", "pending", "pending_agent", "escalated", "reopened"].includes(ticket.status)) continue;
    const row = ticket.assigneeId ? rows.get(ticket.assigneeId) : null;
    if (row) row.liveOpen++;
  }
  return [...rows.values()].filter((row) => row.active || row.resolutions > 0 || row.liveOpen > 0).sort((a, b) => b.resolutions - a.resolutions || a.name.localeCompare(b.name));
}
export async function getAgentPerformance(tenantId: string, range: PerformanceRange, from?: string, to?: string): Promise<AgentPerformanceReport> {
  const store = await getStore();
  const timezone = (await store.tenants.get(tenantId))?.workflowSettings?.timezone ?? "UTC";
  const period = performancePeriod(range, timezone, from, to);
  const [users, tickets, events] = await Promise.all([store.users.list({ tenantId }), store.tickets.list({ tenantId, deletedAt: null }), store.events.list({ tenantId, type: "resolution_recorded" })]);
  return { period, rows: summarizeAgentPerformance(tenantId, users, tickets, events, period) };
}

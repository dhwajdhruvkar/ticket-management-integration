import { bowEmbed, cosineSimilarity } from "../ai/embeddings";
import type { BusinessCalendarRow, TicketRow, UserRow } from "../domain/models";

export interface AvailabilitySettings {
  calendarId?: string;
  capacity: number;
  override?: "available" | "busy" | "away";
  overrideUntil?: string;
  teamsUserId?: string;
}
export interface PresenceSnapshot { status: "available" | "busy" | "away" | "offline" | "unknown"; checkedAt: string }
export interface AgentAvailability {
  status: "available" | "busy" | "away" | "off_shift" | "offline" | "unconfigured";
  source: "in_app" | "teams";
  reason: string;
  openCount: number;
  capacity: number;
  checkedAt: string;
  until?: string;
  fallback: boolean;
}

export function calculateAvailability(user: UserRow, openCount: number, calendar: BusinessCalendarRow | undefined, mode: "automatic" | "in_app", at = new Date()): AgentAvailability {
  const settings = user.availabilitySettings;
  const capacity = settings?.capacity ?? 5;
  const base: AgentAvailability = { status: "unconfigured", source: "in_app", reason: "Working hours are not configured.", openCount, capacity, checkedAt: at.toISOString(), fallback: mode === "automatic" };
  if (!user.active || user.available === false) return { ...base, status: "away", reason: "Agent is inactive or marked away." };
  if (settings?.override && settings.override !== "available" && settings.overrideUntil && Date.parse(settings.overrideUntil) > at.getTime()) return { ...base, status: settings.override, until: settings.overrideUntil, reason: `Timed ${settings.override} override.` };
  if (openCount >= capacity) return { ...base, status: "busy", reason: `At capacity (${openCount}/${capacity} active tickets).` };
  if (calendar && calendar.tenantId === user.tenantId) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: calendar.timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]));
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (!calendar.workDays.includes(day) || calendar.holidays.includes(date) || Number(parts.hour) < calendar.startHour || Number(parts.hour) >= calendar.endHour) return { ...base, status: "off_shift", reason: `Outside working hours (${calendar.startHour}:00–${calendar.endHour}:00 ${calendar.timezone}) or a holiday.` };
    base.status = "available";
    base.reason = `Within working hours (${calendar.startHour}:00–${calendar.endHour}:00 ${calendar.timezone}); ${capacity - openCount} ticket slots free.`;
  }
  const presence = user.presenceSnapshot;
  const age = presence ? at.getTime() - Date.parse(presence.checkedAt) : Infinity;
  if (mode === "automatic" && presence && age >= 0 && age < 120_000 && presence.status !== "unknown") return { ...base, status: presence.status, source: "teams", reason: `Microsoft Teams: ${presence.status}. Workload capacity still applies.`, checkedAt: presence.checkedAt, fallback: false };
  return base;
}

export const CAPACITY_STATUSES = new Set(["new", "open", "in_progress", "pending_agent", "escalated", "reopened"]);
export function activeWorkload(tickets: TicketRow[], userId: string): number {
  return tickets.filter((ticket) => !ticket.deletedAt && ticket.assigneeId === userId && CAPACITY_STATUSES.has(ticket.status) && (!ticket.workflow || !!ticket.workflow.acceptedAt)).length;
}
export interface AgentSuggestion {
  id: string; name: string; similarResolved: number; bestSimilarity: number; reason: string; availability: AgentAvailability;
}
export function rankExperiencedAgents(ticket: TicketRow, members: UserRow[], history: TicketRow[], availability: Record<string, AgentAvailability>): AgentSuggestion[] {
  const query = bowEmbed(`${ticket.subject} ${ticket.body}`);
  const matches = history.filter((row) => row.id !== ticket.id && row.tenantId === ticket.tenantId && !row.deletedAt && row.resolvedById && row.resolvedAt && ["resolved", "closed"].includes(row.status) && row.category === ticket.category)
    .map((row) => ({ row, similarity: cosineSimilarity(query, bowEmbed(`${row.subject} ${row.body}`)) })).filter(({ similarity }) => similarity >= 0.35);
  return members.filter((user) => user.active && user.tenantId === ticket.tenantId && ["agent", "manager", "tenant_admin", "super_admin"].includes(user.role)).map((user) => {
    const prior = matches.filter(({ row }) => row.resolvedById === user.id);
    return { id: user.id, name: user.name, similarResolved: prior.length, bestSimilarity: Math.max(0, ...prior.map(({ similarity }) => similarity)), availability: availability[user.id],
      reason: prior.length ? `Resolved ${prior.length} similar ${ticket.category} issue${prior.length === 1 ? "" : "s"}.` : "No confidently attributed similar resolutions; ranked by availability and workload." };
  }).sort((a, b) => Number(b.availability.status === "available") - Number(a.availability.status === "available") || b.similarResolved - a.similarResolved || b.bestSimilarity - a.bestSimilarity || a.availability.openCount - b.availability.openCount || a.name.localeCompare(b.name));
}

// =============================================================================
// SLA engine.
//
// Resolves the applicable per-tenant, per-priority policy, computes response /
// resolution due times on a ticket, and reports live SLA health. Deadlines can
// follow a named BusinessCalendar (IANA timezone, working weekdays/window,
// holidays) via policy.calendarId, or the built-in Mon-Fri 9-18 window via the
// legacy businessHoursOnly flag. The clock pauses while a ticket is `pending`
// (waiting on the requester / a third party / an approval): the pause is
// stamped on the ticket and the due dates shift when it resumes.
// =============================================================================

import { getStore } from "../data";
import type {
  BusinessCalendarRow,
  SlaPolicyRow,
  TicketPriority,
  TicketRow,
} from "../domain/models";

// Spec SLA matrix: P1 15m/2h, P2 1h/4h, P3 2h/24h, P4 4h/3d, P5 8h/5d.
const DEFAULT_TARGETS: Record<TicketPriority, { responseMins: number; resolveMins: number }> = {
  critical: { responseMins: 15, resolveMins: 2 * 60 },
  high: { responseMins: 60, resolveMins: 4 * 60 },
  medium: { responseMins: 2 * 60, resolveMins: 24 * 60 },
  low: { responseMins: 4 * 60, resolveMins: 3 * 24 * 60 },
  very_low: { responseMins: 8 * 60, resolveMins: 5 * 24 * 60 },
};

const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 18;

/** Fraction of the SLA window after which a ticket counts as at risk. */
export const AT_RISK_FRACTION = 0.8;

export type SlaLevel = "met" | "on_track" | "at_risk" | "breached";

export interface SlaStatus {
  responseDue: string | null;
  resolveDue: string | null;
  responseBreached: boolean;
  resolveBreached: boolean;
  level: SlaLevel;
  minutesToDeadline: number | null;
  /** Fraction (0..1) of the window to the next deadline already consumed. */
  elapsedFraction: number | null;
  paused: boolean;
}

async function policyFor(tenantId: string, priority: TicketPriority): Promise<SlaPolicyRow | null> {
  const store = await getStore();
  const policies = await store.slaPolicies.list({ tenantId, priority });
  return policies[0] ?? null;
}

/**
 * Compute and persist due times for a ticket.
 *
 * Called at intake and again whenever the priority changes, because the
 * targets are per priority: an escalated ticket that kept its old deadlines
 * would report green while it is actually late. Recomputing always starts from
 * `createdAt` and then re-applies `slaPausedMins`, so time the ticket spent on
 * hold is not silently clawed back by the recalculation.
 */
export async function applySla(ticket: TicketRow): Promise<TicketRow> {
  const store = await getStore();
  const policy = await policyFor(ticket.tenantId, ticket.priority);
  const target = policy
    ? { responseMins: policy.responseMins, resolveMins: policy.resolveMins }
    : DEFAULT_TARGETS[ticket.priority];

  // Named calendar takes precedence; legacy flag keeps the built-in window.
  const calendar = policy?.calendarId ? await store.calendars.get(policy.calendarId) : null;
  const businessOnly = policy?.businessHoursOnly ?? false;

  const created = new Date(ticket.createdAt);
  // Pause credit is wall-clock, matching how slaPausePatch shifts the dates.
  const pauseShiftMs = Math.max(0, ticket.slaPausedMins ?? 0) * 60_000;
  const due = (mins: number) => {
    const base = calendar
      ? addCalendarMinutes(created, mins, calendar)
      : addMinutes(created, mins, businessOnly);
    return new Date(base.getTime() + pauseShiftMs);
  };

  const updated = await store.tickets.update(ticket.id, {
    dueResponseAt: due(target.responseMins).toISOString(),
    dueResolveAt: due(target.resolveMins).toISOString(),
    slaPolicyId: policy?.id ?? null,
  });
  return updated ?? ticket;
}

export function slaStatus(ticket: TicketRow, nowMs = Date.now()): SlaStatus {
  const paused = !!ticket.slaPausedAt;
  // While paused (pending) the clock is frozen at the moment the pause began.
  const refMs = paused ? new Date(ticket.slaPausedAt!).getTime() : nowMs;
  const responded = !!ticket.firstRespondedAt;
  const resolved =
    !!ticket.resolvedAt || ["closed", "auto_resolved", "resolved"].includes(ticket.status);
  const responseDue = ticket.dueResponseAt ? new Date(ticket.dueResponseAt).getTime() : null;
  const resolveDue = ticket.dueResolveAt ? new Date(ticket.dueResolveAt).getTime() : null;

  const responseBreached = responseDue
    ? responded
      ? new Date(ticket.firstRespondedAt!).getTime() > responseDue
      : refMs > responseDue
    : false;
  const resolveBreached = resolveDue
    ? resolved
      ? (ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : refMs) > resolveDue
      : refMs > resolveDue
    : false;

  let level: SlaLevel;
  let minutesToDeadline: number | null = null;
  let elapsedFraction: number | null = null;

  if (resolved) {
    level = responseBreached || resolveBreached ? "breached" : "met";
  } else if (responseBreached || resolveBreached) {
    level = "breached";
  } else {
    const nextDue = !responded ? responseDue : resolveDue;
    if (nextDue) {
      minutesToDeadline = (nextDue - refMs) / 60000;
      const created = new Date(ticket.createdAt).getTime();
      const total = nextDue - created;
      elapsedFraction = total > 0 ? Math.max(0, Math.min(1, (refMs - created) / total)) : null;
      level = elapsedFraction !== null && elapsedFraction >= AT_RISK_FRACTION ? "at_risk" : "on_track";
    } else {
      level = "on_track";
    }
  }

  return {
    responseDue: ticket.dueResponseAt ?? null,
    resolveDue: ticket.dueResolveAt ?? null,
    responseBreached,
    resolveBreached,
    level,
    minutesToDeadline,
    elapsedFraction,
    paused,
  };
}

/**
 * SLA pause bookkeeping for a status transition. Entering `pending` stamps the
 * pause; leaving it accumulates the paused minutes and shifts both due dates
 * forward so the clock effectively stopped while waiting.
 *
 * `slaPausedMins` is the authoritative running total of hold time. The due
 * dates already include it, so nothing downstream should subtract it again;
 * `applySla` re-applies it when it recomputes deadlines from scratch.
 */
export function slaPausePatch(
  ticket: TicketRow,
  nextStatus: TicketRow["status"],
  nowMs = Date.now()
): Partial<TicketRow> {
  const entering = nextStatus === "pending" && ticket.status !== "pending" && !ticket.slaPausedAt;
  const leaving = ticket.status === "pending" && nextStatus !== "pending" && !!ticket.slaPausedAt;

  if (entering) {
    return { slaPausedAt: new Date(nowMs).toISOString() };
  }
  if (leaving) {
    const pausedMs = Math.max(0, nowMs - new Date(ticket.slaPausedAt!).getTime());
    const patch: Partial<TicketRow> = {
      slaPausedAt: null,
      slaPausedMins: (ticket.slaPausedMins ?? 0) + Math.round(pausedMs / 60000),
    };
    if (ticket.dueResponseAt && !ticket.firstRespondedAt) {
      patch.dueResponseAt = new Date(new Date(ticket.dueResponseAt).getTime() + pausedMs).toISOString();
    }
    if (ticket.dueResolveAt) {
      patch.dueResolveAt = new Date(new Date(ticket.dueResolveAt).getTime() + pausedMs).toISOString();
    }
    return patch;
  }
  return {};
}

/**
 * Default Mon-Fri 09:00-18:00 window in the server's own timezone, used when a
 * policy sets `businessHoursOnly` without naming a calendar.
 */
function defaultBusinessCalendar(): CalendarSpec {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    workDays: [1, 2, 3, 4, 5],
    startHour: BUSINESS_START_HOUR,
    endHour: BUSINESS_END_HOUR,
    holidays: [],
  };
}

function addMinutes(from: Date, mins: number, businessOnly: boolean): Date {
  if (!businessOnly) return new Date(from.getTime() + mins * 60000);
  // Same walker as named calendars, so a 15-minute P1 target stays 15 minutes.
  // The previous implementation consumed a whole hour per step, which turned
  // every sub-hour target into an hour and quietly inflated every P1 deadline.
  return addCalendarMinutes(from, mins, defaultBusinessCalendar());
}

// ---------------------------------------------------------------------------
// Named business calendars (timezone + holidays)
// ---------------------------------------------------------------------------

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

interface ZonedParts {
  weekday: number;
  hour: number;
  minute: number;
  /** YYYY-MM-DD in the calendar's timezone (for holiday matching). */
  ymd: string;
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export interface CalendarSpec {
  timezone: string;
  workDays: number[];
  startHour: number;
  endHour: number;
  holidays: string[];
}

/**
 * Add working minutes according to a business calendar. Walks the wall clock
 * in chunks (remaining minutes inside the current window hour, or a jump to
 * the next hour boundary outside the window), re-evaluating the timezone on
 * each step so DST transitions and holidays in the calendar's zone are
 * honored. Bounded to ~1 year of walking as a safety guard.
 */
export function addCalendarMinutes(
  from: Date,
  mins: number,
  calendar: Pick<BusinessCalendarRow, keyof CalendarSpec> | CalendarSpec
): Date {
  const holidays = new Set(calendar.holidays);
  let cursor = new Date(from);
  let remaining = mins;
  let guard = 0;
  const MAX_STEPS = 24 * 366;

  while (remaining > 0 && guard++ < MAX_STEPS) {
    const z = zonedParts(cursor, calendar.timezone);
    const isWorkday = calendar.workDays.includes(z.weekday) && !holidays.has(z.ymd);
    const inWindow = isWorkday && z.hour >= calendar.startHour && z.hour < calendar.endHour;

    if (inWindow) {
      const minutesLeftInHour = 60 - z.minute;
      const step = Math.min(remaining, minutesLeftInHour);
      cursor = new Date(cursor.getTime() + step * 60000);
      remaining -= step;
    } else {
      const minutesToNextHour = 60 - z.minute || 60;
      cursor = new Date(cursor.getTime() + minutesToNextHour * 60000);
    }
  }
  return cursor;
}

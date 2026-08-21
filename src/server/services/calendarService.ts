// =============================================================================
// Business calendars (SLA working hours).
//
// CRUD for named calendars: IANA timezone, working weekdays/window, holidays.
// SLA policies reference a calendar via calendarId; slaService walks deadlines
// through the calendar. Timezones are validated against the Intl database.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { pageCollection, type ListOptions, type PageResult } from "../data/store";
import { newId, now } from "../domain/ids";
import type { BusinessCalendarRow } from "../domain/models";

export class CalendarError extends Error {}

function assertValidTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new CalendarError(`Unknown timezone "${tz}".`);
  }
}

function assertValidWindow(startHour: number, endHour: number, workDays: number[]): void {
  if (startHour < 0 || startHour > 23 || endHour < 1 || endHour > 24 || startHour >= endHour) {
    throw new CalendarError("Invalid working window: require 0 <= start < end <= 24.");
  }
  if (workDays.length === 0 || workDays.some((d) => d < 0 || d > 6)) {
    throw new CalendarError("workDays must be non-empty weekday indexes (0=Sun..6=Sat).");
  }
}

export async function listCalendars(
  tenantId: string,
  options: ListOptions<BusinessCalendarRow> = { orderBy: { field: "name", dir: "asc" } }
): Promise<PageResult<BusinessCalendarRow>> {
  const store = await getStore();
  return pageCollection(store.calendars, { tenantId }, options);
}

export async function createCalendar(
  tenantId: string,
  input: {
    name: string;
    timezone?: string;
    workDays?: number[];
    startHour?: number;
    endHour?: number;
    holidays?: string[];
  },
  actor = "system"
): Promise<BusinessCalendarRow> {
  const timezone = input.timezone ?? "UTC";
  const workDays = input.workDays ?? [1, 2, 3, 4, 5];
  const startHour = input.startHour ?? 9;
  const endHour = input.endHour ?? 18;
  assertValidTimezone(timezone);
  assertValidWindow(startHour, endHour, workDays);

  const store = await getStore();
  const row: BusinessCalendarRow = {
    id: newId("cal"),
    tenantId,
    name: input.name.trim(),
    timezone,
    workDays,
    startHour,
    endHour,
    holidays: (input.holidays ?? []).filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h)),
    createdAt: now(),
    updatedAt: now(),
  };
  await store.calendars.create(row);
  await appendAudit({
    tenantId,
    actor,
    action: "calendar.created",
    payload: { name: row.name, timezone, holidays: row.holidays.length },
  });
  return row;
}

export async function updateCalendar(
  id: string,
  patch: Partial<Pick<BusinessCalendarRow, "name" | "timezone" | "workDays" | "startHour" | "endHour" | "holidays">>,
  actor = "system"
): Promise<BusinessCalendarRow | null> {
  const store = await getStore();
  const existing = await store.calendars.get(id);
  if (!existing) return null;

  const merged = { ...existing, ...patch };
  assertValidTimezone(merged.timezone);
  assertValidWindow(merged.startHour, merged.endHour, merged.workDays);
  if (patch.holidays) {
    patch.holidays = patch.holidays.filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h));
  }

  const updated = await store.calendars.update(id, { ...patch, updatedAt: now() });
  if (updated) {
    await appendAudit({
      tenantId: updated.tenantId,
      actor,
      action: "calendar.updated",
      payload: { name: updated.name },
    });
  }
  return updated;
}

export async function deleteCalendar(id: string, actor = "system"): Promise<boolean> {
  const store = await getStore();
  const existing = await store.calendars.get(id);
  if (!existing) return false;

  // Detach any policies that reference this calendar (fall back to 24x7/flag).
  const policies = await store.slaPolicies.list({ tenantId: existing.tenantId });
  for (const p of policies) {
    if (p.calendarId === id) await store.slaPolicies.update(p.id, { calendarId: null });
  }
  await store.calendars.remove(id);
  await appendAudit({
    tenantId: existing.tenantId,
    actor,
    action: "calendar.deleted",
    payload: { name: existing.name },
  });
  return true;
}

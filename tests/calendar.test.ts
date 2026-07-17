import { describe, expect, it } from "vitest";
import { addCalendarMinutes, type CalendarSpec } from "@/server/services/slaService";

// All expectations are computed in UTC to stay host-timezone independent.

const UTC_CAL: CalendarSpec = {
  timezone: "UTC",
  workDays: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 18,
  holidays: [],
};

describe("addCalendarMinutes", () => {
  it("adds minutes inside the working window without jumps", () => {
    // Wed 2026-07-01 10:00 UTC + 90m -> 11:30 same day.
    const from = new Date("2026-07-01T10:00:00Z");
    const due = addCalendarMinutes(from, 90, UTC_CAL);
    expect(due.toISOString()).toBe("2026-07-01T11:30:00.000Z");
  });

  it("rolls over to the next business day when the window closes", () => {
    // Wed 17:30 + 60m -> 30m today (till 18:00) + 30m tomorrow from 09:00 -> 09:30 Thu.
    const from = new Date("2026-07-01T17:30:00Z");
    const due = addCalendarMinutes(from, 60, UTC_CAL);
    expect(due.toISOString()).toBe("2026-07-02T09:30:00.000Z");
  });

  it("skips weekends", () => {
    // Fri 2026-07-03 17:00 + 120m -> 60m Fri + 60m Mon 09:00-10:00.
    const from = new Date("2026-07-03T17:00:00Z");
    const due = addCalendarMinutes(from, 120, UTC_CAL);
    expect(due.toISOString()).toBe("2026-07-06T10:00:00.000Z");
  });

  it("skips holidays defined in the calendar", () => {
    const withHoliday: CalendarSpec = { ...UTC_CAL, holidays: ["2026-07-02"] };
    // Wed 17:30 + 60m; Thu is a holiday -> lands Fri 09:30.
    const from = new Date("2026-07-01T17:30:00Z");
    const due = addCalendarMinutes(from, 60, withHoliday);
    expect(due.toISOString()).toBe("2026-07-03T09:30:00.000Z");
  });

  it("starts counting at the window open when created out of hours", () => {
    // Wed 02:00 + 30m -> 09:30 the same day.
    const from = new Date("2026-07-01T02:00:00Z");
    const due = addCalendarMinutes(from, 30, UTC_CAL);
    expect(due.toISOString()).toBe("2026-07-01T09:30:00.000Z");
  });

  it("evaluates the window in the calendar's timezone", () => {
    // Asia/Kolkata is UTC+5:30. 05:00 UTC == 10:30 IST (inside the window),
    // so 60 working minutes land at 06:00 UTC.
    const kolkata: CalendarSpec = { ...UTC_CAL, timezone: "Asia/Kolkata" };
    const from = new Date("2026-07-01T05:00:00Z");
    const due = addCalendarMinutes(from, 60, kolkata);
    expect(due.toISOString()).toBe("2026-07-01T06:00:00.000Z");

    // 14:00 UTC == 19:30 IST (after close) -> next IST morning 09:30 == 04:00 UTC.
    const evening = new Date("2026-07-01T14:00:00Z");
    const nextDay = addCalendarMinutes(evening, 30, kolkata);
    expect(nextDay.toISOString()).toBe("2026-07-02T04:00:00.000Z");
  });
});

# Phase C — Agent performance metrics

Goal: per-agent resolved counts for today / this week / this month, a resolved-per-day/week/month series for the selected dates,
average resolution time, SLA compliance, reopened tickets, backlog and ticket aging. No migration; everything derives from existing
`resolution_recorded` and `reopened` events plus tickets. Tickets without a recorded resolver stay excluded (existing rule).

## Files
1. `src/server/services/agentPerformance.ts` (60 lines — read whole). Existing exports: `performancePeriod`, `summarizeAgentPerformance(tenantId, users, tickets, events, period)`, `getAgentPerformance`, types `AgentPerformanceRow`, `AgentPerformanceReport`. Private helpers: `dateFormatter`, `dayInZone`, `shiftDay`.
2. `src/app/api/v1/metrics/agents/route.ts` (15 lines).
3. `src/components/AgentPerformance.tsx` (31 lines).
4. `src/app/page.tsx` — line 196 (usage) and `AgentLeaderboard` lines 1284-1415 only.
5. `tests/agentPerformance.test.ts` — keep existing 3 tests passing; add new ones.

Reference facts (verified): resolution events: `type:"resolution_recorded"`, `resolverId`, `tenantId`, `ticketId`, `createdAt = ticket.resolvedAt` (written in `ticketService.ts` ~line 329). Reopen events: `type:"reopened"`, have `ticketId` but NO `tenantId`/resolver (written in `agentActions.ts` reopenTicket, `requesterReply`, and `ticketAcknowledgement.ts`). So reopen events must be scoped by the tenant's ticket ids. `TicketRow` has `createdAt`, `resolvedAt`, `dueResolveAt`, `slaPausedMins`, `assigneeId`, `status`.

## Implementation (keep `summarizeAgentPerformance` backward compatible — it must still return `AgentPerformanceRow[]`)

Extend the row type:
```ts
export interface AgentPerformanceRow { id: string; name: string; active: boolean; resolutions: number; liveOpen: number;
  resolvedToday: number; resolvedThisWeek: number; resolvedThisMonth: number;
  avgResolutionMins: number | null; slaMet: number; slaMeasured: number; slaCompliance: number | null;
  reopened: number; oldestOpenAgeMins: number | null; avgOpenAgeMins: number | null }
export type Granularity = "day" | "week" | "month";
export interface SeriesPoint { bucket: string; total: number; counts: Record<string, number> }
export interface AgentPerformanceReport { period: PerformancePeriod; granularity: Granularity; rows: AgentPerformanceRow[]; series: SeriesPoint[] }
```
`summarizeAgentPerformance(tenantId, users, tickets, events, period, options: { reopenEvents?: TicketEventRow[]; at?: Date } = {})`:
- `at = options.at ?? new Date()`; build `ticketsById` for the tenant.
- Initialise every new numeric field (0 / `null`) wherever a row is created (both the `rows.set(...)` for users and the "Former staff member" fallback).
- Fixed windows in organization timezone: `today = performancePeriod("custom", period.timezone, d, d, at)` with `d` = local day of `at` (use `dayInZone(at, dateFormatter(period.timezone))`); `week = performancePeriod("week", tz, undefined, undefined, at)`; `month = performancePeriod("month", …)`. Count each tenant `resolution_recorded` event with `resolverId` whose `createdAt` falls in `[startAt, endBefore)` of each window → `resolvedToday/ThisWeek/ThisMonth`. These ignore the selected period; the existing `resolutions` stays period-based.
- For events inside `period`: `avgResolutionMins` = mean over events whose ticket exists of `max(0, (event.createdAt − ticket.createdAt)/60000 − (ticket.slaPausedMins ?? 0))`; `slaMeasured++` when `ticket.dueResolveAt`; `slaMet++` when `Date.parse(event.createdAt) <= Date.parse(ticket.dueResolveAt)`; `slaCompliance = slaMeasured ? slaMet/slaMeasured : null`.
- `reopened`: for each `options.reopenEvents` event within `period` whose ticket is in the tenant, find the latest tenant `resolution_recorded` event for that `ticketId` with `createdAt <= reopen.createdAt`; `reopened++` on that resolver's row.
- Aging: for live-open tickets (existing status list) with an assignee row: `age = (at − createdAt)/60000`; track max → `oldestOpenAgeMins`, mean → `avgOpenAgeMins` (`null` when none).
- Keep the final filter/sort.

New pure `export function buildResolutionSeries(tenantId: string, events: TicketEventRow[], period: PerformancePeriod, granularity: Granularity): SeriesPoint[]`:
iterate local days from `period.from` to `period.to` with `shiftDay`; bucket key = day → `YYYY-MM-DD`; week → Monday of that day (`shiftDay(d, -((new Date(d).getUTCDay() + 6) % 7))`); month → `YYYY-MM`. Pre-create buckets in order (zero filled). For each tenant `resolution_recorded` event with `resolverId` inside the period, key by its local day (`dayInZone(new Date(createdAt), formatter)`), increment `counts[resolverId]` and `total`.
`export function defaultGranularity(period)`: ≤31 days → `"day"`, ≤180 → `"week"`, else `"month"` (days = (Date.parse(to) − Date.parse(from))/86_400_000 + 1).

`getAgentPerformance(tenantId, range, from?, to?, granularity?)`: also load `store.events.list({ type: "reopened" })`, keep those whose `ticketId` belongs to the tenant's tickets, pass as `reopenEvents`; return `{ period, granularity: granularity ?? defaultGranularity(period), rows, series }`.

Route: read `granularity` query param; allow only `day|week|month` else `fail("Invalid granularity.")`; pass through.

## UI
- `AgentPerformance.tsx`: add `granularity` state (`""` = auto, day, week, month) as a `<select>` labelled "Trend by"; include in the query string when set. Note the children type is `(report: AgentPerformanceReport) => ReactNode` — unchanged.
- `page.tsx` line 196: also pass the report: `<AgentLeaderboard metrics={…existing…} users={users} report={report} />`. In `AgentLeaderboard` accept optional `report?: AgentPerformanceReport` (import the type from `@/server/services/agentPerformance`). When provided, render below the existing list a table (class `table` if the file already uses one near line 1300-1400; otherwise a plain styled `<table>` using the panel styles in that component):
  columns Agent | Today | Week | Month | In period | Avg resolution (format as h/m) | SLA met % | Reopened | Backlog | Oldest open. Format `null` as "—". Then a compact "Resolved per {granularity}" table (bucket label, total) from `report.series`. Do not remove the existing leaderboard.

## Tests (add to `tests/agentPerformance.test.ts`)
1. Today/week/month windows in `Asia/Kolkata` with an event at 2026-09-30T20:00Z that is "next day" locally.
2. `avgResolutionMins` subtracts `slaPausedMins`; ticket missing from list is skipped.
3. SLA compliance: one met, one late, one without `dueResolveAt` (not measured) → `1/2`.
4. Reopened is attributed to the resolver of the preceding resolution, not the current assignee; reopen of another tenant's ticket ignored.
5. Aging: two open tickets → oldest and average computed from `at`.
6. `buildResolutionSeries`: zero-filled daily buckets, week bucket starts Monday, month bucket key, events outside period excluded; `defaultGranularity` thresholds.

## Done when
`npx vitest run tests/agentPerformance.test.ts`, `npm run typecheck`, `npm run lint` pass.

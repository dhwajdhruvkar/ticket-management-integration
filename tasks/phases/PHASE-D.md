# Phase D — Live dashboard, status board and filters (run after Phase B)

Goal: staff see open / assigned / in-progress / pending / resolved / overdue / escalated counts that refresh live, can filter ticket lists by
priority, technical group, assignee, category, SLA state and workflow phase, and tiles deep-link into filtered lists. No migration.

Honesty rule: the realtime bus (`src/server/events/bus.ts`) is in-process. On multi-instance serverless hosting a viewer may miss events,
so polling stays as the guarantee. Show the user a small "Live · refreshes every 60 s as a fallback" caption; never claim guaranteed real time.

## Files
1. NEW `src/lib/ticketFilters.ts` (client-safe: import only `type`s from `@/server/domain/models`; NO server imports).
2. NEW `src/lib/useLiveRefresh.ts`.
3. `src/server/services/metricsService.ts` — `Metrics` interface (lines 39-72) and the object returned by `computeMetrics` (lines 156-192). Constants `OPEN`, `RESOLVED` at lines 15-16.
4. `src/app/page.tsx` — `DashboardPage` lines 85-125 (`refresh`), where `<PrimaryKpis …>` is rendered (search the file), `PrimaryKpis` lines 671-735 (pattern for a tile: `Spotlight` + `SpotlightProps`, line 736).
5. `src/components/TicketsExplorer.tsx` — only: imports (top 40 lines), `VIEWS` array (60-110), `TicketsExplorer` (181-221: has `searchParams`, renders `AgentExplorer`), `AgentExplorer` (222-550: state 235-250, `rows` memo ~268-282, JSX table header ~440-470), `SlaLevelCell` (1398-1421, read-only reference). Do NOT edit `MyRequestsView` (663-1250).
6. `src/components/BucketWorkspace.tsx` — `BucketWorkspace` (the `board.settings.buckets.map` block, ~line 46) and its effect with `setInterval(…15000)`.
7. NEW `tests/ticketFilters.test.ts`.

## 1. `ticketFilters.ts`
```ts
import type { TicketRow } from "@/server/domain/models";
export type SlaState = "on_track" | "at_risk" | "breached" | "paused" | "met";
export interface TicketFilters { priority?: string; groupId?: string; assigneeId?: string; category?: string; slaState?: SlaState;
  phase?: string; overdue?: boolean; escalated?: boolean; assigned?: boolean }
export function slaStateOf(t: TicketRow, nowMs = Date.now()): SlaState   // mirror SlaLevelCell (TicketsExplorer.tsx 1398-1421); paused wins for unresolved tickets with slaPausedAt
export function applyTicketFilters(tickets: TicketRow[], f: TicketFilters, nowMs = Date.now()): TicketRow[]
export function filtersFromParams(p: URLSearchParams): TicketFilters
```
Rules: `assigneeId === "unassigned"` → no assignee; `assigned` → has assignee; `overdue` → not resolved and `slaStateOf === "breached"`;
`escalated` → `status === "escalated"` or `workflow?.managerEscalatedAt || rmEscalatedAt || resolutionEscalatedAt`; `phase` → `workflow?.phase === f.phase`.
`filtersFromParams` reads `priority, group, assignee, category, sla, phase, overdue=1, escalated=1, assigned=1`; ignore unknown values (validate `priority` against
`["critical","high","medium","low","very_low"]`, `sla` against `SlaState`). Do not modify `SlaLevelCell`.

## 2. `useLiveRefresh.ts`
```ts
export function useLiveRefresh(onChange: () => void, opts: { enabled?: boolean; debounceMs?: number; pollMs?: number } = {}): void
```
`useEffect`: if disabled return; open `new EventSource("/api/v1/events")` (guard `typeof EventSource === "undefined"`); on message parse JSON, and when `type` is
`"ticket.updated"` or `"notification"` call a debounced (default 2000 ms) `onChange`; `onerror` → leave (browser auto-retries). Also `setInterval` every `pollMs` (default 60000)
calling `onChange` only when `document.visibilityState === "visible"`. Keep `onChange` in a ref; clean up source, timers. (Copy the EventSource handling idea from `src/lib/liveTicket.ts`, do not import from it.)

## 3. Metrics (`metricsService.ts`)
Add to `Metrics` and the returned object:
`assigned: number` (OPEN tickets with `assigneeId`), `inProgress: number` (`byStatus.in_progress ?? 0`), `pending: number` (`pending` + `pending_agent`),
`escalatedTickets: number` (status `escalated` or any workflow escalation marker), `overdue: number` (reuse `slaBreached`), `byWorkflowPhase: Record<string, number>`
(`countBy` over non-closed tickets that have `workflow`, key `workflow.phase`). Keep existing fields untouched (`escalated` there means AI-escalated — do not reuse).

## 4. Dashboard (`page.tsx`)
- New component `StatusBoard({ metrics })`: a responsive grid of 7 links using the same visual language as `Spotlight` (or a simpler `<Link className="panel">` card with big number + label):
  Open (`/tickets?view=all_unsolved`), Assigned (`/tickets?view=all_unsolved&assigned=1`), In progress (`/tickets?view=all_unsolved` — label only if no status filter exists; acceptable to link to `all_unsolved`),
  Pending (`/tickets?view=pending`), Resolved (`/tickets?view=recently_solved`), Overdue (`/tickets?view=all_unsolved&overdue=1`), Escalated (`/tickets?view=all_unsolved&escalated=1`).
  Below it, when `metrics.byWorkflowPhase` is non-empty, a row of chips: phase label (`WORKFLOW_LABELS` from `@/shared/workflow`) + count, linking `/tickets?view=all_unsolved&phase=<phase>`.
  Render `<StatusBoard metrics={metrics} />` directly above `<PrimaryKpis …>`.
- Add a lighter `refreshLive` in `DashboardPage` that only fetches `/metrics` and `/tickets` (no `/audit?verify=1`, no `/users`) and sets `metrics` + `recent`, without toggling the skeleton.
  Call `useLiveRefresh(refreshLive, { enabled: ready && persona.role !== "requester" })` (hooks must run before early returns — place it next to the existing effect at ~line 117).
  Add the honesty caption near the Hero/status area.

## 5. Explorer filters (`TicketsExplorer.tsx`)
- `TicketsExplorer` (181): build `const initialFilters = useMemo(() => filtersFromParams(searchParams), [searchParams])` and `initialView = searchParams.get("view")`; pass `initialFilters`/`initialView` to `AgentExplorer` (extend its props). Also add `useLiveRefresh(refresh, { enabled: …agent… })` where the component knows the persona role (use `usePersona()` already imported in `AgentExplorer`; place the hook inside `AgentExplorer` using its `refresh` prop instead).
- In `AgentExplorer`: `useState<TicketFilters>(initialFilters)`; `activeView` initial = `initialView` if it matches a `VIEWS` id else `"your_unsolved"`. In the `rows` memo, after the view predicate and before the text query, `list = applyTicketFilters(list, filters)`.
  Add `filters` to the memo deps. (Leave `counts` as is.)
- Add an inline `FilterBar` component rendered immediately above the table (find the first `<Th` usage ~line 440 and place the bar in the wrapper above it): selects for Priority (`PRIORITY_ORDER` from `@/shared/priority`), Technical group (`groups`), Assignee (`users` where role !== "requester", plus "Unassigned"), Category (reuse the `CATEGORIES` constant already imported in this file), SLA status (`SlaState` labels), Workflow phase (`WORKFLOW_LABELS`), checkboxes "Overdue only" and "Escalated only", and a "Clear filters" button (disabled when nothing set). Every control needs an accessible label. Show "N of M tickets" text.

## 6. Bucket board
- In `BucketWorkspace`, add a compact filter row (priority, assignee, category, queue health level from `board.queueHealth[ticket.id].level`: on_track|warning|manager|senior_rm|paused|accepted). Compute `const visible = board.tickets.filter(…)` using `applyTicketFilters` for priority/assignee/category plus a health check, and replace the `board.tickets.filter((ticket) => ticket.assignmentGroupId === bucket.groupId)` used per bucket with `visible.filter(…)`. Group is already the bucket sections.
- Add `useLiveRefresh(refresh, { enabled: ready && persona.role === "agent", pollMs: 30000 })` and keep the existing 15 s interval or replace it (if replaced, keep the `visibilitychange` handler).

## 7. Tests — `tests/ticketFilters.test.ts`
Priority/group/assignee/category filters; `assigneeId:"unassigned"`; `overdue` only for open breached tickets (use `dueResolveAt` in the past and `nowMs` injected); `paused` precedence;
`escalated` via status and via workflow marker; `phase`; `filtersFromParams` ignores invalid values. Run also `npx vitest run tests/sla.test.ts tests/escalation.test.ts` to confirm nothing else regressed.

## Done when
`npx vitest run tests/ticketFilters.test.ts`, `npm run typecheck`, `npm run lint` pass. Manually confirm in the final answer that no hook is called conditionally.

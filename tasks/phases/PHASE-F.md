# Phase F — Context-aware priority and urgency

Goal: priority/urgency use subject, description, chosen category, ticket type, "how many people are affected", "can you still work?", VIP status and
security/outage signals, produce a list of human-readable factors, and are consistent with or without an LLM. Staff override with reason stays. No migration.

Current behaviour (verified): `classifyTicket(subject, body)` in `src/server/ai/aiService.ts` returns `{source, explanation, category, impact, urgency, priority, sentiment}` from the LLM or `heuristicClassify`;
`intakeTicket` (`src/server/services/intake.ts` lines 25-60) classifies only when category or priority is missing and then applies a VIP urgency floor; the new-ticket form always sends a category.

## Files
1. `src/server/ai/aiService.ts` — `CATEGORIES` const (line ~23), `Classification` interface (~34), `classifyTicket` (~44-70), `heuristicClassify` (~170-200).
2. `src/server/services/intake.ts` — lines 25-60 (`intakeTicket` start).
3. `src/server/services/ticketService.ts` — only `NewTicketInput` interface (line 51-75).
4. `src/app/api/v1/tickets/route.ts` — POST validation block (lines ~96-125, before `priorityMode` handling).
5. `src/app/api/v1/tickets/classification/route.ts` (21 lines).
6. `src/components/PriorityPreview.tsx` (31 lines).
7. `src/components/TicketsExplorer.tsx` — `NewTicketForm` lines 1514-1710 (state 1525-1536, submit payload 1541-1550, "What happened?" section ~1620-1635, `<PriorityPreview …/>` line 1655).
8. `tests/aiService.test.ts` (keep both existing tests passing), `tests/priority.test.ts`.

## Steps
### aiService.ts
```ts
export interface ClassificationContext { category?: TicketCategory; type?: "incident" | "service_request";
  affectedPeople?: "one" | "team" | "many"; workStopped?: boolean; vip?: boolean }
```
- `export const CATEGORIES` (add `export`); `Classification` gets `factors: string[]`.
- `classifyTicket(subject, body, context?: ClassificationContext)`: compute the base result exactly as now (LLM, else heuristic; add `factors: []` to both), then
  `return applyBusinessRules(base, `${subject}\n${body}`, context)`. Do not call the LLM differently.
- `export function applyBusinessRules(base: Classification, text: string, context?: ClassificationContext): Classification` — floors only ever RAISE, never lower:
  - `workStopped === true` → `urgency = "high"` factor "Requester cannot work".
  - `affectedPeople === "many"` → `impact = "high"` factor "Many people affected"; `"team"` → impact at least `"medium"` factor "Whole team affected".
  - `/(phish|malware|ransomware|breach|compromis|virus|unauthori[sz]ed access|data leak)/i` → impact `"high"` and urgency at least `"medium"`, and priority at least `"high"`; factor "Possible security incident".
  - `/(outage|down for (everyone|all)|all users|entire (office|company))/i` → impact `"high"`; factor "Service outage wording".
  - `context?.vip` → urgency `"high"`; factor "VIP requester".
  - Keep the original category unless `context?.category` is set (then the category is the requester's choice; do not change it).
  - Recompute `priority = derivePriority(impact, urgency)`; if the security rule fired, raise to `"high"` if currently lower (use `PRIORITY_ORDER` from `../domain/priority` for comparison). Level helper: `const rank = { low: 0, medium: 1, high: 2 }`.
  - `factors` accumulates; `explanation = base.explanation + (factors.length ? " Factors: " + factors.join("; ") + "." : "")`.
- Existing tests call `classifyTicket(subject, body)` without context and must keep their results (the keywords in them are urgent/outage → `critical` still).

### intake.ts
- `NewTicketInput` (ticketService.ts): add `affectedPeople?: "one" | "team" | "many"; workStopped?: boolean;`.
- In `intakeTicket`, hoist `let cls: Classification | null = null;`, pass `{ category: input.category, type: input.type, affectedPeople: input.affectedPeople, workStopped: input.workStopped }` to `classifyTicket`; **but** `classifyTicket` must not override `input.category` (existing `input.category = input.category ?? cls.category` already keeps it).
  Move the VIP lookup before classification if needed so `vip` can be passed; the existing VIP block after it may stay (it only raises).
- After `createTicket`, when `cls` exists, `await appendAudit({ tenantId, actor: "classifier", action: "ticket.priority_assessed", ticketId: created.id, payload: { source: cls.source, impact: cls.impact, urgency: cls.urgency, priority: cls.priority, factors: cls.factors } })`.
- `NewTicketInput` fields must not be persisted (createTicket ignores unknown fields; verify it does not spread `input` into the row).

### POST /tickets validation
Before `priorityMode` handling: `if (body.affectedPeople !== undefined && !["one","team","many"].includes(body.affectedPeople as string)) delete body.affectedPeople;` and `if (typeof body.workStopped !== "boolean") delete body.workStopped;`.

### classification route
Extend zod `Input`: `category: z.enum(CATEGORIES as [string, ...string[]]).optional()` (import `CATEGORIES`; cast to the tuple type or build with `z.string().refine`), `type: z.enum(["incident","service_request"]).optional()`, `affectedPeople: z.enum(["one","team","many"]).optional()`, `workStopped: z.boolean().optional()`; pass as context.

### UI
- `PriorityPreview` props: `{ subject, body, category?, type?, affectedPeople?, workStopped? }`; include them in the POST body and effect deps; show `Impact: x · Urgency: y` next to the badge and the explanation (which now lists factors).
- `NewTicketForm`: add state `affectedPeople` (`"one"` default) and `workStopped` (false); in the "What happened?" section add a `<select aria-label="People affected">` (Just me / My team / Many people) and a checkbox "I cannot work because of this"; send both in the `submit()` payload and pass to `PriorityPreview` together with `category` and `type`. Reset on success.

## Tests
`tests/aiService.test.ts` add: `workStopped` raises urgency; `many` raises impact; security wording forces ≥ `high`; floors never lower an already-high result; explanation lists factors; no context ⇒ identical to before.
Also `npx vitest run tests/priority.test.ts tests/aiService.test.ts tests/externalIntegration.test.ts tests/itil.test.ts`.

## Done when
Those tests, `npm run typecheck`, `npm run lint` pass.

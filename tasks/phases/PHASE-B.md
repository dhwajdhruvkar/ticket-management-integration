# Phase B — AI-assisted department + agent recommendation (run after Phase A)

Goal: when a ticket sits in the Service Desk bucket, the reviewer can open "Suggest department" and see ranked technical groups with
reasons and evidence drawn from (1) similar previously resolved tickets, (2) knowledge-base article matches, (3) recurring issues,
(4) group category mapping, (5) current availability; plus ranked agents for the top group. Advisory only — a human still routes.
No migration. Computed lazily (one request per opened panel) to avoid embedding cost on every board refresh.

## Files

Edit/create:
1. NEW `src/server/services/routingRecommendation.ts`
2. `src/app/api/v1/tickets/[id]/workflow/route.ts` — add a `GET` (currently only `POST`; 16 lines, read it whole).
3. `src/server/services/workflowService.ts` — only `WorkflowActionSchema` (line ~28) and the event `meta` in `transitionWorkflow` (~line 191).
4. `src/components/BucketWorkspace.tsx` — `BucketTicket`.
5. NEW `tests/routingRecommendation.test.ts`

Read-only reference (signatures only):
- `src/server/services/availabilityService.ts` (60 lines): `calculateAvailability`, `activeWorkload`, `rankExperiencedAgents`, `AgentSuggestion`, `AgentAvailability`.
- `src/server/ai/vectorSearch.ts`: `search(tenantId, query, k)` → `{ hits: { article: ArticleRow; score }[] }`.
- `src/server/ai/embeddings.ts`: exports `bowEmbed`, `cosineSimilarity`.
- `src/server/services/workflowBoard.ts` lines 25-55: copy how it loads `tenant`, `groups`, `allTickets`, `users`, `calendars` and builds the `availability` map (do not call Teams presence here).
- `src/server/domain/models.ts`: `TicketRow` (159), `ArticleRow` (276: has `category`), `AssignmentGroupRow` (221: has `categories`, `memberIds`).

## Design — `routingRecommendation.ts`
```ts
export interface GroupRecommendation { groupId: string; name: string; score: number; confidence: "high"|"medium"|"low"; reasons: string[];
  evidence: { tickets: { id: string; reference: string; subject: string }[]; articles: { id: string; title: string }[] }; availableMembers: number }
export interface RoutingRecommendation { groups: GroupRecommendation[]; recurring: { count: number; problemId: string | null } | null;
  agents: AgentSuggestion[]; basis: string }
export interface ScoreInput { ticket: TicketRow; departmentGroups: AssignmentGroupRow[]; history: TicketRow[]; kbHits: { article: ArticleRow; score: number }[];
  availableCount: Record<string, number>; now?: number }
export function scoreGroups(input: ScoreInput): { groups: GroupRecommendation[]; recurring: RoutingRecommendation["recurring"] }   // PURE
export async function recommendRouting(tenantId: string, ticketId: string, actorId: string): Promise<RoutingRecommendation>
```
`scoreGroups` rules (department groups only = groups whose id is in a `kind==="department"` bucket):
- Text = `${subject} ${body}`; `bowEmbed` once for the ticket.
- History rows: same tenant, not deleted, `resolvedById`, `resolvedAt`, status resolved/closed, `assignmentGroupId` in departmentGroups, not the ticket itself.
  `sim = cosineSimilarity(...)`; keep `sim >= 0.35`. Group score += `sim * (resolvedAt within 90 days of now ? 1 : 0.6)`; collect up to 3 evidence tickets per group (highest sim).
- KB: each hit with `score >= 0.3` adds `0.5 * score` to every department group whose `categories` includes `article.category`; collect up to 3 article refs.
- Static fallback: group `categories` includes `ticket.category` → `+0.25` and reason "Group owns the <category> category."
- Recurring: other tickets (same tenant, created within last 30 days, `sim >= 0.5`) count ≥ 3 → `recurring = { count, problemId: first non-null problemId || null }`; add reason "Recurring issue (N similar in 30 days)" to the top group.
- Availability: if `availableCount[groupId] === 0` → `score *= 0.7`, reason "No member is available right now."
- Reasons are human sentences ("Resolved 4 similar tickets in this group", "2 matching knowledge articles"). Sort by score desc, then name; return top 3.
- `confidence`: `high` if score ≥ 1, `medium` if ≥ 0.5, else `low`. No evidence at all → empty `groups` array (honest "no evidence").
`recommendRouting`: verify actor is an active staff user of the tenant who is a manager role OR member of the Service Desk group; ticket must be in the
tenant, not deleted, `workflow.phase === "service_desk"`; throw `WorkflowError` (exported from `workflowService.ts`) 403/404/409 otherwise. History = 500 most recent
resolved tickets (same cap as `workflowBoard.ts`). KB via `search(tenantId, text, 4)`. `agents` = `rankExperiencedAgents(ticket, members of top group, history, availability).slice(0, 5)`.
`basis` = short string stating the number of history rows and KB hits examined.

## Route
```ts
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission(req, "ticket.write");
  if (isResponse(ctx)) return ctx;
  if (ctx.actor.apiKeyId || !ctx.actor.id) return fail("A staff account is required.", 403);
  try { return ok(await recommendRouting(ctx.tenantId, (await params).id, ctx.actor.id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { if (error instanceof WorkflowError) return fail(error.message, error.status); throw error; }
}
```
(import `recommendRouting`.)

## Measuring accuracy (small)
- `WorkflowActionSchema`: add `suggestedGroupId: z.string().max(100).optional()`.
- In `transitionWorkflow` event `meta` add `...(input.suggestedGroupId ? { suggestedGroupId: input.suggestedGroupId, followedSuggestion: input.suggestedGroupId === result.assignmentGroupId } : {})`.

## UI — `BucketTicket`
For `workflow.phase === "service_desk" && (board.canDispatch || workflow.reviewerId === actorId)` render
`<details onToggle={(e) => e.currentTarget.open && loadSuggestions()}><summary>Suggest department (AI-assisted, advisory)</summary> … </details>`.
`loadSuggestions` → `apiGet<RoutingRecommendation>(`/tickets/${ticket.id}/workflow`)` once (state: `rec`, `recError`, loading). Render each group:
name, confidence badge, reasons list, evidence links (`/tickets/<id>` for tickets), a button "Use this department" → `setGroupId(rec.groupId)`. Show the recurring warning and
"No confident recommendation — choose manually" when `groups` is empty. Show the top agents list for context. Pass `suggestedGroupId: rec?.groups[0]?.groupId` inside the `act()` payload when action is `route`.
Import the type with `import type { RoutingRecommendation } from "@/server/services/routingRecommendation";`.

## Tests — `tests/routingRecommendation.test.ts` (test pure `scoreGroups` with hand-built rows)
1. Group with two similar resolved tickets outranks a group with none; evidence lists those tickets.
2. KB-only signal ranks the group whose `categories` includes the article category.
3. Cold start (no history/KB) → falls back to category mapping with low confidence; with no mapping returns `[]`.
4. Other-tenant tickets and tickets without `resolvedById` are ignored.
5. Group with zero available members is penalised below an equal group with availability.
6. ≥3 similar recent tickets → `recurring` set; <3 → `null`.
Also run `tests/bucketWorkflow.test.ts` and `tests/openapi.test.ts`.

## Done when
`npx vitest run tests/routingRecommendation.test.ts tests/bucketWorkflow.test.ts tests/openapi.test.ts`, `npm run typecheck`, `npm run lint` pass.

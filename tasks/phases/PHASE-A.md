# Phase A — Return to Service Desk + anti-misroute

Goal: any department member/assignee/manager can send a ticket back to the common Service Desk queue with a mandatory
reason. The Service Desk re-reviews and routes it. Repeated misrouting is limited. No DB migration (`workflow` is JSON).

## Files (read + edit only these)

1. `src/shared/workflow.ts` — interface `TicketWorkflow` (lines 18-40).
2. `src/server/services/workflowService.ts` — import line 9; `WorkflowActionSchema` lines 28-31; `transitionWorkflow` lines 137-200
   (`switch (input.action)` starts ~line 153; `case "route"` ~158; `case "decline"/"release"` ~180; `updateIf` ~190; event+`queueLifecycle` ~191-193).
3. `src/components/BucketWorkspace.tsx` — `BucketTicket` (line 53 on): `act()` line 62, `button()` line 68, reviewer line ~73, return-reason input ~89.
4. `tests/bucketWorkflow.test.ts` — has `fixture()` (users: admin=tenant_admin, manager, rm, desk, agent, other; groups
   `desk-group`[desk], `it-group`[agent, other]; ticket id `ticket`). Add cases here.
5. `docs/SERVICE_DESK_WORKFLOW.md` — add 3-4 lines under "3. Department ownership".

Read-only reference (do not edit): `src/server/notify/workflowOutbox.ts` (`queueWorkflowNotice` line ~19, `LIFECYCLE` map).

## Steps

### 1. `src/shared/workflow.ts`
Add to `TicketWorkflow` (after `resolutionRmEscalatedAt`):
```ts
/** Misrouting history; every Service Desk return is appended and never removed. */
returns?: { at: string; byId: string; fromGroupId: string; reason: string }[];
```
Do NOT delete `returns` anywhere (reopen paths in `workflowMutationPatch` and `ticketAcknowledgement.ts` keep it as-is).

### 2. `workflowService.ts`
- Import: `import { queueLifecycle, queueWorkflowNotice } from "../notify/workflowOutbox";`
- Add `"return_to_service_desk"` to the `z.enum([...])` in `WorkflowActionSchema` (this also updates the OpenAPI doc automatically).
- New `case "return_to_service_desk"` in the switch:
```ts
case "return_to_service_desk": {
  if (!input.reason?.trim()) throw new WorkflowError("A reason is required.", 400);
  if (!["department", "awaiting_acceptance", "in_progress"].includes(workflow.phase)) throw new WorkflowError("Only a ticket in a department bucket can be returned to the Service Desk.");
  if (!manager && !member && ticket.assigneeId !== user.id) throw new WorkflowError("Only a member of the current group, its assignee or a manager can return this ticket.", 403);
  if (!settings.serviceDeskGroupId) throw new WorkflowError("The Service Desk bucket is not configured.", 400);
  const returns = [...(workflow.returns ?? []), { at: stamp, byId: user.id, fromGroupId: ticket.assignmentGroupId ?? "", reason: input.reason.trim() }];
  Object.assign(workflow, { phase: "service_desk", returns, queuedAt: stamp, queuedPauseMins: ticket.slaPausedMins ?? 0, queueWorkingPauseMins: 0, visitId: newId("visit") });
  for (const key of ["reviewerId", "reviewedAt", "acceptedAt", "acceptedById", "warningAt", "managerEscalatedAt", "rmEscalatedAt", "resolutionEscalatedAt", "resolutionRmEscalatedAt"] as const) delete workflow[key];
  patch.assignmentGroupId = settings.serviceDeskGroupId; patch.assigneeId = null; patch.status = "open";
  break;
}
```
- In `case "route"`, after the `target` lookup and before `Object.assign(workflow, …)`, add the anti-ping-pong guard:
```ts
const returned = workflow.returns ?? [];
const repeat = returned.some((entry) => entry.fromGroupId === target.groupId) || returned.length >= 2;
if (repeat && !manager) throw new WorkflowError("This ticket was returned from that group or has been returned repeatedly. A manager must route it.", 403);
if (repeat && !input.reason?.trim()) throw new WorkflowError("Give a reason for routing a ticket that was previously returned.", 400);
```
- After the `const event = await tx.events.create(...)` line and before/after `queueLifecycle(...)`, add: when
  `input.action === "return_to_service_desk" && (workflow.returns?.length ?? 0) >= 2`, notify the Service Desk bucket manager:
```ts
const deskBucket = settings.buckets.find((bucket) => bucket.groupId === settings.serviceDeskGroupId);
const deskManager = deskBucket ? await tx.users.get(deskBucket.managerId) : null;
if (deskManager?.active && deskManager.tenantId === tenantId) await queueWorkflowNotice(tx, result, event.id, deskManager.email, `[${result.reference}] Ticket returned to the Service Desk ${workflow.returns!.length} times`, `${result.reference}: ${result.subject}\nThis ticket keeps being misrouted. Please review and route it.`);
```
  (`queueLifecycle` needs no change: `LIFECYCLE` has no entry for the new event type, so the requester gets no email — correct.)
- Leave `decline` and `release` unchanged (agent → own department bucket).

### 3. `BucketWorkspace.tsx` (`BucketTicket`)
- Add state `const [deskReason, setDeskReason] = useState("");` and change `act` to `async function act(action, reasonText = reason)` using
  `reason: reasonText || undefined`.
- Add helper `const staffName = (id?: string) => board.staff.find((user) => user.id === id)?.name ?? "Former staff member";`
- Below the "Reviewer:" line add, when `workflow.returns?.length`:
  `Returned to Service Desk {n}× — last by {staffName(last.byId)}: "{last.reason}"` (class `muted`).
- Add a block shown when `["department","awaiting_acceptance","in_progress"].includes(workflow.phase) && (board.canDispatch || ticket.assigneeId === actorId || group?.memberIds.includes(actorId))`:
  an `<input className="input" aria-label={`Reason for returning ${ticket.reference} to the Service Desk`} maxLength={500} placeholder="Wrong group? Explain why">` bound to `deskReason`, and a button
  "Return to Service Desk" → `act("return_to_service_desk", deskReason)`, disabled while `!deskReason.trim()`. Clear `deskReason` after a successful call.
- The existing `button()` helper disables on hold; reuse it only if it can pass the reason (otherwise write the `<button className="btn">` inline with `disabled={busy || onHold || !deskReason.trim()}`).

### 4. Tests — add to `tests/bucketWorkflow.test.ts` (use `fixture()`)
1. Desk claims + routes to `it-group`; member `other` (unaccepted ticket, phase `department`) returns with a reason → phase `service_desk`,
   `assignmentGroupId === "desk-group"`, `assigneeId` null, `reviewerId` undefined, `workflow.returns` length 1 with `fromGroupId: "it-group"`, new `visitId`.
2. After `pickup` by `agent` (phase `in_progress`), `agent` returns → same result; `acceptedAt` cleared.
3. Missing/blank reason rejected (status 400); `desk` (not member of `it-group`, not manager) rejected 403; user from another tenant rejected.
4. After one return, a non-manager reviewer (`desk`) cannot route back to `it-group` (403); `manager` can only with a reason (400 without).
5. After two returns, a non-manager cannot route anywhere; `manager` can with a reason.
6. Return resets timers: `queuedAt` changed and `warningAt`/`managerEscalatedAt`/`rmEscalatedAt` undefined.
7. Second return queues a notification delivery for the desk manager (check `store.notifications.list({ toAddress: "manager@example.test" })`
   or `store.notificationDeliveries` — inspect the memory store API in an existing test such as `tests/workflowDelivery.test.ts` if needed).

### 5. Docs
In `docs/SERVICE_DESK_WORKFLOW.md` item 3 add: members of a department bucket (or the assignee/manager) can return a wrongly routed ticket to the
Service Desk with a reason; the pickup clock restarts, a return count is shown, and after two returns or a re-route to a group that already
returned it, only a manager can route it, with a reason.

## Done when
`npx vitest run tests/bucketWorkflow.test.ts tests/openapi.test.ts` passes, then `npm run typecheck`, `npm run lint`.

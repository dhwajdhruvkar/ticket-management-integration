# Remaining service-desk work — index

Source basis: branch `claude/service-desk-ticket-system-b1e9f6` at `79cc443` (2026-10-13). Executable, file-level instructions live in
[`tasks/phases/`](phases/README.md) — start with `README.md`, then run one `PHASE-*.md` per session.

## Requirement status

| # | Requirement | Status | Phase |
|---|---|---|---|
| 1 | Who & Where selection | Partial (search exists; no location / browse / combobox) | G |
| 2 | Auto priority + urgency | Mostly done (subject+body only) | F |
| 3 | Common Service Desk queue | **Done** | — |
| 4 | SLA escalation (bucket + resolution) | **Done in code**; needs the external minute scheduler (ops) | — |
| 5 | Real-time dashboard + filters | Partial | D |
| 6 | AI routing / resolution recommendations | Partial (agents only) | B |
| 7 | Agent performance metrics | Partial (counts only) | C |
| 8 | Attachments in chat | Partial (side panel only; production storage disabled without Azure) | E1, E2 |
| 9 | SD intake, return to SD with reason | Gap (returns go to the department bucket) | A, B |

## Owner decisions (2026-10-13)
Return-to-SD restarts the pickup clock and shows a return count · "Who" = all active org users · internal-note files hidden from requesters ·
no Azure → database-backed attachments capped at 4 MB · Entra/SSO directory sync postponed (not planned in this set).

## Operational activation still required (no code)
External minute scheduler with `CRON_SECRET`, Brevo sender, bucket/manager/RM configuration, `ATTACHMENT_STORAGE=database` after Phase E1's migration is applied
(isolated Neon branch first, then production, then deploy). See `docs/SERVICE_DESK_WORKFLOW.md`.

## Notes
- `enterWorkflow` (`workflowService.ts`) is used only by tests; real enrolment is inline in `ticketService.ts` (~line 241).
- Vercel limits request bodies to about 4.5 MB, hence the 4 MB attachment cap. Verify against current Vercel docs before raising it.
- The realtime event bus is in-process; polling remains the delivery guarantee on serverless hosting.

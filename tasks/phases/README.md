# Phase execution guide (for a smaller model: read this first, then ONE phase file)

Repo: Next.js 16 + React 19 + Prisma + Vitest, TypeScript. Line numbers below are from commit `79cc443`; if they have
drifted, find the symbol named next to the number. Never read a file that a phase file does not list.

## Order and dependencies

| Order | File | Delivers | Touches shared files |
|---|---|---|---|
| 1 | `PHASE-A.md` | Return ticket to Service Desk + anti-misroute (req 9) | `workflowService.ts`, `BucketWorkspace.tsx` |
| 2 | `PHASE-B.md` | AI department/agent recommendation (req 6, 9) | same two files — run after A |
| 3 | `PHASE-C.md` | Agent performance metrics (req 7) | independent |
| 4 | `PHASE-D.md` | Live dashboard + filters (req 5) | `BucketWorkspace.tsx` — run after B |
| 5 | `PHASE-E1.md` | Attachment storage without Azure (database) + schema | **only phase with a migration** |
| 6 | `PHASE-E2.md` | Attachments inside the conversation (req 8) | needs E1 |
| 7 | `PHASE-F.md` | Context-aware priority/urgency (req 2) | `TicketsExplorer.tsx` NewTicketForm, tickets POST route |
| 8 | `PHASE-G.md` | Who & Where picker with location (req 1) | same form/route — run after F |

Deferred by owner (do not build): directory sync from Microsoft Entra / SSO. The `User.externalId` column stays unused.

## Owner decisions already made

1. Returning a ticket to the Service Desk **restarts the pickup clock** and keeps a visible return count.
2. "Who" list = all **active users of the organization** (any role); no extra sign-in filter.
3. Files attached to **internal notes are hidden from requesters**.
4. **No Azure** — attachments are stored in the existing Postgres database, capped at 4 MB per file.
5. Directory/SSO integration is postponed.

## Rules for every phase

- Obey `AGENTS.md`: never commit, push, deploy, or run `prisma migrate`/`db push`/seed. You may run `npx prisma validate`
  and `npm run db:generate`. No secrets in files. Do not edit `.agents/` content.
- Preserve unrelated changes; touch only the listed files (plus new files named in the phase).
- Match local style (dense, few comments, zod validation, tenant checks via `tenantId`). Reuse existing helpers.
- Tenant isolation and role checks are server-side. Never trust client ids; always scope by `tenantId`.
- Verification at the end of each phase, in this order, and report real output (do not claim success without running):
  `npx vitest run <the phase's test files>` → `npm run typecheck` → `npm run lint`. Run the full `npm test` once at the end.
- If a listed anchor does not exist, or a change needs a file not listed, stop and report instead of guessing.
- Final answer for the phase: files changed, tests added, commands run with pass/fail, anything not done.

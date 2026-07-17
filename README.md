# Netlink Support — AI-First ITSM Platform

A production-grade, AI-first IT Service Management platform: the AI resolves
tickets **before an agent ever sees them**, every decision is recorded in a
**tamper-evident audit chain**, and the full **ITIL** module set (Incident,
Service Request, Problem, Change, Asset/CMDB, Knowledge) sits on top of a real
backend with Microsoft Entra ID SSO, RBAC, SLAs, an automation engine, and
omnichannel intake.

## Runs two ways

The same codebase runs with **zero infrastructure** for demos and against
**Postgres + Azure** for production — selected by a single env var.

| Capability | Demo default (no infra) | Production |
|---|---|---|
| Data | In-memory + JSON file (`.data/store.json`) | Postgres + Prisma (`DATA_DRIVER=prisma`) |
| Embeddings | Hashed bag-of-words (384-dim) | Azure OpenAI embeddings |
| LLM answers | Offline grounded template | Azure OpenAI / Gemini / Groq |
| Auth | Demo credential sign-in | Microsoft Entra ID SSO |
| Jobs | In-process scheduler | BullMQ + Redis |
| Channels / notify | Recorded in-app | M365 Graph email + Teams |

Every external dependency is optional and degrades gracefully — nothing is
required to run.

## Quick start

```bash
npm install
npm run dev
# http://localhost:3000
```

Seeds itself on first run (one tenant, agents/manager/requester, SLA policies,
knowledge base, demo tickets across ITIL types, assets/CIs, automations).

### With Postgres (production data layer)

```bash
docker compose up -d            # Postgres (pgvector) + Redis
# set DATA_DRIVER=prisma in .env
npm run db:push                 # create the schema
npm run db:seed                 # load the same demo dataset
psql "$DATABASE_URL" -f prisma/sql/001_pgvector.sql   # optional: ANN vector index
npm run dev
```

## How intake works (ITIL-aligned)

```
 new ticket (any channel: portal, email, Teams, webhook, monitoring alert, API)
   │  auto-classify (category + impact × urgency + sentiment)
   ▼
 priority matrix (P1 critical … P5 very_low)
   ▼
 SLA due dates → acknowledgement email → approval hold (catalog items)
   ▼
 group routing (category → assignment group) → automation rules → AI resolver
   │  retrieve (vector search) → generate (grounded answer) → score → decide
   ├── confidence ≥ 0.78 → auto-resolve (reply + resolve; P1 never auto-closes)
   ├── confidence ≥ 0.55 → suggest a draft for an agent
   └── otherwise          → escalate to a human
```

### ITIL specifics

- **Priority** is derived from Impact × Urgency (H/H→P1 … L/L→P5). Manual
  overrides require a justification and are recorded in the audit chain.
- **References** are type-prefixed: `INC-`, `REQ-`, `PRB-`, `CHG-`.
- **SLA matrix (default)**: P1 15m/2h · P2 1h/4h · P3 2h/24h · P4 4h/3d ·
  P5 8h/5d (response/resolution). The clock **pauses** while a ticket is
  `pending` and the deadlines shift when it resumes.
- **Staged escalation**: at 80 % of the window the ticket is tagged
  `sla_at_risk` and the assignee + manager are warned; on breach it is
  escalated automatically and alerts go out.
- **Assignment groups** own categories (e.g. Network → Network Operations) and
  intake routes tickets to the matching group before automation rules run.
- **Service-request approvals**: catalog items flagged `requiresApproval` hold
  the ticket (SLA paused) with an Approval for the manager; approving resumes
  fulfilment, rejecting cancels — both notify the requester.
- **Notifications** are templated (created/assigned/pending/resolved/closed/
  reopened/approval/SLA warning/SLA breach) and delivered via Graph email or
  Teams when configured, always recorded in-app.
- **Monitoring alerts**: `POST /api/v1/intake` with `channel: "alert"` maps
  severity → impact × urgency and links the named CMDB CI to the incident.
- **RBAC & record security**: requesters only ever see their own tickets;
  writes require agent+ permissions; approvals require manager+.

Every step appends a SHA-256 hash-linked block to the per-tenant **audit chain**
(`/api/v1/audit?verify=1` recomputes it and pinpoints any tampering).

## Architecture

Next.js (App Router) full-stack monolith using a ports-and-adapters design.

```
src/
├─ server/                 # server-only domain core
│  ├─ config.ts            # env + feature detection
│  ├─ data/                # DataStore PORT + memory & prisma ADAPTERS + seed
│  ├─ domain/              # normalized row models + id helpers
│  ├─ audit/               # tamper-evident hash chain (Node crypto)
│  ├─ ai/                  # embeddings, vector search, LLM, resolver, AI service
│  ├─ services/            # tickets, kb, agentActions, problems, changes,
│  │                       #   assets, sla, automation, intake, metrics
│  ├─ auth/                # RBAC matrix
│  ├─ channels/            # M365 Graph email, Teams
│  ├─ notify/              # email/Teams/in-app notifications
│  └─ jobs/                # background scheduler (SLA sweep, auto-close, poll)
├─ app/
│  ├─ api/v1/…             # REST API (tickets, kb, problems, changes, assets,
│  │                       #   cis, automations, metrics, reports, audit, intake…)
│  ├─ api/auth/…           # Auth.js (NextAuth v5)
│  ├─ problems, changes, assets, analytics, portal, signin …
│  └─ (existing tickets/kb/audit/dashboard UI)
├─ auth.ts / auth.config.ts / middleware.ts
└─ instrumentation.ts      # starts the job scheduler on boot
```

Swapping persistence is one env var: services depend only on the `DataStore`
port (`src/server/data/store.ts`), implemented by both `memoryStore` and
`prismaStore`.

## Modules

- **Incident / Service Request** — AI triage, impact × urgency priorities,
  conversation threads, group + agent assignment, CI linking.
- **Problem Management** — RCA, known-error DB, AI incident clustering.
- **Change Management** — change types, AI risk scoring, CAB approval workflow.
- **Asset / CMDB** — inventory, CI dependency graph, impact analysis,
  ticket ↔ CI links.
- **Knowledge** — versioned articles, draft→review→publish, embedded on write.
- **Automation** — when/if/then rules with dry-run.
- **SLA** — per-tenant/priority policies, business hours, pause on pending,
  staged escalation (80 % warning → breach escalate).
- **Approvals** — manager sign-off for flagged catalog requests.
- **Analytics** — deflection, MTTR/FRT, SLA compliance by priority, reopen
  rate, backlog by group, CSAT, leaderboard, ROI; CSV export.
- **Portal** — branded help center, catalog (approval-aware), instant-resolve
  requests.

## Auth & RBAC

Auth.js (NextAuth v5) with Microsoft Entra ID SSO; demo credential sign-in
(email-only against seeded users) for zero-infra use. **Every page requires a
session** — middleware redirects to `/signin`, and the user menu switches demo
identities through a real credentials sign-in (no localStorage anywhere; the
theme preference lives in a cookie, profile and notification preferences live
on the server User record). Roles escalate: `requester < agent < manager <
tenant_admin < super_admin`, enforced by the RBAC matrix
(`src/server/auth/rbac.ts`) on every API route: requesters only ever see their
own tickets, writes need agent+, approvals need manager+.

**Demo vs production mode** (`DEMO_MODE`, defaults off once Entra ID is
configured): demo mode keeps the zero-infra conveniences — passwordless demo
sign-in and the `x-actor` header for headless testing. Production mode disables
both; `/api/v1` then requires a session cookie or an **API key**
(`Authorization: Bearer nlk_…`, minted per-integration in Settings → API keys,
SHA-256-hashed at rest, revocable, audited), and unsigned webhooks are
rejected.

## API

`GET /api/v1/health` reports the active driver and feature flags;
`GET /api/v1/openapi.json` serves the OpenAPI 3.1 spec (import into
Swagger/Postman). Full surface under `/api/v1`: `tickets`, `tickets/:id`
(+`/messages`, `/actions`, `/approvals`, `/summary`, `/attachments`), `kb`
(+`/search`), `problems`, `changes` (+`/approvals`), `assets`, `cis`
(+`/:id/impact`), `groups`, `sla-policies`, `calendars`, `automations`,
`catalog`, `metrics`, `reports` (+`/trends`), `audit`, `me`, `users`,
`api-keys`, `notifications`, `events` (SSE live stream), `attachments/:id`,
`intake` (portal/API/Teams/monitoring alerts). Provider webhooks live at
`/api/webhooks/{generic,zendesk,freshdesk,slack,brevo}` and feed the same
intake pipeline; the generic/Zendesk/Freshdesk webhooks are HMAC-signed
(`x-webhook-signature` over `"<timestamp>.<rawBody>"` with `WEBHOOK_SECRET`),
Slack uses its native v0 signing scheme (`SLACK_SIGNING_SECRET`), and Brevo
Inbound Parsing uses a shared token (`BREVO_INBOUND_SECRET`).

## Enterprise service-desk capabilities

- **Email**: pluggable provider (`EMAIL_PROVIDER` = Microsoft Graph poll or
  **Brevo** Inbound Parsing webhook + transactional send; one switch flips both
  directions, auto-detected from configured credentials). Ingestion handles
  full HTML body, attachments, dedupe by `internetMessageId`, auto-reply/loop
  guards, and per-sender spam limits, with **thread recognition** — replies
  match by `[REF]` subject token, `In-Reply-To`/`References`, or conversation id
  and append to the ticket.
- **Attachments**: upload/download APIs + UI, MIME allow-list, size caps,
  executable blocklist, forced `Content-Disposition: attachment`; local-disk
  storage by default, Azure Blob (SharedKey REST) when
  `AZURE_STORAGE_CONNECTION_STRING` is set.
- **Assignment**: category → group routing plus per-group auto-assignment
  strategies (round-robin / least-loaded), VIP requester prioritization.
- **SLA**: per-priority policies, pause/resume on pending, staged at-risk →
  breach escalation, and named **business calendars** (IANA timezone, working
  window, holidays) linkable per policy.
- **Automations**: rule builder UI; triggers `ticket.created`,
  `ticket.updated`, `sla.at_risk`, `sla.breached`; ALL/ANY condition groups;
  actions assign/priority/status/category/tag/notify/run-AI.
- **Notifications**: in-app feed + live **SSE** updates, email/Teams/Slack
  delivery, per-user preference enforcement, Monday digest.
- **Jobs**: locked scheduler (pg advisory lock on Postgres), per-job retries
  with backoff, failures dead-lettered to the audit chain.
- **Audit**: tamper-evident SHA-256 hash chain covering ticket lifecycle, AI
  decisions, automations, approvals, sign-in/out, and key management.

## Testing / CI / Deploy

```bash
npm run typecheck   # tsc --noEmit
npm test            # Vitest (audit chain, SLA + pause, priority matrix,
                    #   routing, approvals, RBAC, embeddings, classification)
npm run build       # production build (standalone output)

# Full end-to-end smoke: signs in as all four roles and exercises the API
# behind every UI control (61 checks). Needs the app running on :3000.
powershell -File scripts/e2e-smoke.ps1
```

- CI: `.github/workflows/ci.yml` (install, generate, typecheck, test, build).
- Docker: multi-stage `Dockerfile` (standalone) + `docker-compose.yml`.
- Target: Azure Container Apps + Postgres Flexible Server + Redis + Blob.

See `.env.example` for every configuration option.

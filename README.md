# Netlink Support — Service Desk

A service-desk application for tracking support requests, assigning work, managing approvals and monitoring service-level agreements. Built with **Next.js, React, TypeScript, Prisma and PostgreSQL**.

**My contribution:** I independently built the application using AI-assisted development, including the interface, backend workflows, data persistence, external API-key integration, automated tests and integration documentation.

[Live application](https://netlink-support.vercel.app/) · [API integration guide](docs/EXTERNAL_API_GUIDE.md) · [Implementation notes](docs/IMPLEMENTATION_STATUS.md)

## Project highlights

- Ticket lifecycle, assignment, conversation threads and role-based access.
- SLA tracking, approvals, dashboards and a knowledge base.
- PostgreSQL persistence through Prisma, with pagination and ticket soft deletion.
- External REST API integration with API keys, request validation and OpenAPI documentation.
- AI-assisted ticket classification and response suggestions, with configurable providers and offline fallbacks.

## Start reviewing the code

- [`src/app`](src/app): application pages and API routes.
- [`src/server/services`](src/server/services): ticket and service-desk workflows.
- [`src/server/data`](src/server/data): shared datastore interface and persistence adapters.
- [`src/server/auth/rbac.ts`](src/server/auth/rbac.ts): role and permission rules.
- [`prisma`](prisma): schema, migrations and seed data.
- [`docs/EXTERNAL_API_GUIDE.md`](docs/EXTERNAL_API_GUIDE.md): integration setup and request examples.

## Local development and deployment

The application includes a memory/JSON adapter for local demos and a Prisma adapter for PostgreSQL. Authentication, AI providers, email and attachment storage depend on environment configuration; an available integration does not mean it is enabled in the hosted showcase.

```sh
git clone https://github.com/dhwajdhruvkar/ticket-management-integration.git
cd ticket-management-integration
npm ci
npm run dev
```

Open the local URL printed by Next.js. See [`.env.example`](.env.example) for local configuration. Demo mode uses seeded identities and data; it is intended for local exploration.

For a deployment, follow [`.env.production.example`](.env.production.example) and run `npm run environment:check`. Production mode requires `DEMO_MODE=false`, PostgreSQL and the required authentication settings. The hosted showcase uses explicitly allowed demo identities; Microsoft Entra ID, Azure storage and messaging providers require separate configuration. See the implementation notes for deployment details and current limitations.

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

Authentication uses Auth.js (NextAuth v5), with Microsoft Entra ID when configured and separate demo sign-in modes. Protected application routes and API operations apply session and role checks. The public landing and sign-in pages remain accessible to visitors. Role permissions are defined in [`src/server/auth/rbac.ts`](src/server/auth/rbac.ts).

**Demo vs production mode** (`DEMO_MODE`, defaults off once Entra ID is
configured): demo mode keeps the zero-infra conveniences — passwordless demo
sign-in and the `x-actor` header for headless testing. Production mode disables
both by default. The explicit `PUBLIC_DEMO_AUTH=true` showcase option restores
passwordless browser sign-in only for the six identities displayed on
`/signin`; it does not restore `x-actor`, tenant headers, open webhooks, or
other demo-mode fallbacks. Disable it when Entra is configured. In every
Production profile, `/api/v1` requires a session cookie or an **API key**
(`Authorization: Bearer nlk_…`, minted per-integration in Settings → API keys,
SHA-256-hashed at rest, revocable, audited), and unsigned webhooks are
rejected.

## API

`GET /api/v1/health` reports the active driver and feature flags;
`GET /api/v1/openapi.json` serves the OpenAPI 3.1 spec (import into
Swagger/Postman). Backend integrators should start with the
[external API integration guide](docs/EXTERNAL_API_GUIDE.md). Full surface
under `/api/v1`: `tickets`, `tickets/:id`
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

# Additional local API smoke checks. Needs the app running on :3000.
powershell -File scripts/e2e-smoke.ps1
```

- CI: `.github/workflows/ci.yml` (install, generate, typecheck, test, build).
- Docker: multi-stage `Dockerfile` (standalone) + `docker-compose.yml`.
- Hosted showcase: Vercel with PostgreSQL. Additional infrastructure depends on the enabled providers.

See `.env.example` for every configuration option.

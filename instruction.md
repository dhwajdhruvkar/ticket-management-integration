# Netlink Support — Instruction & Operations Guide

An AI-first IT & HR service desk (ITSM) platform: omnichannel ticket intake, AI
triage and auto-resolution, full ITIL workflows (incident / service request /
problem / change / CMDB / knowledge), SLAs, automations, reporting, and a
tamper-evident audit trail.

It is built to **run two ways from the same code**:

- **Demo / zero-infrastructure** (default): no database, no API keys, no cloud —
  an in-memory JSON store, offline AI fallbacks, and passwordless demo sign-in.
  Clone, `npm install`, `npm run dev`, and it works.
- **Production**: the moment you provide real services (PostgreSQL, an LLM key,
  Microsoft Entra ID SSO, a mailbox, Redis, Blob storage), the matching feature
  "lights up" automatically. No code changes.

> The section [Free vs Paid / Enterprise](#free-vs-paid--enterprise-what-to-change)
> explains exactly which switches to flip to move from the free demo tier to the
> paid / production tier, and what admins can change **inside the app**.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Quick start](#quick-start)
3. [Roles & how to use it](#roles--how-to-use-it)
4. [The ticket lifecycle (how a ticket flows)](#the-ticket-lifecycle)
5. [Feature catalog](#feature-catalog)
6. [Channels & integrations](#channels--integrations)
7. [Configuration reference (environment variables)](#configuration-reference)
8. [Free vs Paid / Enterprise: what to change](#free-vs-paid--enterprise-what-to-change)
9. [In-app admin settings](#in-app-admin-settings)
10. [API overview](#api-overview)
11. [Testing, CI & deployment](#testing-ci--deployment)
12. [Project structure](#project-structure)

---

## What it does

The platform ingests support requests from any channel, uses AI to classify and
(when confident) resolve them, and otherwise routes them to the right team with
an SLA clock running — all recorded on a tamper-evident audit chain.

**The AI-first workflow**, on every intake regardless of source:

```
Intake (portal / email / Teams / Slack / webhook / API / monitoring alert)
   -> AI classify: category + impact x urgency -> priority (ITIL matrix)
   -> Create ticket + apply SLA due dates + send acknowledgement
   -> Approval hold (catalog items that require manager sign-off)
   -> Route to assignment group (+ optional auto-assign to an agent)
   -> Run automation rules
   -> AI resolution (RAG over the knowledge base):
        confidence >= auto threshold  -> auto-resolve (reply + close)
        confidence >= assist threshold -> draft a reply for an agent
        otherwise / P1 guardrail       -> escalate to a human
```

Everything the AI does (retrieval, decision, confidence, reasoning) plus every
human action is written to a per-tenant SHA-256 hash-linked audit trail that can
be verified for tampering.

---

## Quick start

### Prerequisites
- Node.js 22+
- (Optional, for production) Docker for local Postgres + Redis.

### Run the demo (zero-infra)
```bash
npm install
npm run dev
# open http://localhost:3000
```
Sign in by picking one of the demo identities on the sign-in screen (no
password). You immediately have a fully working service desk backed by a local
JSON file (`.data/store.json`).

### Run against Postgres (production driver)
```bash
docker compose up -d          # Postgres (pgvector) + Redis
# set DATA_DRIVER=prisma and DATABASE_URL in .env (see docker-compose.yml)
npm run db:push               # create the schema
npm run db:seed               # load demo tenants, users, tickets, KB
npm run dev
```

### Production build
```bash
npm run build
npm start                     # or: node .next/standalone/server.js
```

---

## Roles & how to use it

There are five roles, escalating in privilege:
`requester < agent < manager < tenant_admin < super_admin`.

### Requester (end user)
- **Raise a request**: go to the **Help Center** (`/portal`). Search the
  knowledge base first (the assistant may answer instantly), or submit a request
  / pick a service-catalog item. Catalog items marked "needs approval" trigger a
  manager approval before fulfilment.
- **Track requests**: **My Requests** (`/tickets`) shows your tickets as status
  cards with filters. Open one to read the conversation, reply, add attachments,
  reopen a resolved ticket, or leave satisfaction feedback.
- **Profile** (`/profile`): edit contact details and notification preferences.

### Agent (service desk engineer)
- **Queue** (`/tickets`): saved views (your unsolved, unassigned, all unsolved,
  pending, recently updated/solved), search, and a dense table. Open a ticket to
  work it.
- **Ticket console** (`/tickets/[id]`): three panes —
  - left: properties (impact/urgency -> derived priority, category, assignee,
    group, linked CIs, custom fields), SLA panel, approvals, attachments;
  - center: the conversation + a composer (public reply / internal note, with
    AI-drafted suggestions you can accept);
  - right: AI analysis (decision, confidence, cited KB sources), a thread
    summary, and the activity timeline.
- **Knowledge Base** (`/knowledge-base`): author articles (they are embedded for
  AI retrieval the moment you save).
- **Problems / Changes / Assets** (`/problems`, `/changes`, `/assets`): the ITIL
  modules (see the feature catalog).
- **Triage** (`/triage`): rapidly classify/assign/prioritize new tickets.

### Manager
Everything an agent can do, plus **approvals**: approve/reject service requests
and CAB (change advisory board) decisions.

### Tenant admin / super admin
Everything above, plus **Settings** (`/settings`): SLA policies, business
calendars, assignment groups & routing, automations, macros, custom fields,
departments, organization settings, API keys, and the audit trail.

---

## The ticket lifecycle

1. **Intake** — a request arrives on any channel and hits one unified pipeline
   (`src/server/services/intake.ts`).
2. **Classification** — if category/priority aren't supplied, the AI classifier
   infers category + impact + urgency; priority is derived from the ITIL
   impact x urgency matrix. VIP requesters get an urgency floor.
3. **SLA applied** — response + resolution due times are computed from the
   per-priority policy (optionally following a business calendar), and an
   acknowledgement is sent.
4. **Approval hold** — catalog items requiring approval park the ticket
   (SLA clock paused) until a manager decides.
5. **Routing** — the ticket is assigned to the first group that owns its
   category; the group's strategy can auto-assign an individual agent
   (round-robin / least-loaded).
6. **Automations** — enabled rules for the `ticket.created` trigger run.
7. **AI resolution** — retrieve (vector search) -> generate a grounded answer ->
   score confidence -> decide: **auto-resolve**, **suggest** (draft for an
   agent), or **escalate**. P1/critical never auto-closes.
8. **Human work** — agents reply, reassign, change status; the SLA clock pauses
   while `pending`. Staged escalation warns at 80% of the window and escalates on
   breach.
9. **Resolution & feedback** — resolved tickets auto-close after 7 idle days; a
   requester reply reopens them; requesters can rate satisfaction (CSAT).

---

## Feature catalog

- **Omnichannel intake** — portal, email (Microsoft 365 or Brevo), Microsoft
  Teams, Slack, generic/Zendesk/Freshdesk webhooks, REST API, and monitoring
  alerts (severity -> impact/urgency, CI linked).
- **AI** — classification, RAG auto-resolution with confidence thresholds and
  guardrails, thread summarization, problem root-cause suggestions, change risk
  scoring, and (optional) translation. Uses a real LLM when configured, else
  deterministic offline fallbacks.
- **Email ingestion & threading** — full HTML body extraction, attachments,
  dedupe, auto-reply/loop guards, per-sender spam limits, and reply threading
  (subject `[REF]` token, `In-Reply-To`/`References`, or conversation id).
- **Attachments** — upload/download with MIME allow-list, size caps, executable
  blocklist, and forced `Content-Disposition: attachment`. Local disk by
  default, Azure Blob when configured.
- **SLA engine** — per-priority policies, response + resolution targets,
  pause/resume on `pending`, business calendars (timezone, working window,
  holidays), staged at-risk -> breach escalation.
- **Assignment** — category -> group routing, plus round-robin / least-loaded
  auto-assignment and VIP prioritization.
- **Automations** — a rule engine (triggers: created, updated, SLA at-risk,
  SLA breached; ALL/ANY conditions; actions: assign, set priority/status/
  category, add tag, notify, run AI) with a rule builder UI.
- **ITIL modules** — Problem management (RCA, known errors, incident clustering),
  Change management (CAB approvals, risk scoring, lifecycle stepper), CMDB
  (configuration items + dependency graph + impact analysis), Service catalog,
  and Knowledge management (vector-searched articles).
- **Notifications** — in-app feed with live Server-Sent-Events updates, plus
  email / Teams / Slack delivery, per-user preferences, and a weekly digest.
- **Reporting** — dashboard KPIs (deflection, containment, MTTR, SLA compliance,
  CSAT, backlog, agent leaderboard), daily trend charts, CSV export, and a
  monthly PDF report.
- **Security & audit** — role-based access control, record-level security,
  machine API keys, HMAC-signed webhooks, rate limiting, and a tamper-evident
  hash-chained audit trail covering ticket actions, AI decisions, approvals,
  sign-in/out, and admin changes.
- **Background jobs** — a locked scheduler (SLA sweep, auto-close, mailbox poll,
  digests) with per-job retries and dead-lettering.

---

## Channels & integrations

| Channel | Direction | How it arrives | Configure |
|---|---|---|---|
| Portal | in | The `/portal` request form -> `/api/v1/intake` | always on |
| REST API | in/out | `/api/v1/*` (session or API key) | always on |
| Microsoft 365 email | in/out | Graph mailbox poll + sendMail | `MS_GRAPH_*`, `SUPPORT_MAILBOX` |
| Brevo email | in/out | Inbound Parsing webhook + transactional API | `EMAIL_PROVIDER=brevo`, `BREVO_*` |
| Microsoft Teams | in/out | Bot activity -> `/api/v1/intake`; webhook out | `TEAMS_WEBHOOK_URL` |
| Slack | in/out | `/api/webhooks/slack` (v0 signed) + webhook out | `SLACK_SIGNING_SECRET`, `SLACK_WEBHOOK_URL` |
| Zendesk / Freshdesk / generic | in | `/api/webhooks/*` (HMAC signed) | `WEBHOOK_SECRET` (+ per-source) |
| Monitoring alerts | in | `/api/v1/intake` `channel:"alert"` | any signed caller |

**Email provider switch**: `EMAIL_PROVIDER` = `graph` | `brevo` | `none` (or
`auto`, the default). `auto` prefers Brevo when a Brevo key is present, else
Graph when Graph is configured, else records notifications in-app only. The
switch flips **both** ingestion and outbound so they stay symmetric.

---

## Configuration reference

Everything is optional; copy `.env.example` to `.env.local`. Each variable
progressively enables a real capability.

| Variable | Enables |
|---|---|
| `DATA_DRIVER=prisma` + `DATABASE_URL` | PostgreSQL persistence (else in-memory JSON) |
| `GEMINI_API_KEY` / `GROQ_API_KEY` / `AZURE_OPENAI_*` | Real LLM (else offline heuristics + template answers) |
| `AUTH_SECRET` + `AUTH_MICROSOFT_ENTRA_ID_*` | Microsoft Entra ID SSO (else demo sign-in) |
| `DEMO_MODE=false` | Turns off demo conveniences; requires real auth / API keys |
| `MS_GRAPH_*` + `SUPPORT_MAILBOX` | Microsoft 365 email + Teams |
| `EMAIL_PROVIDER` + `BREVO_API_KEY` + `BREVO_INBOUND_SECRET` + `BREVO_SENDER` | Brevo email in/out |
| `SLACK_SIGNING_SECRET` / `SLACK_WEBHOOK_URL` | Slack in / out |
| `TEAMS_WEBHOOK_URL` | Teams outbound notifications |
| `WEBHOOK_SECRET` (+ `ZENDESK_`/`FRESHDESK_`) | HMAC verification for inbound provider webhooks |
| `REDIS_URL` | Reserved for the BullMQ queue upgrade |
| `AZURE_STORAGE_CONNECTION_STRING` + `ATTACHMENTS_CONTAINER` | Azure Blob attachment storage (else local disk) |
| `ATTACHMENT_MAX_BYTES` | Max upload size (default 10 MB) |
| `SCHEDULER_INTERVAL_MS` | Background job interval (default 5 min) |
| `SENTRY_DSN` | Error reporting |

---

## Free vs Paid / Enterprise: what to change

The application code is the same in both tiers. The "paid / enterprise" tier is
unlocked by **provisioning real services and flipping configuration switches** —
there is no license gate to remove; you simply turn capabilities on. Below is
exactly what to change and where.

### Tier at a glance

| Capability | Free / Demo (default) | Paid / Enterprise (configure) |
|---|---|---|
| Data store | In-memory JSON file | PostgreSQL (`DATA_DRIVER=prisma` + `DATABASE_URL`) |
| AI quality | Offline heuristics + extractive template | Real LLM (`GEMINI_API_KEY` / `GROQ_API_KEY` / Azure OpenAI) + pgvector kNN |
| Sign-in | Passwordless demo personas | Microsoft Entra ID SSO (`AUTH_MICROSOFT_ENTRA_ID_*`, `DEMO_MODE=false`) |
| Email | In-app feed only | Microsoft 365 (Graph) or Brevo, in + out |
| Chat channels | — | Slack + Teams |
| Attachment storage | Local disk | Azure Blob |
| API access | Open in demo mode | API keys required (`DEMO_MODE=false`) |
| Webhooks | Unsigned accepted (demo) | HMAC-signed + rejected if unsigned |
| Jobs | In-process scheduler | Same + Postgres advisory lock (multi-replica safe) |

### Step-by-step to go "paid"

1. **Turn off demo mode**: set `DEMO_MODE=false`. This disables passwordless
   sign-in, the anonymous API actor, and the `x-actor` header, and forces
   `/api/v1` to require a session or API key.
2. **Real identity**: set `AUTH_SECRET` and the three `AUTH_MICROSOFT_ENTRA_ID_*`
   values for SSO. New SSO users are auto-provisioned as requesters.
3. **Real database**: set `DATA_DRIVER=prisma` + `DATABASE_URL`, then
   `npm run db:push && npm run db:seed`. This also enables the pgvector search
   index and multi-replica-safe job locking.
4. **Real AI**: set an LLM key (`GEMINI_API_KEY` is free-tier friendly). This
   upgrades classification, RAG answers, summaries, RCA, and risk scoring from
   the offline fallbacks.
5. **Email**: choose a provider — Microsoft 365 (`MS_GRAPH_*` + `SUPPORT_MAILBOX`)
   or Brevo (`EMAIL_PROVIDER=brevo` + `BREVO_API_KEY` + `BREVO_INBOUND_SECRET` +
   `BREVO_SENDER`, and point the domain MX at Brevo Inbound Parsing).
6. **Chat**: Slack (`SLACK_SIGNING_SECRET` + `SLACK_WEBHOOK_URL`) and/or Teams
   (`TEAMS_WEBHOOK_URL`).
7. **Storage**: `AZURE_STORAGE_CONNECTION_STRING` to move attachments to Blob.
8. **Webhook security**: set `WEBHOOK_SECRET` (and per-source secrets) so inbound
   provider webhooks must be HMAC-signed.

> Tune AI aggressiveness with `RESOLVE_AUTO_THRESHOLD` (default 0.78) and
> `RESOLVE_SUGGEST_THRESHOLD` (default 0.55): lower = more auto-resolution,
> higher = more human review.

---

## In-app admin settings

These are changed by a **tenant admin inside the running app** at `/settings`
(no redeploy needed) — the day-to-day "premium configuration" surface:

- **SLA policies** — response/resolution targets per priority; attach a business
  calendar; toggle business-hours-only.
- **Business calendars** — timezone, working weekdays/window, holiday dates.
- **Assignment groups** — membership, which categories route to each group, and
  the auto-assignment strategy (manual / round-robin / least-loaded).
- **Automation rules** — build rules (trigger + ALL/ANY conditions + actions) and
  enable/disable them.
- **Macros** — canned agent responses / bulk-action presets.
- **Custom fields** — tenant-defined fields shown on tickets.
- **Departments & organization** — org structure and tenant/branding settings.
- **API keys** — create/revoke machine keys (`Authorization: Bearer nlk_...`);
  the secret is shown once at creation.
- **VIP requesters** — mark a user VIP (via the users admin) to raise their
  ticket urgency automatically.
- **Appearance** — light/dark theme.

---

## API overview

- Base: `/api/v1`. Uniform envelope: `{ ok: true, data }` or `{ ok: false, error }`.
- Auth: session cookie (browser) or API key (`Authorization: Bearer nlk_...`).
- Spec: `GET /api/v1/openapi.json` (import into Swagger/Postman).
- Health: `GET /api/v1/health`.
- Live updates: `GET /api/v1/events` (Server-Sent Events).
- Core resources: `tickets` (+ `/messages`, `/actions`, `/approvals`,
  `/attachments`, `/summary`), `kb` (+ `/search`), `problems`, `changes`,
  `assets`, `cis` (+ `/impact`), `groups`, `sla-policies`, `calendars`,
  `automations`, `macros`, `custom-fields`, `departments`, `metrics`,
  `reports` (+ `/trends`), `audit`, `me`, `users`, `api-keys`, `intake`.
- Provider webhooks: `/api/webhooks/{generic,zendesk,freshdesk,slack,brevo}`.

---

## Testing, CI & deployment

```bash
npm run typecheck    # tsc --noEmit
npm test             # Vitest unit tests
npm run build        # production build (standalone output)

# End-to-end smoke: signs in as each role and exercises the API behind every UI
# control. Requires the app running on :3000.
powershell -File scripts/e2e-smoke.ps1
```

- **CI**: `.github/workflows/ci.yml` (install -> generate -> typecheck -> test -> build).
- **Docker**: multi-stage `Dockerfile` (standalone) + `docker-compose.yml`
  (Postgres + Redis).
- **Target**: Azure Container Apps + Postgres Flexible Server + Redis + Blob, but
  it runs anywhere Node 22 runs.

---

## Project structure

```
src/
  app/            Next.js App Router: pages + /api routes
    api/v1/*        versioned REST surface
    api/webhooks/*  inbound provider webhooks
  components/      React UI (workspace shell, ticket console, settings, etc.)
  server/
    services/       business logic (tickets, SLA, intake, automations, ...)
    channels/       omnichannel adapters (graph email, brevo, slack, teams, webhooks)
    ai/             classification, RAG resolver, embeddings, vector search
    data/           DataStore port + memory & Prisma adapters + seed
    domain/         serializable row types, ids, priority matrix
    auth/           RBAC matrix + API keys
    jobs/           scheduler + job lock/retry
    notify/         notifier + templates
    audit/          tamper-evident hash chain
    storage/        blob store (local disk / Azure)
  lib/            client API helper, live-ticket hooks
prisma/           schema + seed + pgvector migration
scripts/          e2e smoke test
```

For every configuration option see `.env.example`; for a shorter overview see
`README.md`.

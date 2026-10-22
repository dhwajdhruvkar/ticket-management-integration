# Risks and recommendations

Findings are separated by how sure we are, then ranked by impact. Evidence is a file path and symbol; "verified" means confirmed by reading the code or by a script that was run in this audit. Nothing was exercised at runtime, so no finding claims an observed failure.

| Class | Meaning |
|---|---|
| **Verified defect or drift** | Something that is wrong, dead or inconsistent *as written*, shown by the cited code. |
| **Potential risk** | A property of the code that would hurt under stated conditions. The conditions were not shown to hold. |
| **Recommendation** | A change proposed by this audit. Not in the repository. |

Impact scale: **High** = could expose or misroute customer data, or silently stop required processing; **Medium** = degrades reliability, maintainability or operability; **Low** = hygiene or drift.

## Summary table

| ID | Class | Impact | Finding |
|---|---|---|---|
| [V3](#v3-inbound-channels-have-no-tenant-routing) | Verified | **High** (multi-tenant) | Inbound channels land in the first tenant |
| [V2](#v2-nothing-in-the-repository-schedules-background-work-on-serverless) | Verified + inferred | **High** (if the external schedule is absent) | No in-repo schedule for SLA, escalation and email delivery on serverless |
| [V4](#v4-hidden-runtime-import-cycle) | Verified | Medium | 16-file runtime import cycle hidden by lazy imports |
| [V10](#v10-two-authorization-idioms-give-different-status-codes) | Verified | Medium | Two authorization idioms, inconsistent 401/403 |
| [V1](#v1-sentry-reporting-is-inert) | Verified | Medium | Sentry never receives errors |
| [V8](#v8-database-attachment-storage-bypasses-the-datastore-port) | Verified | Medium | Attachment bytes bypass the DataStore port |
| [V5](#v5-published-api-contract-has-drifted) | Verified | Medium | OpenAPI omits 5 routes; version and README drift |
| [V6](#v6-pgvector-is-provisioned-but-unused) | Verified | Medium | Vector index unused; in-process ranking |
| [V7](#v7-brevo-inbound-secret-compared-non-constant-time-and-placed-in-the-url) | Verified | Low–Medium | Brevo secret compare and URL placement |
| [V9](#v9-redis-and-bullmq-are-declared-but-unused) | Verified | Low | Redis provisioned and referenced, never used |
| [V11](#v11-duplicated-infrastructure-code) | Verified | Low | Graph token logic ×3, IP extraction ×3 |
| [V12](#v12-no-app-router-error-boundaries) | Verified | Low | No `error.tsx`, `not-found.tsx` or `global-error.tsx` |
| [P1–P12](#potential-risks) | Potential | varies | See below |

## Verified defects and drift

### V3. Inbound channels have no tenant routing

- **Evidence.** `currentTenantId` (`src/server/context.ts`) ends with `tenants[0]?.id ?? NETLINK_TENANT_ID` when there is no session and no API key. The generic webhook route calls it (`src/app/api/webhooks/generic/route.ts`). `defaultTenantId` (`src/server/data/index.ts`) does the same for email polling, Slack and Teams. `tenants.list()` has no ordering, so on PostgreSQL "first" is whatever the database returns.
- **Why it matters.** With more than one tenant, every ticket from Zendesk, Freshdesk, a script, Brevo or Graph mail, Slack and Teams goes to one tenant. That tenant may be the wrong customer. The hosted showcase had two organizations at the last release record, so the condition can already hold if channels are enabled (they were not configured then, per `docs/IMPLEMENTATION_STATUS.md`).
- **Fix.** [P-ADR-1](architecture-decisions.md#p-adr-1-tenant-routing-for-inbound-channels). Interim guard: refuse non-request channel intake when more than one tenant exists and no tenant binding is set.

### V2. Nothing in the repository schedules background work on serverless

- **Evidence.** `vercel.json` has no `crons`. `startScheduler()` (`src/server/jobs/scheduler.ts:279`) uses `setInterval`, started from `src/instrumentation.ts`; it has no HTTP trigger. `POST /api/jobs/workflow` exists with a secret check but no in-repo caller. `docs/SERVICE_DESK_WORKFLOW.md:108-123` tells operators to create a cron-job.org schedule; `docs/IMPLEMENTATION_STATUS.md` says the release did not configure it.
- **Verified:** the absence of an in-repo trigger. **Inferred:** that serverless instances do not reliably run the interval. **Unknown:** whether the external schedule exists now.
- **Why it matters.** If absent: SLA at-risk and breach escalation, auto-close, workflow queue warnings and escalations, the email outbox drain and callback retries do not run on a timer. Workflow email (confirmation links) would sit in `pending`. The effect is silent.
- **Fix.** [P-ADR-2](architecture-decisions.md#p-adr-2-make-scheduling-part-of-the-repository).

### V4. Hidden runtime import cycle

- **Evidence.** A script over every `src` import found one strongly-connected group of 16 files when dynamic `import()` is counted and none with static imports only. Two direct two-file cycles: `approvalService.ts` ↔ `intake.ts` and `automationService.ts` ↔ `ticketService.ts`. Nine lazy imports close the loop (`ticketService.ts:381`, `automationService.ts:278`, `approvalService.ts:148`, `resolver.ts:220`, `notifier.ts:63,75,118`, `workflowOutbox.ts:60,63`). Full list in [application-architecture.md](application-architecture.md#import-cycle-hidden-by-dynamic-imports).
- **Why it matters.** The services are one tangled unit: a change to ticket mutation can trigger automation, AI and approval code in the middle of a transaction path, and each can call back. Tests and reasoning cannot treat them separately. The lazy imports also make bundling order-dependent.
- **Fix.** [P-ADR-3](architecture-decisions.md#p-adr-3-break-the-service-import-cycle-with-a-lifecycle-port).

### V10. Two authorization idioms give different status codes

- **Evidence.** 71 handlers use `requirePermission` (`src/server/guards.ts`), which returns 401 for a presented, invalid API key. 27 handlers call `actorContext` then `can(...)` inline (for example `src/app/api/v1/audit/route.ts:18`), which returns 403 in both cases.
- **Why it matters.** Integrators see different statuses for the same fault depending on route; a new route can omit the check without any test failing.
- **Fix.** [P-ADR-5](architecture-decisions.md#p-adr-5-one-authorization-idiom).

### V1. Sentry reporting is inert

- **Evidence.** `logger.error` calls `globalThis.__sentryCapture` when `SENTRY_DSN` is set (`src/server/observability/logger.ts:102-105`). Nothing in the repository assigns it; `src/instrumentation.ts` only starts the scheduler; `@sentry/nextjs` is not in `package.json`. The comment claims it is "wired in instrumentation".
- **Why it matters.** Setting `SENTRY_DSN` gives a false sense of coverage. Production errors are visible only in platform logs.
- **Fix.** [P-ADR-7](architecture-decisions.md#p-adr-7-observability-baseline).

### V8. Database attachment storage bypasses the DataStore port

- **Evidence.** `src/server/storage/databaseBlob.ts:9` imports `prismaClient` from `../data/prismaStore` and calls `attachmentBlob` directly. Arch-lens `enforce` reports this as the one violation of "only the port reaches the Prisma adapter".
- **Why it matters.** The blob path skips the port's transactions and works only with the Prisma driver (the config only enables it with Postgres, which contains the problem). It is the only place the otherwise clean data boundary is crossed.
- **Fix.** Add an `attachmentBlobs` collection to the port and implement it in both adapters.

### V5. Published API contract has drifted

- **Evidence.** Five route files have no OpenAPI path: `/api/v1/changes/{id}`, `/departments/{id}`, `/users/{id}`, `/tickets/{id}/summary`, `/tickets/{id}/typing`. `GET /api/v1/health` returns `version: "2.0.0"`; `package.json` says `1.0.0`. `README.md` lists `middleware.ts`; the file is `src/proxy.ts`.
- **Why it matters.** Integrators and generated clients rely on the OpenAPI document. Drift is inevitable when it is hand-written and untested against the route tree.
- **Fix.** [P-ADR-6](architecture-decisions.md#p-adr-6-keep-the-published-contract-honest).

### V6. pgvector is provisioned but unused

- **Evidence.** `prisma/sql/001_pgvector.sql` and the `vector` extension in the schema; no source file queries a vector column (the only raw SQL in `src` is the advisory lock in `jobs/lock.ts`). `vectorSearch.search` loads every published article of the tenant and ranks by cosine similarity in process, re-embedding stale ones inline.
- **Why it matters.** Search cost and latency grow linearly with article count and run on the request path; the provisioned index suggests a capability that is not there.
- **Fix.** [P-ADR-4](architecture-decisions.md#p-adr-4-decide-the-future-of-pgvector).

### V7. Brevo inbound secret compared non-constant-time and placed in the URL

- **Evidence.** `authorized()` in `src/app/api/webhooks/brevo/route.ts` returns `presented === secret`, reading `?token=` or `x-brevo-secret`. The other webhook routes use HMAC and `timingSafeEqual` (`src/server/channels/webhookSecurity.ts:66`).
- **Why it matters.** Brevo cannot sign, so a shared secret is a reasonable fallback, but a URL token is commonly logged by proxies and the comparison is not constant-time. Practical timing attacks over a network are hard, so impact is low.
- **Fix.** Compare with `timingSafeEqual` on equal-length buffers; prefer the header; redact `token` in access logs.

### V9. Redis and BullMQ are declared but unused

- **Evidence.** `docker-compose.yml` starts Redis; `config.ts` reads `REDIS_URL`; `next.config.mjs` lists `bullmq` and `ioredis` as server externals; neither package is in `package.json` and no source imports them.
- **Why it matters.** Misleads operators and reviewers about the architecture and the infrastructure to run.
- **Fix.** Remove the container, the config read and the externals, or mark them clearly as planned (the analysis model already marks Redis `planned`).

### V11. Duplicated infrastructure code

- **Evidence.** The Microsoft Graph client-credentials token request appears in `channels/graphEmail.ts:41`, `notify/notifier.ts:137` and `integrations/teamsPresence.ts:28`. Client-IP extraction from `x-forwarded-for` appears in `proxy.ts` (twice) and `rateLimit.ts`.
- **Why it matters.** A change to timeouts, caching or trust of forwarded headers must be made in several places; the IP logic decides rate limiting and is security-relevant.
- **Fix.** One `graphClient` module and one `clientIp(req)` helper.

### V12. No App Router error boundaries

- **Evidence.** No `error.tsx`, `loading.tsx`, `not-found.tsx` or `global-error.tsx` under `src/app`.
- **Why it matters.** An uncaught render error shows the Next.js default; there is no branded recovery or error reporting hook for the client (and V1 means none server-side either).
- **Fix.** Add `global-error.tsx` and `not-found.tsx`; report to the chosen error tracker.

## Potential risks

Conditions were not shown to hold; each states what would make it real.

| ID | Risk | Evidence | Becomes real when | Impact |
|---|---|---|---|---|
| P1 | **Per-instance state**: event bus, route and proxy rate limiters and in-process job locks are plain memory | `events/bus.ts`, `rateLimit.ts`, `proxy.ts`, `jobs/lock.ts` | More than one instance serves production. Live updates are missed, limits multiply. Postgres leases still stop duplicate sweeps. | Medium |
| P2 | **Tenant isolation without database enforcement**: ten models carry no `tenantId` | `prisma/schema.prisma` | A new path reads a child row (message, approval, attachment) without loading the tenant-scoped parent. | High if it happens |
| P3 | **Tenant-wide scans**: the scheduler lists all tickets per tenant every tick; intake and the notifier list all users to find one; `where` is equality-only | `scheduler.ts:57,135`, `intake.ts:35`, `notifier.ts` `recipientPreferences` | Ticket and user counts grow. ADR 0001 already records a scale ceiling. Hosted data was tiny at last record. | Medium |
| P4 | **Synchronous AI on the request path**: intake classifies, tags and triages before responding | `intake.ts`, `ai/*` | Providers are slow; route `maxDuration` is unset on these routes. Retries multiply latency. | Medium |
| P5 | **No explicit CSRF or Origin check** on cookie-authenticated JSON routes | grep of `guards.ts`, `http.ts`, `proxy.ts` | Cookie `SameSite` defaults are weaker than assumed, or a route accepts non-JSON content types. | Medium |
| P6 | **CSP permits `unsafe-inline` and `unsafe-eval` scripts** | `next.config.mjs` | An XSS sink exists; the CSP would not contain it. `connect-src 'self'` still limits exfiltration. | Medium |
| P7 | **Ticket and article text leaves to LLM providers without redaction or opt-out** | `ai/llm.ts`, no redaction in `src/server/ai` | Tickets carry personal or confidential data and a provider key is configured. | Medium (privacy) |
| P8 | **Several SSE streams per tab**: four client call sites open `EventSource` | `TopBar.tsx:215`, `TriageView.tsx:69`, `useLiveRefresh.ts:29`, `liveTicket.ts:82` | HTTP/1.1 connection limits or platform concurrency caps apply. | Low–Medium |
| P9 | **JWT sessions cannot be revoked server-side**; cookie flags are Auth.js defaults | `auth.config.ts` | A session must be ended early (leaver, compromise). | Medium |
| P10 | **Hand-written row types vs `any` Prisma delegates** | `prismaStore.ts`, `domain/models.ts` | Schema and model types diverge; the compiler will not say so. | Low–Medium |
| P11 | **Audit chain has no external anchor** | `auditChain.ts` | Someone with write access recomputes later hashes. | Low–Medium |
| P12 | **Test and CI coverage gaps**: no Postgres run in CI, no UI tests; CI documented as blocked by a billing lock | `ci.yml`, `package.json`, `docs/IMPLEMENTATION_STATUS.md` | A Prisma-only or UI regression ships. | Medium |

Also noted, lower priority: impersonation (`x-impersonate`) was not traced into audit payloads (**Unknown**); webhook `GET` handlers answer unauthenticated with a usage message (harmless); the SSRF guard resolves DNS before connecting, so rebinding between check and connect is not addressed by the code read; Groq's default model is recorded as retired in `docs/IMPLEMENTATION_STATUS.md` (offline template used instead).

## Strengths to preserve

These are confirmed and worth protecting during any refactor.

- Tenant mismatch answers 404; tenant comes from the credential, never the body (`guards.ts`, `context.ts`).
- Hash-only API keys; account lockout; scrypt; one-time hashed access tokens (`apiKeys.ts`, `accountAccessService.ts`).
- Audit blocks written in the same transaction as the change they record (`auditChain.ts`, `ticketService.ts`, `workflowService.ts`).
- Compare-and-set workflow transitions with bounded retries, and a leased, cursor-based sweep (`workflowService.ts`, `durableLease.ts`).
- At-least-once outbox with leases and backoff, and callbacks with HMAC, no redirects and private-address refusal (`workflowOutbox.ts`, `integrationWebhookService.ts`).
- Production environment gates in build, start and container entrypoint (`scripts/check-production-*.cjs`).
- Every integration optional with a deterministic fallback (`config.ts`, `ai/*`).
- A real test suite on the memory driver covering the sensitive paths (50 files).
- Candour in the docs: ADR 0001 and `IMPLEMENTATION_STATUS.md` state known issues and ceilings.

## Prioritised roadmap

Ordered by impact over effort. Effort is a rough size for this codebase, not a commitment.

### Now (days)

| # | Action | Justification | Effort |
|---|---|---|---|
| R1 | Declare the workflow sweep schedule in `vercel.json` `crons` (or alarm on a stale lease `lastSuccessAt`), and add a trigger for the legacy tick ([V2](#v2-nothing-in-the-repository-schedules-background-work-on-serverless)) | Highest silent-failure risk: SLA breaches and confirmation emails stop without any error | S–M |
| R2 | Refuse non-request channel intake when more than one tenant exists and no tenant binding is configured ([V3](#v3-inbound-channels-have-no-tenant-routing)) | Prevents cross-customer misrouting before the full design lands | S |
| R3 | Decide Sentry: install and register it, or delete the hook and `SENTRY_DSN` ([V1](#v1-sentry-reporting-is-inert)) | A false monitoring signal is worse than none | S |
| R4 | Fix the Brevo comparison with `timingSafeEqual`, prefer the header ([V7](#v7-brevo-inbound-secret-compared-non-constant-time-and-placed-in-the-url)) | Cheap, closes an inconsistency | XS |
| R5 | Add two contract tests: route tree vs OpenAPI paths, and every handler has an accepted guard ([V5](#v5-published-api-contract-has-drifted), [V10](#v10-two-authorization-idioms-give-different-status-codes)) | Turns drift and unguarded-route risk into failing tests | S |
| R6 | Fix drift: health `version` from `package.json`, README `middleware.ts` → `proxy.ts`, add the five missing OpenAPI paths | Trust in documentation | XS |

### Next (weeks)

| # | Action | Justification | Effort |
|---|---|---|---|
| R7 | Replace lazy imports with a ticket lifecycle port ([V4](#v4-hidden-runtime-import-cycle), [P-ADR-3](architecture-decisions.md#p-adr-3-break-the-service-import-cycle-with-a-lifecycle-port)), one edge at a time | Reduces coupling in the part of the code that changes most | M |
| R8 | One authorization wrapper for all `/api/v1` handlers ([P-ADR-5](architecture-decisions.md#p-adr-5-one-authorization-idiom)) | Uniform 401/403, easier audit | M |
| R9 | Add `tenantId` to the five child tables and filter on it ([P2](#potential-risks), [P-ADR-9](architecture-decisions.md#p-adr-9-defence-in-depth-for-tenant-data)) | Removes dependence on call order for isolation | M |
| R10 | Port `databaseBlob` onto the DataStore ([V8](#v8-database-attachment-storage-bypasses-the-datastore-port)) | Restores the one clean data boundary | S–M |
| R11 | One Graph client and one `clientIp()` helper ([V11](#v11-duplicated-infrastructure-code)) | Removes security-relevant duplication | S |
| R12 | Add `global-error.tsx`, `not-found.tsx` ([V12](#v12-no-app-router-error-boundaries)) | Recovery and reporting hook | S |
| R13 | Run the Prisma-backed tests against a Postgres service container in CI ([P12](#potential-risks)) | Memory-driver parity is the main untested assumption | M |

### Later or conditional

| # | Action | Trigger |
|---|---|---|
| R14 | Replace tenant-wide scans with indexed or aggregate queries ([P3](#potential-risks)) | Measured volume warrants it (ADR 0001's own condition) |
| R15 | Decide pgvector: remove or adopt with a threshold ([V6](#v6-pgvector-is-provisioned-but-unused)) | Before the next knowledge-base growth, or when search latency is measured |
| R16 | Shared state for rate limits and live events ([P1](#potential-risks), P-ADR-8) | A second production instance |
| R17 | Remove Redis artefacts or build the queue ([V9](#v9-redis-and-bullmq-are-declared-but-unused)) | Immediately cosmetic; build only if queue semantics are needed |
| R18 | Nonce-based CSP; explicit Origin check on state-changing routes ([P5](#potential-risks), [P6](#potential-risks)) | Next security review, or before opening to external customers |
| R19 | Redaction and per-tenant switch for LLM egress ([P7](#potential-risks)) | Before handling regulated data |
| R20 | Server-side session revocation list, or short JWT lifetime ([P9](#potential-risks)) | Before private SSO replaces the public demo sign-in |

## Technical debt and unnecessary complexity (summary)

- **Dual mechanisms for the same job:** two background runners with different guarantees; two authorization idioms; two email providers selected exclusively; two stores (one is demo-only but shapes every query to equality filters).
- **Aspirational infrastructure:** Redis, BullMQ externals, pgvector, Sentry. Each is described as present and none is active.
- **Very large UI files:** `src/components/SettingsView.tsx` (2,656 lines), `TicketsExplorer.tsx` (1,889) and `ProfileView.tsx` (1,675) are single components that carry many screens' worth of state and fetching; they are the hardest files to change safely and have no automated UI tests. Service files are smaller (largest `agentActions.ts`, 596 lines) but `workflowService.ts` and `workflowMonitoring.ts` use very long, dense lines.
- **Hand-maintained duplicates of truth:** OpenAPI, row types, README tree. Each has already drifted at least once.

None of this blocks the product. The correctness-critical designs (tenant scoping, transactions, audit, workflow concurrency) are sound; the risk is concentrated in operations (scheduling, monitoring) and in boundaries that rely on discipline rather than enforcement.

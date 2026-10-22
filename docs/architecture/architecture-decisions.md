# Architecture decisions

Three tiers, kept apart on purpose:

- **Confirmed**: stated by the authors in code comments, schema comments or documents. The source is cited.
- **Inferred**: not stated, but the code is consistent with exactly one reasonable motive. The reasoning is given and may be wrong.
- **Proposed**: recommendations from this audit. They do not exist in the repository. They are written as draft ADRs for the maintainers to accept, change or reject.

The repository already holds one formal record, [`docs/decisions/0001-service-desk-workflow.md`](../decisions/0001-service-desk-workflow.md) (2026-09-30, "accepted for this release"). It is the model for the format below.

## Confirmed decisions

| # | Decision | Rationale as stated | Source |
|---|---|---|---|
| C1 | **One Next.js App Router monolith** serves UI, REST API and webhooks | "Next.js (App Router) full-stack monolith using a ports-and-adapters design" | `README.md` Architecture |
| C2 | **Persistence behind a `DataStore` port** with Prisma and memory adapters, chosen by `DATA_DRIVER` | "swapping persistence is a one-line env change … with zero changes anywhere else" | `src/server/data/store.ts`, `index.ts` |
| C3 | **Every external capability is optional** with a graceful fallback (memory store, offline AI template, in-app-only notifications, demo auth) | "lets the production architecture run as a zero-infra demo" | `src/server/config.ts` header |
| C4 | **JWT sessions, Auth.js v5**, with an edge-safe config split from the database-backed provider config | "Edge-safe auth configuration (no database imports)" | `src/auth.config.ts`, `src/auth.ts` |
| C5 | **API keys are hash-only, shown once, tenant-bound, constant-time verified** | stated in header | `src/server/auth/apiKeys.ts` |
| C6 | **Tenant mismatch answers 404, not 403** | "confirming that an id exists in some other tenant is itself a disclosure" | `src/server/guards.ts` |
| C7 | **Tamper-evident audit chain** inside the caller's transaction | header | `src/server/audit/auditChain.ts` |
| C8 | **Serializable transactions** with long `maxWait`/`timeout` and bounded retries | "Neon's compute can need a few seconds to wake and PgBouncer may queue briefly" | `src/server/data/prismaStore.ts` |
| C9 | **Opt-in bucket workflow** with durable DB state, compare-and-set, leased minute sweep, at-least-once email, no AI resolution | ADR 0001 | `docs/decisions/0001-service-desk-workflow.md` |
| C10 | **External scheduler for liveness on Vercel**, because "Vercel does not guarantee in-process timers" | operations guide | `docs/SERVICE_DESK_WORKFLOW.md:108` |
| C11 | **Redis/BullMQ rejected for now** ("adds infrastructure and operational cost") | ADR 0001; the lock module names BullMQ as the "documented next step" | ADR 0001, `src/server/jobs/lock.ts` |
| C12 | **Single-node event bus** with Redis pub/sub named as the future seam | "Single-node by design … the seam where Redis pub/sub slots in" | `src/server/events/bus.ts` |
| C13 | **Flat scalar arrays and JSON** for ticket links, tags and workflow state, so both drivers share one shape | schema comment | `prisma/schema.prisma` |
| C14 | **Hand-maintained OpenAPI 3.1** | "hand-maintained OpenAPI 3.1 description" | `src/app/api/v1/openapi.json/route.ts` |
| C15 | **Production environment gates** refuse to build or start on demo or placeholder settings | scripts and `vercel-build` | `scripts/check-production-*.cjs`, `package.json` |
| C16 | **Public demo sign-in is an owner-approved showcase risk** on the hosted app | Known Issues | `docs/IMPLEMENTATION_STATUS.md` |
| C17 | **Tenant-history scans have a documented scale ceiling** to be replaced by indexed or aggregate queries when volume warrants | ADR 0001 consequences | ADR 0001 |
| C18 | **Soft delete keeps history for reporting** | `listTicketsForReporting` comment: "Deletion removes a ticket from normal operations, not from compliance/reporting history" | `src/server/services/ticketService.ts` |
| C19 | **AI never resolves without human review inside the bucket workflow; P1 never auto-resolves** | `decide()` and ADR 0001 | `src/server/ai/resolver.ts` |

## Inferred decisions

| # | Decision | Why it is inferred | Confidence |
|---|---|---|---|
| I1 | **All UI data comes from `/api/v1` via client fetches**, with no Server Component data loading and no Server Actions | No `"use server"`, no data access in server pages, every page calls `apiGet`. One API then serves both the UI and external integrators and keeps one authorization path. | High |
| I2 | **No framework caching** | `force-dynamic` on 77 route files and `cache: "no-store"` on client fetches; data is tenant- and role-specific. | High |
| I3 | **Own REST envelope and RBAC matrix** rather than tRPC, GraphQL or a policy library | Consistent `{ ok, data }` and a 91-line `rbac.ts`; consistent with a small team and an external REST contract. | Medium |
| I4 | **Vercel serverless plus Neon** is the production target | `vercel.json`, the Vercel URL in `README.md`, the Neon-only environment check, Neon comments in code. The Docker path exists as an alternative. | High for Neon, medium for Vercel |
| I5 | **In-process vector search** is the working design and pgvector is aspirational | `vectorSearch.ts` comment calls the in-process path "the portable fallback", but no code queries the column. The SQL file may be a prepared step. | Medium |
| I6 | **Workflow state in JSON columns** on `Ticket` (`workflow`, `workflowVersion`) rather than a child table | Matches C13 and keeps `updateIf` on one row. | High |
| I7 | **Lazy `import()` to break cycles** between services | Nine of the ten `await import()` calls in `src/server` sit exactly on the edges that would otherwise form a cycle; the comments do not say so. | High |
| I8 | **Shared `src/shared/*` for code both sides use** (RBAC role helpers, workflow types, priority, attachment limits) | The folder holds only code imported from client and server. | High |
| I9 | **A tenant per organization, one database** | `tenantId` on 24 of 34 models, unique `(tenantId, …)` indexes, cascade delete from `Tenant`. | High |
| I10 | **`proxy.ts` is a coarse gate; real authentication happens in route context** | Its comments say full key validation happens in `context.ts` (Node). | High |

## Proposed ADRs

Each is written as a short, independent draft. Priorities link to [risks-and-recommendations.md](risks-and-recommendations.md).

### P-ADR-1: Tenant routing for inbound channels

- **Status:** Proposed. **Addresses:** [V3](risks-and-recommendations.md#v3-inbound-channels-have-no-tenant-routing).
- **Context.** Webhooks, email, Slack and Teams resolve the tenant as "the first tenant" (`context.ts`, `data/index.ts`). Multi-tenant deployments cannot separate inbound traffic, and "first" depends on store order.
- **Decision (proposed).** Resolve the tenant from the channel's own identity: a per-tenant webhook secret or path token, the destination mailbox address (Graph and Brevo), the Slack team id, the Teams tenant id. Reject traffic that matches no tenant. Fall back to the single tenant only when exactly one exists.
- **Consequences.** A schema addition (channel bindings), an admin screen, and a migration for existing single-tenant setups. Removes a data-misrouting risk. Cost: moderate.
- **Alternatives.** Document single-tenant-only channels as a limitation, cheapest, acceptable while one organization uses channels.

### P-ADR-2: Make scheduling part of the repository

- **Status:** Proposed. **Addresses:** [V2](risks-and-recommendations.md#v2-nothing-in-the-repository-schedules-background-work-on-serverless).
- **Context.** Liveness depends on an external cron-job.org account the repository cannot show; the legacy sweeps have no HTTP trigger.
- **Decision (proposed).** Declare the schedule in `vercel.json` `crons` (or the host's equivalent), authenticated with `CRON_SECRET`, and add a second authenticated endpoint that runs the legacy `tick()` body so SLA, digest and mail polling no longer rely on warm instances. Keep the lease and the local interval for long-running hosts.
- **Consequences.** Cron minimum interval and function duration limits of the hosting plan apply (**Unknown** plan). Schedule becomes reviewable and testable.
- **Alternatives.** Keep the external scheduler and add a health check that alarms when `lastSuccessAt` on the lease is stale.

### P-ADR-3: Break the service import cycle with a lifecycle port

- **Status:** Proposed. **Addresses:** [V4](risks-and-recommendations.md#v4-hidden-runtime-import-cycle).
- **Context.** Sixteen service files form a runtime cycle held together by lazy imports.
- **Decision (proposed).** Introduce a small `TicketLifecycle` interface (events such as `ticketMutated`, `approvalGranted`, `ticketNeedsTriage`) implemented in one composition module. `ticketService` publishes; automation, approval and AI subscribe. Replace each `await import()` with a call through the port.
- **Consequences.** One more indirection, but dependencies point one way and become testable by substitution. Cost: moderate, incremental, one edge at a time.
- **Alternatives.** Move shared functions down (extract `mutateTicket` core); accept and document the cycle.

### P-ADR-4: Decide the future of pgvector

- **Status:** Proposed. **Addresses:** [V6](risks-and-recommendations.md#v6-pgvector-is-provisioned-but-unused).
- **Decision (proposed).** Until article volume justifies it, remove the unused extension and SQL from the setup path and state in a comment that search is in-process; adopt pgvector, with a measured threshold, only when a tenant's published articles exceed a size where in-process ranking is slow. Decide by measuring on the production dataset.
- **Consequences.** Removes a misleading migration artefact now; keeps an upgrade path.

### P-ADR-5: One authorization idiom

- **Status:** Proposed. **Addresses:** [V10](risks-and-recommendations.md#v10-two-authorization-idioms-give-different-status-codes).
- **Decision (proposed).** Every `/api/v1` handler uses `requirePermission` (or a thin `withPermission(permission, handler)` wrapper that also parses the body and applies the rate limit). Add a test that walks the route tree and fails if a handler lacks one of the accepted guards.
- **Consequences.** Uniform 401 versus 403, and a CI-level guarantee that a new route cannot ship unguarded. Cost: low.

### P-ADR-6: Keep the published contract honest

- **Status:** Proposed. **Addresses:** [V5](risks-and-recommendations.md#v5-published-api-contract-has-drifted).
- **Decision (proposed).** Add a contract test that lists every `route.ts` path and method and compares it with the OpenAPI paths, allowing an explicit exclusion list; generate the health `version` from `package.json`.
- **Consequences.** Drift becomes a failing test rather than a review finding. Cost: low.

### P-ADR-7: Observability baseline

- **Status:** Proposed. **Addresses:** [V1](risks-and-recommendations.md#v1-sentry-reporting-is-inert).
- **Decision (proposed).** Either install `@sentry/nextjs` and register it in `instrumentation.ts` (assigning the capture hook the logger already calls), or delete the hook and the `SENTRY_DSN` variable. Add request ids to log lines and alarm on stale job lease and failed outbox deliveries.
- **Consequences.** Production failures become visible. Cost: low to moderate.

### P-ADR-8: Shared state only when a second instance is real

- **Status:** Proposed, conditional.
- **Context.** Event bus, rate limits and job locks are per process. This is fine for one instance and silently weaker for many.
- **Decision (proposed).** Do nothing now. Record the trigger: when more than one instance serves production, move the rate limiter to the existing DB-backed `sharedActionLimit` pattern and the event bus to Postgres `LISTEN/NOTIFY` or Redis. Prefer the database option to avoid a new service, consistent with ADR 0001.
- **Consequences.** Avoids premature infrastructure; makes the trigger explicit.

### P-ADR-9: Defence in depth for tenant data

- **Status:** Proposed.
- **Context.** Ten models have no `tenantId`; isolation depends on every path loading the parent first.
- **Decision (proposed).** Add `tenantId` to `TicketMessage`, `Attachment`, `Approval`, `Resolution` and `Citation` (with an index) and filter on it in the services; consider Postgres row-level security as a later step.
- **Consequences.** A migration and a backfill, and less reliance on call-order discipline. Cost: moderate. Value rises with the number of tenants.

## What is not decided here

No recommendation on rewriting to Server Components or Server Actions: the single-API approach (I1) has real benefits for an externally consumed REST contract, and nothing found says it is causing harm. No recommendation to split the monolith: the findings are about boundaries inside it, not about deployment units.

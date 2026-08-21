# Implementation Status

## Project Objective
Safely evolve the existing Netlink Support application from its current local/memory persistence to production PostgreSQL while preserving all existing functionality and adding external API-key integration support for a third-party Support Management System.

## Current Phase
Phase 12 — Production deployment **IN PROGRESS (2026-08-21)**

Phase 12 approval was received. The production release candidate and all local
release gates are complete, but the live deployment is held at the environment
gate: required production Entra ID and Azure Blob credentials are unavailable,
and sensitive Vercel upload has not been authorized. No application deployment
or secret egress occurred.

## Completed Phases
- Phase 0 — Pre-flight verification
- Phase 1 — Local PostgreSQL activation
- Phase 2 — JSON → PostgreSQL data migration
- Phase 3 — Database-backed application verification
- Phase 4 — External API readiness
- Phase 5 — Pagination (remediated and re-verified)
- Phase 6 — Ticket soft delete (remediated and re-verified)
- Phase 7 — CORS & Origin Security (remediated and re-verified)
- Phase 8 — Production security hardening (remediated and re-verified)
- Phase 9 — Attachment storage (implemented and verified)
- Phase 10 — Production environment (implemented and verified)
- Phase 11 — Production database migration (executed and verified)

Previously reported phases requiring remediation have now been re-verified.

## Phase 5 Remediation — 2026-08-21

### Implemented

- Added a strict shared query contract: canonical page/pageSize parameters,
  the legacy limit alias, a maximum page size of 100, positive-integer
  validation, overflow protection, endpoint-specific sort allowlists, and
  strict asc/desc validation.
- Standardized list responses as ok/data/meta with total, page, pageSize,
  backward-compatible limit, and totalPages.
- Added a shared pageCollection datastore operation that lists one page and
  counts the full filtered result concurrently.
- Made page ordering deterministic in both data drivers by using id as the
  secondary sort key; Prisma receives the equivalent compound orderBy.
- Applied the contract to all 22 true list route files: API keys, assets,
  audit, automations, calendars, catalog, changes, CIs, custom fields,
  departments, groups, knowledge base, ranked KB search, macros,
  notifications, organizations, problems, SLA policies, tickets, ticket
  approvals, ticket attachments, and users. Aggregate/detail modes retain
  their existing non-list response shapes.
- Added apiGetAll and migrated array-list UI consumers so server pagination
  does not truncate existing screens. Existing filters are preserved while
  pages are fetched in batches of 100.
- Updated OpenAPI with the shared pagination parameters, legacy aliases,
  PageMeta schema, and pagination annotations for documented list operations.
- Added focused coverage for defaults, canonical and legacy parameters,
  invalid/overflow values, sort validation, page 1/page 2/empty pages,
  filtering, deterministic sorting, full filtered counts, MemoryStore,
  PrismaStore query construction, multi-page client consumption, and route
  adoption.

### Verification

- TypeScript: passed.
- Focused pagination suite: 38/38 passed.
- Full test suite: 20 files, 141/141 passed.
- Prisma schema validation: passed.
- Production build: passed, including type checking and all 18 static pages.
- CodeGraph post-change audit found shared pagination connected through the
  route, datastore, and client layers, with focused tests on both drivers.
- Diff whitespace check passed for Phase 5 files.
- No schema migration, seed mutation, or live database write was performed.

## Phase 6 Remediation — 2026-08-21

### Implemented

- Made Ticket.deletedAt a required nullable field in the shared row contract
  and normalized older memory JSON snapshots from missing/undefined to null.
- Added deletedAt=null to generated seed tickets so MemoryStore and
  PrismaStore use the same active-ticket predicate.
- Added a reproducible, additive, idempotent Prisma migration for deletedAt
  and a tenantId/deletedAt index. The migration is safe when an environment
  already received the column through an earlier db push.
- Centralized operational reads through listActiveTickets/getTicket. Normal
  ticket lists, detail guards, metrics, triage, bulk assignment, least-loaded
  routing, email threading, CMDB impact, problem linking/clustering/metrics,
  attachments, automations, AI, and scheduled jobs now reject deleted tickets.
- Added listTicketsForReporting as an explicit historical path. CSV/PDF report
  rows and trends retain deleted tickets, including their deletedAt timestamp.
- Preserved the ticket row, messages, events, audit records, attachments, and
  ticket relationships. No ticket hard-delete caller exists.
- Prevented normal mutations and SLA application after deletion.
- Retained the existing manager-or-higher ticket.delete permission gate and
  documented DELETE /tickets/{id} as a soft-delete operation in OpenAPI.

### Verification

- TypeScript: passed.
- Focused soft-delete suite: 5/5 passed.
- Full test suite: 21 files, 146/146 passed.
- Prisma schema validation: passed.
- Prisma migration status: two migrations found; the new Phase 6 migration is
  intentionally pending for the controlled Phase 11 production deployment.
- Production build: passed, including type checking and all 18 static pages.
- CodeGraph confirmed operational consumers route through active-ticket reads;
  the only direct update outside ticketService is guarded SLA persistence.
- Diff whitespace check passed for Phase 6 files.
- No live database write, hard deletion, reset, or migration deployment ran.

## Phase 7 Remediation — 2026-08-21

### Implemented

- Confirmed from the approved architecture and integration contract that the
  third-party Support Management System consumes `/api/v1` from its backend
  over HTTPS using an API key. Browser-to-API access is not the supported
  integration path, so CORS is unnecessary.
- Removed origin reflection, wildcard allowlisting, credentialed CORS response
  headers, and the special unauthenticated OPTIONS response from edge
  middleware.
- Removed the unsafe `ALLOWED_ORIGINS="*"` example. Any stale local value is
  ignored because the application no longer reads that setting.
- Kept same-origin session requests and M2M API-key requests unchanged. GET,
  POST, PATCH, and all other methods use the same authentication gate; OPTIONS
  can no longer bypass production authentication.
- Extracted the edge-safe API access decision into a pure module so gateway
  authentication behavior is directly regression-tested without importing the
  NextAuth runtime into Vitest.

### Verification

- TypeScript: passed.
- Focused origin/gateway suite: 8/8 passed.
- Verified API-key access for GET, POST, and PATCH without an Origin header.
- Verified arbitrary and formerly wildcard-enabled origins receive no CORS
  response policy, and unauthenticated production OPTIONS receives 401.
- Verified same-origin session access remains allowed without CORS headers.
- Full test suite: 22 files, 154/154 passed.
- Production build: passed, including type checking and all 18 static pages.
- CodeGraph traced middleware into the shared access decision and its focused
  tests; a repository scan found no active CORS policy or OPTIONS bypass.
- Diff whitespace check passed for Phase 7 files.
- No schema, migration, seed, or live database write was performed.

## Phase 8 Remediation — 2026-08-21

### Implemented

- Added a production preflight that requires `DEMO_MODE=false` exactly and an
  `AUTH_SECRET` with at least 32 characters, rejects placeholder/low-diversity
  values, and never prints the supplied secret.
- Wired the preflight into `npm start` and the standalone Docker entrypoint so
  unsafe deployments refuse to serve traffic. The local development flow is
  unchanged.
- Removed the committed insecure Auth.js fallback. Demo mode now uses a
  cryptographically random, process-stable signing secret; non-demo auth also
  rejects missing or short secrets inside the application.
- Replaced Content-Length-only JSON checks with bounded stream reading. The
  one-megabyte limit now applies to actual bytes received when the header is
  absent, chunked, malformed, or understated. All JSON API helpers and raw
  webhook readers use the bounded path.
- Added nested structured-log redaction for authorization headers, cookies,
  passwords, secrets, tokens, API keys/hashes, database URLs, connection
  strings, DSNs, credentialed URLs, query tokens, and provider error messages.
  Runtime error logging now passes through the protected logger.
- Moved the remaining runtime client imports of RBAC/priority constants from
  server-only paths into dependency-free shared modules. Type-only domain
  imports remain compile-time-only and are erased from browser bundles.
- Retained the v1 in-memory limiter as required. Documented that limits are per
  process/edge isolate, reset on restart, and do not aggregate across replicas;
  a distributed limiter is required before horizontal API scaling.
- Re-verified API keys as SHA-256 hashed, full-secret-once, revocable,
  admin-permission controlled, tenant scoped, expirable, constant-time checked,
  and audited without storing the full key.

### Verification

- Production security preflight passed with an ephemeral valid test
  configuration and rejects missing/demo/weak/placeholder secrets in tests.
- Focused Phase 8 security suite: 17/17 passed.
- Expanded API-key suite: 7/7 passed, including cross-tenant revocation denial
  and tamper-evident creation/revocation audit events.
- Full test suite: 23 files, 174/174 passed.
- TypeScript and Prisma schema validation passed.
- Production build passed, including type checking and all 18 static pages.
- Repository scans found no hardcoded production credential assignments,
  exposed NEXT_PUBLIC secrets, direct unbounded JSON/text API readers, or
  runtime server-module imports in client components.
- CodeGraph traced the hardened request/auth/RBAC paths and found no uncovered
  request-body or authorization bypass.
- No Redis dependency was added and no schema, migration, seed, or live
  database write was performed.

## Phase 9 Implementation — 2026-08-21

### Implemented

- Retained the single existing BlobStore abstraction and its local-disk and
  Azure Blob adapters; no second storage abstraction or SDK dependency was
  introduced.
- Made tenantId mandatory for attachment save, list, metadata, binary-read,
  and delete service operations. Every operation now verifies the active
  parent ticket belongs to that tenant, and downloads perform tenant/requester
  authorization before fetching blob bytes.
- Replaced direct unbounded Request.formData parsing with actual-byte bounded
  multipart streaming. The request cap covers five configured per-file limits
  plus bounded multipart overhead and rejects declared or actually oversized
  bodies with HTTP 413.
- Made multi-file uploads request-atomic at the storage/metadata layer: every
  file is validated and scanned before the first write; a later blob or row
  failure rolls back earlier rows and blobs; a row-insert failure removes its
  newly written blob.
- Made deletion failure-safe by removing metadata first and restoring it if
  blob deletion fails. Missing blobs are treated as idempotent cleanup, while
  real local/Azure storage failures throw instead of being reported as
  successful deletion.
- Hardened blob keys against path traversal/collisions, validated positive
  attachment-size configuration, validated Azure account/container settings,
  made malformed Azure configuration fail closed, and deduplicated concurrent
  container initialization.
- Persisted the validated MIME type into Azure Blob Content-Type while keeping
  authoritative attachment metadata and ticket association in PostgreSQL.
  Download responses use actual byte length, forced attachment disposition,
  nosniff, CSP sandbox, same-origin resource policy, and private/no-cache
  headers.
- Preserved attachment add/remove audit events without recording binary
  content. Email-ingested attachments now use the same explicit tenant-scoped
  service path as API uploads.
- Documented Azure Blob as the production storage choice and local disk as a
  development or durable single-node option. No real credential was added.

### Verification

- Focused attachment suite: 8/8 passed. It executes API-key-authenticated
  upload, paginated metadata listing, download, delete, invalid-key denial,
  cross-tenant 404 behavior, request-size rejection, filename/MIME metadata,
  audit events, all-file prevalidation, upload rollback, metadata compensation,
  authorization-before-blob-read, and mocked Azure SharedKey operations.
- Full test suite: 24 files, 182/182 passed.
- TypeScript and Prisma schema validation passed.
- Production build passed, including type checking and all 18 static pages.
- CodeGraph traced all attachment calls through tenant-scoped services and
  found no API route that reads blob bytes before tenant/ticket authorization.
- Read-only inventory found 0 attachment metadata rows in the configured Neon
  database, 0 local:// database references, and 3 unmatched local blob files.
  Therefore no binary migration is necessary. The unmatched files were left
  untouched; deletion would be a separate destructive cleanup decision.
- No schema change, migration deployment, seed mutation, database write, blob
  migration, or destructive cleanup was performed.

## Phase 10 Implementation — 2026-08-21

### Implemented

- Added `.env.production.example` as a secret-free, required-only production
  contract. It documents the pooled Neon runtime URL, Prisma driver, migration-
  only direct Neon URL, strong Auth.js secret, disabled demo mode, tenant-
  specific Microsoft Entra ID SSO, and private Azure Blob credentials.
- Kept optional AI, email, webhook, chat-channel, Redis, observability, and
  defaulted attachment settings out of the production contract.
- Added a production startup validator that composes the Phase 8 authentication
  checks and fails closed for memory/demo settings, placeholders, local or
  non-Neon databases, non-pooled application URLs, insecure/mismatched direct
  migration URLs, incomplete Entra SSO, and invalid Azure storage settings.
- Kept `DIRECT_URL` optional for the running application and documented it as a
  migration-job-only secret, so the app container needs only the pooled runtime
  credential. When provided, it must target the matching direct Neon endpoint.
- Wired the full environment check into `npm start` and the standalone Docker
  entrypoint. Validation errors identify variable names but never print the
  supplied credential values.
- Separated local and production examples explicitly. `.gitignore` now rejects
  populated `.env*` files while preserving example templates, and `.dockerignore`
  excludes every `.env*` file from image build contexts.

### Verification

- Focused Phase 8/10 suites: 32/32 passed; Phase 10 contributes 15 tests for
  required settings, environment isolation, pooled/direct Neon roles, secret
  redaction, startup wiring, and the example/ignore contracts.
- Full test suite: 25 files, 197/197 passed.
- TypeScript and Prisma schema validation passed.
- Production build passed, including type checking and all 18 static pages.
- The production checker passed with ephemeral, synthetic valid values; no real
  credential was read or printed. Negative tests reject demo, memory, local,
  missing, placeholder, and mismatched settings.
- Git ignore verification confirmed `.env.production` is ignored while
  `.env.production.example` and `.env.example` remain available to version.
- CodeGraph traced the new checker into the inherited Phase 8 security check and
  focused tests. Diff whitespace and JavaScript syntax checks passed.
- No production migration, Prisma deploy/reset, database write, deployment, or
  real environment-secret change was performed.

## Phase 11 Implementation — 2026-08-21

### Implemented

- Re-verified the production connection contract without exposing credentials:
  both URLs use PostgreSQL on Neon with required TLS; `DATABASE_URL` is pooled,
  `DIRECT_URL` is unpooled, and their masked endpoint/database fingerprints
  match the same `neondb` target in the `public` schema.
- Reviewed both checked-in migrations before execution. The initial migration
  was already applied; the only pending migration was
  `20260821143000_ticket_soft_delete`, containing only an idempotent nullable
  `Ticket.deletedAt` column and composite tenant/deletion index.
- Executed exactly `npx prisma migrate deploy` through the direct connection.
  No reset, db push, development migration, seed, ad hoc mutation, or data
  cleanup command ran.
- Added reusable read-only verification artifacts. The schema verifier asserts
  all 27 application tables and primary keys, the soft-delete column/index,
  index readiness/validity, validated constraints, the Ticket tenant foreign
  key, and the successful migration record.
- Added a source-ID verifier that safely generates SQL assertions from the
  current JSON snapshot. It rejects missing collections, invalid IDs, and
  duplicate IDs before querying and never prints source identifiers.

### Verification

- Prisma migration status reports both migrations applied and the database
  schema up to date.
- Production schema assertions passed for all tables, primary keys, indexes,
  constraints, the nullable timestamp column, and migration history.
- The application Prisma Client completed a read-only query against
  `neondb/public`, proving runtime connectivity after migration.
- All 275 IDs across the 27 JSON entity collections still exist in PostgreSQL;
  0 are missing and `.data/store.json` was not changed.
- Focused Phase 11/soft-delete suites: 8/8 passed; Phase 11 contributes three
  regression tests for comprehensive, read-only verification behavior.
- Full test suite: 26 files, 200/200 passed.
- TypeScript, Prisma schema validation, JavaScript syntax, CodeGraph, and diff
  whitespace checks passed.
- Production build passed, including type checking and all 18 static pages.
- Official Neon and Prisma guidance was checked before execution; the direct
  migration connection and production-only `migrate deploy` flow match it.
- No deployment, environment-secret mutation, destructive migration, reset,
  data rewrite, seed, or application-data deletion was performed.

## Verification Audit — 2026-08-21

## Phase 12 Production Deployment Preparation - 2026-08-21

### Implemented

- Replaced the deprecated interactive `next lint` command with a reproducible
  ESLint flat configuration and a zero-warning CI/release gate.
- Fixed all existing lint errors and warnings without weakening applicable
  Next.js core-web-vitals, TypeScript, or standard React Hooks checks. Three
  React Compiler-only rules are explicitly disabled because this application
  does not enable React Compiler.
- Updated the runtime from vulnerable Next.js 15.5.19/Auth.js beta.31 packages
  to patched Next.js 16.3.2 and Auth.js beta.32 packages, removed the unused
  Transformers/ONNX/native image dependency chain, and pinned Prisma's
  transitive `deepmerge-ts` package to the compatible security-fixed 8.0.0 API.
- Migrated the deprecated `src/middleware.ts` convention to the supported
  Next.js 16 `src/proxy.ts` convention. Authentication and API gateway behavior
  are unchanged and now build without Edge/Jose compatibility warnings.
- Added `vercel.json` to select the Next.js framework preset explicitly.
- Added lint and production dependency audit jobs to GitHub CI.
- Created the Vercel project `dhwaj-s-projects/netlink-support` and linked this
  workspace to it. Its Git connection to
  `https://github.com/dhwajdhruvkar/helpdesk-ai` was verified, then temporarily
  disconnected so publishing the release branch cannot create an
  environment-less preview deployment.
- Created the code-only release branch `phase12-production-deployment`. No
  populated environment file or credential is tracked. The verified local
  release commit is `3e7510a`.

### Verification

- Node.js 22.14.0 satisfies Next.js 16's Node.js 20.9+ requirement.
- Prisma Client 6.19.3 generation passed against the checked-in schema.
- TypeScript passed.
- ESLint passed with zero warnings.
- Full test suite passed: 26 files, 200/200 tests.
- The optimized Next.js 16.3.2 Turbopack production build passed and emitted
  every expected page/API route, including `/api/v1/health`, without warnings.
- `npm audit --omit=dev` reports 0 vulnerabilities.
- Vercel project inspection confirms the project exists and has zero
  deployments. The committed `vercel.json` overrides its initially empty
  framework setting to the supported `nextjs` preset for the first deployment.

### Deployment gate - not yet released

- No production deployment was executed, so no live health/frontend/login/
  dashboard/tickets/API/database/authentication verification can be claimed.
- Vercel currently has no environment variables. Local/system/GitHub/Vercel
  inventories contain no production Entra ID or Azure Blob credentials.
- The local `.env` has a valid pooled Neon runtime URL, but its Auth.js secret
  is a development placeholder and `DEMO_MODE=true`; those unsafe values were
  not uploaded.
- Uploading the validated Neon credential and a newly generated Auth.js secret
  to Vercel requires explicit sensitive-egress approval. The attempted upload
  was rejected before any value left the machine; no secret was printed.
- The owner must provide/authorize these Vercel Production values before a
  release: `DATABASE_URL`, `DATA_DRIVER=prisma`, a strong `AUTH_SECRET`,
  `DEMO_MODE=false`, `AUTH_MICROSOFT_ENTRA_ID_ID`,
  `AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_ISSUER`, and
  `AZURE_STORAGE_CONNECTION_STRING`. `DIRECT_URL` remains migration-job-only.
- GitHub Actions reports that jobs cannot start because the GitHub account is
  locked by a billing issue. Local gates are green, but GitHub CI cannot provide
  independent evidence until that account issue is resolved.
- Publishing commit `3e7510a` to
  `github.com/dhwajdhruvkar/helpdesk-ai` requires explicit authorization for
  that code payload and destination. The rejected push transferred no code.

### Confirmed

- Prisma is the configured driver and connects to the configured Neon database.
- Prisma validation passed and both checked-in migrations are applied.
- Every ID in `.data/store.json` exists in PostgreSQL: 0 missing IDs across all
  27 persisted entity collections. The source JSON was not changed.
- TypeScript passed, all 200 tests passed, and the production build passed.
- API keys are hashed, revocable, permission controlled, and tenant scoped.
- No `NEXT_PUBLIC_*` secrets or client imports of server modules were found.
- Production startup now rejects development/demo persistence, authentication,
  and attachment-storage settings before serving traffic.

### Remaining blocking discrepancies

1. Phase 12 cannot deploy until production Entra ID and Azure Blob credentials
   are supplied and sensitive Vercel secret upload is explicitly authorized.
2. GitHub Actions cannot start while the repository owner's billing lock is
   active.
3. The local release commit cannot be pushed until publication to the named
   GitHub repository is explicitly authorized.

### Phase 12 release status

Phase 12 is approved and its code-only release candidate is ready. Typecheck,
lint, tests, Prisma generation, dependency audit, and the production build all
pass. Live deployment and endpoint verification remain gated on the required
production credentials and explicit authorization for sensitive Vercel upload.

## Current Architecture
Next.js 16 App Router, React 19 SPA frontend, fully versioned REST API (`/api/v1/*`), NextAuth for UI authentication, API-key authentication (`nlk_*`) for M2M, Hexagonal DataStore abstraction.
**Data driver: `DATA_DRIVER=prisma` backed by Neon PostgreSQL (cloud).**
**API is fully externally consumable and validated via M2M workflows.**

## API Key / External Integration Status
- **Authentication**: M2M authentication successfully resolves via `Authorization: Bearer nlk_...` header.
- **RBAC Identity Mapping**: API keys act with their assigned role (`agent`, `requester`, etc.) rather than a specific user, enabling robust integration boundaries.
- **Intake Webhook (`/api/v1/intake`)**: External monitoring tools can file P1 incidents. Successfully mapped a critical `alert` payload to `impact: high` / `urgency: high` and linked it directly to a CMDB CI (`PROD-01 App Server`).
- **REST Surface**: General endpoints (e.g. `GET /api/v1/tickets`, `POST /api/v1/tickets`) successfully authorize via API key and return correct datasets constrained by the key's tenant.
- **Standard Envelope**: All API endpoints use the `ok(data)` / `fail(error)` uniform envelope from `src/server/http.ts`, assuring the third-party Support Management System of consistent shape.
- **Origin policy**: The supported third-party integration is backend-to-backend and uses no browser CORS policy. API-key requests work without an Origin header; same-origin UI requests continue to use their session.
- **Production security**: Startup refuses demo mode or a weak Auth.js secret; request bodies are stream-bounded and operational logs redact credential-shaped data.
- **Attachments**: API-key clients can upload, list, download, and delete ticket attachments through tenant-scoped routes. Production storage uses the existing private Azure Blob adapter when configured; multipart bodies and individual files are bounded.

## Database Status
- **Provider**: Neon PostgreSQL (free tier, ap-southeast-1)
- **Live**: Application reads/writes PostgreSQL for all operations
- **Migrations**: 2/2 applied; schema up to date

## Tests Run
- Typecheck: passed.
- Focused Phase 5 pagination tests: 38/38 passed.
- Focused Phase 6 soft-delete tests: 5/5 passed.
- Focused Phase 7 origin/gateway tests: 8/8 passed.
- Focused Phase 8 security tests: 17/17 passed.
- Focused Phase 9 attachment tests: 8/8 passed.
- Focused Phase 10 production-environment tests: 15/15 passed.
- Focused Phase 11 production-migration tests: 3/3 passed.
- Tests: 26 files, 200/200 passed.
- Prisma validation: passed.
- Migration status: 2/2 applied; database schema is up to date.
- JSON source-ID preservation: passed; 275 checked, 0 missing.
- Production build: passed on Next.js 16.3.2 without warnings.
- Lint: passed with zero warnings.
- Production dependency audit: 0 vulnerabilities.

## Known Issues
- `admin@netlink.com` resolves as `agent` role, not `tenant_admin` (design-correct, not a bug)
- Groq LLM model `llama-3.3-70b-versatile` deprecated/removed — AI falls back to offline template (pre-existing, not a regression)
- Phase 12 production secrets are not yet available/authorized in Vercel.
- GitHub Actions jobs are blocked by an account billing lock.

## Files Changed in Latest Phase
- Deployment and CI configuration: `vercel.json`, `Dockerfile`,
  `.dockerignore`, `.github/workflows/ci.yml`, and environment templates.
- Release tooling and dependencies: `eslint.config.mjs`, `package.json`,
  `package-lock.json`, `next.config.mjs`, and `tsconfig.json`.
- Next.js 16 proxy migration, lint remediation, and release regression coverage
  across `src/`, `scripts/`, and `tests/`.
- Handoff: `docs/IMPLEMENTATION_STATUS.md`.

## Remaining Work
- Phase 12 — Deployment
- Phase 13 — External integration testing
- Phase 14 — OpenAPI + integration documentation
- Phase 15 — Complete regression testing
- Phase 16 — Final CodeGraph audit

## Next Phase
Phase 12 — Production deployment. Only after explicit approval, run typecheck,
lint, tests, Prisma generation, and the production build; deploy through the
approved GitHub to Vercel/Docker target; verify `/api/v1/health`, frontend,
login, dashboard, tickets, API, database, and authentication; update this
handoff and stop.

## Instructions for Next Agent
Read this file and the master prompt first. Phase 12 release preparation is
complete but live deployment is not. Continue only after the owner explicitly
authorizes publication to `github.com/dhwajdhruvkar/helpdesk-ai`, authorizes
sensitive upload to `dhwaj-s-projects/netlink-support`, and supplies the missing
Entra/Azure values. Complete only Phase 12, update this handoff, report, and
STOP.

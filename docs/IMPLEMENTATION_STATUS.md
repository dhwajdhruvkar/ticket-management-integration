# Implementation Status

## Project Objective
Safely evolve the existing Netlink Support application from its current local/memory persistence to production PostgreSQL while preserving all existing functionality and adding external API-key integration support for a third-party Support Management System.

## Current Phase
Phase 16 — Final CodeGraph audit **COMPLETE (2026-08-24)**

The verified release is live at https://netlink-support.vercel.app from GitHub
`main`; Phase 14 API code was finalized in commit `3a6b602`, and the approved
post-phase functional public-demo authentication adjustment is commit
`559c345`.
The final CodeGraph architecture/security audit is complete. Confirmed defects
in invalid-key route validation, impersonation boundaries, static import
cycles, and dead code were remediated. The complete test/static/database/build
gate set passes on the final candidate.

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
- Phase 12 — Production deployment (released and live-verified)
- Phase 13 — External integration testing (production end-to-end verified)
- Phase 14 — OpenAPI and integration documentation (released and verified)
- Phase 15 — Complete regression testing (29 files, 217/217 tests verified)
- Phase 16 — Final CodeGraph audit (completed and remediated)

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

## Phase 12 Production Deployment — COMPLETE (2026-08-24)

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
- Replaced the deprecated `vite-tsconfig-paths` test plugin with Vite's native
  `resolve.tsconfigPaths` support.
- Migrated the deprecated `src/middleware.ts` convention to the supported
  Next.js 16 `src/proxy.ts` convention. Authentication and API gateway behavior
  are unchanged and now build without Edge/Jose compatibility warnings.
- Added `vercel.json` to select the Next.js framework preset explicitly.
- Added a Vercel build gate that runs the production environment validator
  before `next build`, matching the existing fail-closed Docker startup gate.
- Explicitly selected `npm run vercel-build` in `vercel.json`, so the
  hosted build cannot bypass the production environment preflight.
- Remediated the open Next.js 16.3 standalone/adapter incompatibility by using
  managed output on Vercel while retaining standalone output for Docker. The
  initial hosted build reproduced the missing `next-server.js.nft.json` error;
  the conditional output fix passed locally and in Vercel's build adapter.
- Made Microsoft Entra ID and Azure Blob explicit optional production
  capabilities. With Entra absent, browser sign-in is disabled and API-key
  authentication remains active. With Azure absent, attachment reads/writes/
  deletes return HTTP 503 and production never falls back to ephemeral disk.
- Added non-sensitive authentication/storage mode reporting to the health
  endpoint, documented 503 attachment responses in OpenAPI, and added focused
  coverage for disabled, complete, and malformed optional-provider profiles.
- Migrated Prisma seed configuration from the deprecated `package.json` field
  to `prisma.config.ts`; clean install, generate, validate, and migration-status
  commands load it without the prior deprecation warning.
- Added lint and production dependency audit jobs to GitHub CI.
- Connected the Vercel project `dhwaj-s-projects/netlink-support` to
  `https://github.com/dhwajdhruvkar/ticket-management-integration`. Production
  now builds from the repository's `main` branch.
- Aligned the Vercel project itself to the tested Node.js 22.x runtime and the
  explicit Next.js framework preset.
- Published the verified runtime application code at commit `b5e07a7` to both
  `phase12-api-only-production` and `main` in
  `dhwajdhruvkar/ticket-management-integration`; subsequent handoff-only
  commits do not change that runtime code. No populated environment file or
  credential is tracked.

### Verification

- Node.js 22.14.0 satisfies Next.js 16's Node.js 20.9+ requirement.
- Prisma Client 6.19.3 generation passed against the checked-in schema.
- TypeScript passed.
- ESLint passed with zero warnings.
- Full test suite passed: 26 files, 201/201 tests.
- After optional-provider hardening, the full suite passed again: 26 files,
  202/202 tests.
- The optimized Next.js 16.3.2 Turbopack production build passed and emitted
  every expected page/API route, including `/api/v1/health`, without warnings.
- The Vercel build path rejects an incomplete environment before compilation;
  its success path passed validation and a full build with synthetic core
  values and no Entra/Azure values. It reported
  `authentication=api-key-only, attachments=disabled`.
- `npm audit --omit=dev` reports 0 vulnerabilities.
- Initial release deployment `dpl_AoasyRwyK2yFx9SxnFehyEqJpGS2` reached Ready from
  GitHub `main` commit `b5e07a7`. Hosted logs show the preflight, Prisma
  generation, TypeScript, Next.js build, Vercel adapter, and output deployment
  all completed successfully.

### Production deployment and live verification

- The owner explicitly authorized sensitive upload of the pooled Neon
  `DATABASE_URL` and a newly generated `AUTH_SECRET`. Both were sent to the
  linked Vercel Production secret store without being printed or written to a
  tracked file. `DIRECT_URL` was not uploaded.
- Vercel Production contains exactly the four core variables:
  `DATA_DRIVER=prisma`, `DEMO_MODE=false`, sensitive `DATABASE_URL`, and
  sensitive `AUTH_SECRET`. Entra and Azure variables remain absent by design.
- The canonical release is live at `https://netlink-support.vercel.app`. The
  health endpoint returned HTTP 200 with `dataDriver=prisma`,
  `authentication=api-key-only`, `attachmentStorage=disabled`, PostgreSQL
  enabled, and attachments disabled.
- Unauthenticated `GET /api/v1/tickets` returned 401. `GET /tickets`
  redirected to the sign-in page, which returned 200 and displayed the
  intentional API-only notice. Auth.js exposed zero browser providers.
- HSTS, CSP, frame protection, MIME sniffing protection, and referrer-policy
  headers were present on the live service.
- A short-lived Production API key was generated through the application
  service and never printed. It authenticated against the live Vercel runtime:
  the tickets endpoint returned HTTP 200 and 17 tenant-scoped records, and the
  protected OpenAPI endpoint returned HTTP 200 with the Netlink Support API
  specification.
- The same authenticated key exercised the attachment route, which returned
  the expected HTTP 503 while Azure is deferred. The key was revoked in a
  `finally` path; at the Phase 12 checkpoint a subsequent live request was
  denied with the then-existing presented-invalid 403 response. Phase 13
  corrected that contract to 401. Neon contains the inactive smoke-key row
  plus both `auth.key_created` and `auth.key_revoked` audit events.
- Recent Production error and warning log queries returned no records after the
  live checks.
- GitHub Actions run `32694671039` for the deployed commit created a failed
  job with zero steps. Its annotation states that the account is locked due to
  a billing issue; this is an external CI-account condition, not a release or
  Vercel failure.

### Confirmed

- Prisma is the configured driver and connects to the configured Neon database.
- Prisma validation passed and both checked-in migrations are applied.
- Every ID in `.data/store.json` exists in PostgreSQL: 0 missing IDs across all
  27 persisted entity collections. The source JSON was not changed.
- TypeScript passed, all 202 tests passed, and the production build passed.
- API keys are hashed, revocable, permission controlled, and tenant scoped.
- No `NEXT_PUBLIC_*` secrets or client imports of server modules were found.
- Production startup rejects development/demo persistence and authentication
  settings before serving traffic. Optional provider settings fail closed when
  partial or malformed; absent Azure disables attachments safely.

### Remaining external issue

1. GitHub Actions cannot start while the repository owner's billing lock is
   active. Local and Vercel release gates are green.

### Phase 12 release status

Phase 12 is COMPLETE. The GitHub-backed Vercel Production deployment is Ready,
the canonical URL is live, all local and hosted release gates pass, and the
API-only/attachments-disabled production profile has been verified against the
real Neon database.

## Phase 13 External Integration Testing — COMPLETE (2026-08-24)

### Implemented

- Reconciled the production authentication contract so missing, malformed,
  unknown, expired, and revoked API keys return HTTP 401, while a valid
  authenticated key that lacks a required permission returns HTTP 403.
- Added the explicit `ticket.create` permission to the RBAC model and applied
  permission guards consistently to ticket list/create and message reads.
- Added route-level external-integration regression coverage for the complete
  authentication matrix, ticket lifecycle, message visibility, pagination,
  and persistence boundary.
- Published Phase 13 runtime commit `171eb8a` to GitHub `main` and
  `phase13-external-integration`. Vercel deployment
  `dpl_ELBBPn1x2txAutt2RHs6EhiSwd2o` reached Ready and serves the canonical
  Production URL.

### Production end-to-end verification

- Authentication results: valid manager key 200, no key 401, invalid key 401,
  valid requester key without update permission 403, and revoked key 401.
- Operation results: create ticket 201; get, update, add message, get messages,
  list, and two-page pagination checks all returned 200.
- The created record `INC-E4EF82` (`tkt_217812346fe645daab59`) persisted through
  the Production Vercel API, Prisma driver, and Neon PostgreSQL with status
  `in_progress`; its internal external-system message was persisted and returned.
- The existing UI was opened locally against the same Neon database with the
  seeded manager identity. The ticket appeared first in dashboard live activity,
  then in the 18-row All tickets queue with the correct reference, subject,
  requester, P4 priority, Service Desk group, status, and
  `IT > External integration` classification. Its detail view displayed the
  correct conversation and internal message.
- Cleanup used the live authenticated DELETE route for only the exact test
  ticket. It returned 200 and performed the designed recoverable soft delete.
  The normal API list no longer returned the record, the database retained it
  with `deletedAt`, and the refreshed UI count dropped from 18 to 17.
- Both workflow keys and the final cleanup key were short-lived, never printed
  or written to a tracked file, and confirmed inactive after use. Creation,
  deletion, and revocation remain represented in the audit chain.
- Recent Production error and warning log queries contained no records after
  the integration run.

### Verification

- Focused Phase 13 and related authorization suites passed: 61/61 tests.
- Full test suite passed: 27 files, 207/207 tests.
- TypeScript passed.
- ESLint passed with zero warnings.
- Prisma schema validation and the optimized Next.js 16.3.2 Production build
  passed; no package, schema, migration, or seed change was required.
- CodeGraph traced the external request through route guards, RBAC, ticket
  services, Prisma persistence, and the existing ticket UI consumers.
- Microsoft Entra ID remains intentionally unconfigured, so Production browser
  login is still disabled. The UI leg was therefore verified in the controlled
  local demo-auth application connected to the same Production Neon data; the
  hosted M2M API leg used the real Production URL throughout.

## Phase 14 OpenAPI and Integration Documentation — COMPLETE (2026-08-24)

### Implemented

- Replaced the partial API description with an OpenAPI 3.1 contract versioned
  `2.0.0`, using the canonical Production base URL plus a relative current-
  origin server for controlled local use.
- Documented bearer and `x-api-key` authentication, the same-origin session
  alternative, endpoint-level RBAC requirements, tickets, ticket messages,
  pagination and sorting, health, API-key administration, standard envelopes,
  error responses, and relevant 400/401/403/404/413/429 outcomes.
- Documented message retrieval accurately through `GET /tickets/{id}` because
  the API has no separate message-list endpoint.
- Added reusable schemas for tickets, messages, page metadata, API keys,
  creation/update inputs, envelopes, health, and errors. The API-key creation
  response marks the one-time full secret as read-only.
- Protected `GET /api/v1/openapi.json` with the shared `ticket.read` permission
  guard. Missing, malformed, unknown, expired, and revoked keys return 401;
  valid authenticated identities without the permission return 403.
- Moved API-key list/create/revoke routes onto the shared `admin` guard so they
  preserve the same 401-versus-403 contract as the rest of the external API.
- Added `docs/EXTERNAL_API_GUIDE.md` with the Production base URL, safe API-key
  bootstrap/setup, permissions, complete curl and JavaScript ticket workflows,
  pagination, error handling, rate limits, CORS/origin guidance, health, and
  OpenAPI download instructions. All examples use placeholders, never secrets.
- Linked the external developer guide from the README and added focused
  contract tests that also scan the new documentation for secret-shaped data.

### Verification

- Focused Phase 14/API-key/external-integration tests passed: 3 files, 16/16
  tests.
- TypeScript passed. ESLint passed with zero warnings.
- The optimized Next.js 16.3.2 Production build passed; the protected OpenAPI
  route is emitted dynamically.
- Local route checks confirmed the contract is served to an authorized demo
  actor and that a fake presented key receives 401 from both the OpenAPI and
  API-key administration routes.
- Production runtime commit `3a6b602` was pushed to both
  `phase14-openapi-documentation` and GitHub `main`. Vercel deployment
  `dpl_FYy3NrqBewYmnn78FgYfWTv7CjUi` reached Ready and serves the canonical
  URL. Live checks returned health 200, unauthenticated OpenAPI 401, fake-key
  OpenAPI 401, and fake-key API-key administration 401.
- Recent Production error and warning log queries returned no records.
- CodeGraph was used before and after the change to trace the documented auth,
  permission, ticket, message, pagination, and API-key paths.
- Diff whitespace checks and a Phase 14 artifact scan passed; no real secret,
  package, schema, migration, seed, database write, or cleanup was introduced.
- The full 27-file/207-test suite was intentionally not repeated because the
  master plan reserves complete regression testing for approval-gated Phase 15.
  Phase 13 remains the most recent completed full-suite baseline.

### Production integration notes

- At the Phase 14 checkpoint Production was API-key-only while Microsoft Entra
  ID was deferred. The approved post-phase adjustment now adds public-demo
  browser sessions; external integrations remain API-key based, and attachment
  operations remain disabled until Azure Blob is configured.
- Browser-direct cross-origin integration is not supported. External systems
  should call the API backend-to-backend over HTTPS without an `Origin` header.
- Rate limiting is currently per process/edge isolate: 200 requests/minute/IP
  at the API gateway, 60 ticket creates/minute/IP, and 10 API-key creates/
  minute/IP. Responses do not currently include `Retry-After` or quota headers.
- Vercel Preview builds remain unavailable because core credentials exist only
  in the approved Production environment; the GitHub `main` Production build
  is Ready. GitHub Actions remains blocked by the repository owner's billing
  lock.

## Post-Phase 14 Functional Public Demo Authentication — COMPLETE (2026-08-24)

- The owner explicitly approved the documented risk of functional public
  passwordless demo identities. Added the non-secret
  `PUBLIC_DEMO_AUTH=true` Production setting while retaining
  `DEMO_MODE=false`.
- Registered the Auth.js credentials provider only when local demo mode or the
  explicit public-demo flag is enabled. Production accepts exactly the six
  identities displayed on `/signin`; every other database email is rejected.
- Centralized the six-email allowlist for the browser and server, normalized
  email casing, required active users, and additionally required every
  Production public-demo user to belong to the internal tenant.
- Kept `x-actor`, `x-tenant`, anonymous API fallbacks, unsigned webhooks,
  and all other demo-mode conveniences disabled. Unauthenticated `/api/v1`
  requests still return 401.
- Added a 30-attempt/minute/IP edge limit to the public credentials callback.
  Existing API gateway, ticket-create, and API-key-create limits are unchanged.
- Updated the health/OpenAPI authentication profile to `public-demo`, updated
  the Production environment contract, README, and external API guide, and
  retained Entra as the mutually exclusive future private SSO option.
- Focused public-demo/environment/OpenAPI/security/gateway tests passed: 5
  files, 51/51 tests. TypeScript, zero-warning lint, the optimized Next.js
  Production build, diff checks, and CodeGraph verification passed.
- Local end-to-end Auth.js verification authenticated
  `dana.lee@netlink.com` as a tenant-bound requester and rejected the seeded
  but non-allowlisted `admin@netlink.com` identity.
- Live Production reports `authentication=public-demo`, exposes only the demo
  credentials provider, and has no Entra provider. The same allowlisted login
  succeeded live, the non-allowlisted login was denied, the sign-in page
  displayed six functional cards, health returned 200, and unauthenticated API
  access remained 401.
- The deliberate invalid-credential test produced the expected Auth.js
  `CredentialsSignin` error log; no unexpected error or warning was observed.
  Successful verification sign-ins produced normal tamper-evident
  `auth.signin` audit events.
- Runtime commit `559c345` was pushed to
  `functional-public-demo-auth` and GitHub `main`. Vercel deployment
  `dpl_6DPTFaBkseJKxJxjNfyQBUXTS4Dd` reached Ready at the canonical URL.
- No package, schema, migration, seed, user record, role, ticket, credential, or
  secret was changed. The only database writes were the expected sign-in audit
  events.

## Phase 15 Complete Regression Test — COMPLETE (2026-08-24)

- Ran the repository's complete existing Vitest suite through the actual
  `npm test` package script: 29/29 files and 217/217 tests passed.
- The passing suite covers API keys, authentication and RBAC, assignment and
  triage, priority, SLA and pause behavior, automation, tamper-evident audit,
  webhook security, email ingestion/sending/threading, AI and embeddings,
  PrismaStore query construction, Production migration verification, REST API
  behavior, pagination, CORS/origin controls, tenant isolation, attachments,
  security hardening, public-demo sign-in, and the OpenAPI contract.
- `npm run typecheck` passed, and `npm run lint` passed with zero warnings.
- `npx prisma validate` passed. The read-only Neon migration check found 2/2
  migrations applied and reported the Production database schema up to date.
- `npm run build` passed on Next.js 16.3.2 and emitted the complete dynamic UI,
  Auth.js, REST API, and webhook route surface.
- Production environment and security rejection paths passed in their focused
  automated coverage. The standalone preflight correctly rejects the local
  development `.env`; it is intentionally validated with injected Production
  variables by Vercel's `vercel-build` script during deployment.
- No test was removed, skipped, or weakened. No genuine regression was found,
  so no application, test, schema, migration, seed, package, credential, or
  Production data change was required in Phase 15.

## Phase 16 Final CodeGraph Audit — COMPLETE (2026-08-24)

### Architecture verification

- Synced the repository-owned CodeGraph index to the final tree: 223 indexed
  files, 3,028 nodes, 10,015 edges, and an up-to-date status.
- Verified the browser path from client API helpers through `/api/v1`, the
  proxy, shared permission/context guards, tenant-scoped services, the
  `DataStore` port, `PrismaStore`, Prisma Client, and Neon PostgreSQL.
- Verified the external path from API-key presentation through edge credential
  presence, SHA-256/timing-safe key verification, actor and tenant context,
  RBAC, record-level scoping, services, the datastore port, and PostgreSQL.
  Invalid, expired, and revoked keys remain inert and cross-tenant record IDs
  resolve as not found.
- Confirmed all 55 protected `/api/v1` route files contain an authentication or
  request-context boundary. `/api/v1/health` is the sole intentional public
  route; Auth.js and signed webhook routes keep their separate boundaries.
- Confirmed Prisma Client construction exists only in `PrismaStore`; migrations
  and seed tooling are the intentional non-runtime exceptions. Client modules
  have no runtime imports from server modules; shared domain imports are type
  only.

### Findings remediated

- Added shared permission validation to catalog, events, intake, profile, and
  notification routes. A syntactically shaped but invalid API key can no longer
  reach context-only route behavior; all five now return the standard 401.
- Hardened `x-impersonate`: machine API keys cannot impersonate, the target must
  be active and belong to the actor's tenant, and the target role cannot exceed
  the authenticated actor's role. Lower-role same-tenant support impersonation
  remains available.
- Removed both true static import cycles by extracting the attachment storage
  port into `blobPort.ts` and the shell context into `ShellContext.tsx`.
  Intentional lazy notification-provider imports are dynamic seams, not static
  module cycles.
- Removed the unreferenced `src/components/Icon.tsx` component after CodeGraph
  and a TypeScript import-graph scan confirmed it was not a framework or dynamic
  entry.

### Integrity and safety checks

- An independent TypeScript import-graph audit covered 180 source files and
  found zero static import cycles, unresolved local imports, client-to-server
  runtime imports, or unexplained zero-incoming production files.
- Pattern review found no active `localStorage` or `sessionStorage` persistence.
  `store.json`, `DATA_DRIVER`, and `MemoryStore` remain only in the intentional
  local/demo/test/migration paths.
- Retained `MemoryStore` deliberately: it provides zero-infrastructure local
  demos, deterministic tests, and source-data migration compatibility behind
  the same `DataStore` port. Production startup requires `DATA_DRIVER=prisma`
  plus the pooled Neon URL, so it cannot silently select memory persistence.
- A redacted scan of 220 tracked non-test production files found no hardcoded
  API key, private key, provider token, live database URL, or literal secret.
  `.env*` files remain ignored; only sanitized examples are tracked.
- `npm ls --depth=0` resolved the declared dependency tree, and the complete
  `npm audit` reported zero vulnerabilities. No package was changed.
- Final gates passed: 29/29 Vitest files and 219/219 tests, TypeScript, lint with
  zero warnings, Prisma validation, Neon migration status (2/2 applied), and
  the optimized Next.js 16.3.2 Production build.
- No schema, migration, seed, package, credential, or Production data change
  was made. The Neon check was read-only.
- Runtime commit `266616e` was pushed to the Phase 16 branch and GitHub `main`.
  Vercel deployment `dpl_9yhhkUq6v5McAJ76QyhPAnHpQMbW` reached Ready after
  cloning that exact commit and passing the Production environment preflight
  (`authentication=public-demo`, `attachments=disabled`).
- Live checks on `https://netlink-support.vercel.app` confirmed health 200 with
  Prisma/PostgreSQL active, the demo authentication provider, sign-in 200,
  unauthenticated tickets 401, and invalid-key 401 responses from catalog,
  events, intake, profile, and notifications.

## Current Architecture
Next.js 16 App Router, React 19 SPA frontend, fully versioned REST API (`/api/v1/*`), NextAuth for UI authentication, API-key authentication (`nlk_*`) for M2M, Hexagonal DataStore abstraction.
**Data driver: `DATA_DRIVER=prisma` backed by Neon PostgreSQL (cloud).**
**API is fully externally consumable and production-validated end to end via M2M workflows.**
**Production: https://netlink-support.vercel.app (Vercel, GitHub main).**

## API Key / External Integration Status
- **Authentication**: M2M authentication successfully resolves via `Authorization: Bearer nlk_...` header.
- **RBAC Identity Mapping**: API keys act with their assigned role (`agent`, `requester`, etc.) rather than a specific user, enabling robust integration boundaries.
- **Intake Webhook (`/api/v1/intake`)**: External monitoring tools can file P1 incidents. Successfully mapped a critical `alert` payload to `impact: high` / `urgency: high` and linked it directly to a CMDB CI (`PROD-01 App Server`).
- **REST Surface**: General endpoints (e.g. `GET /api/v1/tickets`, `POST /api/v1/tickets`) successfully authorize via API key and return correct datasets constrained by the key's tenant.
- **Published contract**: The protected OpenAPI 3.1 document at
  `/api/v1/openapi.json` and `docs/EXTERNAL_API_GUIDE.md` describe the verified
  Production integration surface, permissions, examples, and limitations.
- **Live verification**: Production passed the complete 200/401/403
  authentication matrix plus create/get/update/message/list/pagination. The
  created ticket persisted to Neon, appeared in the existing UI, and was then
  recoverably soft-deleted; all temporary keys are inactive.
- **Standard Envelope**: All API endpoints use the `ok(data)` / `fail(error)` uniform envelope from `src/server/http.ts`, assuring the third-party Support Management System of consistent shape.
- **Origin policy**: The supported third-party integration is backend-to-backend and uses no browser CORS policy. API-key requests work without an Origin header; same-origin UI requests continue to use their session.
- **Production security**: Startup refuses demo mode or a weak Auth.js secret; request bodies are stream-bounded and operational logs redact credential-shaped data.
- **Attachments**: API-key clients can upload, list, download, and delete ticket attachments through tenant-scoped routes when private Azure Blob storage is configured. Until then, binary operations return 503 and never use Vercel's ephemeral disk; multipart bodies and individual files are bounded.

## API-Key Integration Completion Audit ? COMPLETE (2026-08-24)

- Re-traced the current key lifecycle through Settings, the `/api/v1/api-keys`
  handlers, shared guards, cryptographic key service, `DataStore`,
  `PrismaStore`, and PostgreSQL. Tenant administrators and super administrators
  can create/revoke keys; lower roles cannot manage credentials.
- Confirmed secrets use 32 cryptographically random bytes with the `nlk_`
  prefix. The full value is returned once, only its unique SHA-256 hash is
  persisted, list responses omit both the hash and secret, verification uses a
  timing-safe comparison, and expired/revoked keys are rejected.
- Added `tests/apiKeyRoutes.test.ts`, which invokes the real route handlers and
  proves administrator-only creation, one-time secret redaction, API-key
  bootstrapping, least-privileged agent keys, ticket creation through the
  external API, revocation, and immediate HTTP 401 rejection after revocation.
- Focused API-key/external-integration verification passed 3 files and 20/20
  tests. The complete suite passed 30 files and 225/225 tests; TypeScript, lint,
  and the optimized Next.js 16.3.2 build also passed.
- CodeGraph is current at 224 indexed files, 3,041 nodes, and 10,063 edges.
- Verification commit `15f6195` was pushed to the audit branch and GitHub
  `main`. Vercel deployment `dpl_5TFB7rVMwHpqY8xLggMScAn862HT` built that exact
  commit, passed the Production environment preflight, and reached Ready.
- Non-mutating live checks confirmed health HTTP 200 with Prisma/PostgreSQL,
  sign-in HTTP 200, and HTTP 401 for unauthenticated key listing plus invalid
  key attempts against key creation, OpenAPI, and tickets. The prior Phase 13
  Production create/use/revoke proof remains recorded above; this audit did not
  create another live credential or ticket.

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
- Focused Phase 13 external-integration and related authorization tests: 61/61
  passed.
- Focused Phase 14 OpenAPI/API-key/external-integration tests: 3 files, 16/16
  passed.
- Focused Production sign-in/environment tests: 2 files, 18/18 passed.
- Focused functional public-demo/security tests: 5 files, 51/51 passed.
- Complete Phase 15 regression suite: 29 files, 217/217 passed.
- Final Phase 16 regression suite: 29 files, 219/219 passed.
- API-key integration completion suite: 30 files, 225/225 passed.
- Prisma validation: passed.
- Migration status: 2/2 applied; database schema is up to date.
- JSON source-ID preservation: passed; 275 checked, 0 missing.
- Production build: passed on Next.js 16.3.2 without warnings.
- Lint: passed with zero warnings.
- Production dependency audit: 0 vulnerabilities.
- Hosted Vercel build: passed for current runtime application commit
  `559c345`.
- Live Production API/database/UI external-integration workflow: passed.
- Live Phase 14 health and protected-route authentication checks: passed.

## Known Issues
- `admin@netlink.com` resolves as `agent` role, not `tenant_admin` (design-correct, not a bug)
- Groq LLM model `llama-3.3-70b-versatile` deprecated/removed — AI falls back to offline template (pre-existing, not a regression)
- Browser dashboard login is intentionally public and passwordless for the six
  approved demo identities. This is an owner-approved showcase risk; disable
  `PUBLIC_DEMO_AUTH` before configuring Entra for private organisational SSO.
  Azure remains deferred, so attachments are still disabled.
- GitHub Actions jobs are blocked by an account billing lock.
- Vercel Preview builds lack the Production-only core secrets and fail the
  intentional environment preflight; GitHub `main` Production is Ready.

## Files Changed in Latest Phase
- Authentication/context hardening: `src/server/context.ts`.
- Shared key validation on formerly context-only routes:
  `src/app/api/v1/catalog/route.ts`, `src/app/api/v1/events/route.ts`,
  `src/app/api/v1/intake/route.ts`, `src/app/api/v1/me/route.ts`, and
  `src/app/api/v1/notifications/route.ts`.
- Attachment storage cycle removal: new `src/server/storage/blobPort.ts`, plus
  `src/server/storage/blobStore.ts` and `src/server/storage/azureBlob.ts`.
- Shell cycle removal: new `src/components/ShellContext.tsx`, plus
  `src/components/AppShell.tsx` and `src/components/TopBar.tsx`.
- Dead code removed: `src/components/Icon.tsx`.
- Focused regression coverage: `tests/externalIntegration.test.ts`.
- Final authoritative handoff: `docs/IMPLEMENTATION_STATUS.md`.

## Post-Phase 14 Adjustment Files
- Auth configuration and provider: `src/server/config.ts`, `src/auth.ts`,
  `src/proxy.ts`, and `src/shared/publicDemoUsers.ts`.
- Sign-in UI: `src/app/signin/page.tsx` and
  `src/app/signin/SignInClient.tsx`.
- Production contract/docs: `scripts/check-production-environment.cjs`,
  `.env.production.example`, `.env.example`, `README.md`,
  `docs/EXTERNAL_API_GUIDE.md`, and the OpenAPI route.
- Focused coverage: `tests/signin.test.ts`,
  `tests/productionEnvironment.test.ts`, and `tests/openapi.test.ts`.

## API-Key Integration Completion Files
- Route-level create/list/use/revoke coverage: `tests/apiKeyRoutes.test.ts`.
- Final evidence and handoff: `docs/IMPLEMENTATION_STATUS.md`.

## Remaining Work
- No implementation phases remain.
- Optional future operations remain explicitly deferred: Microsoft Entra SSO,
  Azure Blob attachments, GitHub billing recovery, and Vercel Preview secrets.

## Next Phase
None. The approved Phase 0–16 implementation plan is complete.

## Instructions for Next Agent
Read this file first. All approved phases are complete; do not rerun migrations,
repeat integration writes, restore the soft-deleted Phase 13 test ticket,
rotate secrets, expose credentials, or restart a completed phase. Treat any
future request as new, explicitly scoped maintenance or feature work. Preserve
the Production Prisma/API-key/RBAC/tenant boundaries documented above.

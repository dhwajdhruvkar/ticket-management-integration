# Tenant service-desk workflow — approved implementation plan

Approved in chat on 2026-09-30. Build against main; preserve the primary checkout's unrelated changes.

## Contract

Organization-isolated flow: creation → service-desk review → department bucket → acceptance → resolution → requester confirmation or seven-day no-response closure. New workflow is opt-in after configuration; legacy tickets keep their assignments. AI classifies and drafts but cannot bypass mandatory human review.

## Ordered slices

1. `ticket-intake`: searchable tenant requester picker with free email entry; automatic priority preview and audited staff override.
2. `bucket-workflow`: configured service-desk/department groups, manager and senior RM; atomic review, routing, offer/accept/pickup/decline/release and central mutation guards.
3. `availability-suggestions`: working hours, capacity (default 5), timed overrides, optional tenant-mapped Teams presence with labelled fallback; same-tenant similar-resolution suggestions.
4. `sla-monitoring`: per-priority review/pickup and manager deadlines (5/15/30/60/120 minutes each), 80% warning, manager then RM escalation; durable authenticated minute sweeps, retry deduplication and dashboard alerts.
5. `notifications-acknowledgement`: transactional delivery queue, Brevo adapter, public lifecycle emails, single-use scoped acknowledgement, day-three reminder and truthful day-seven auto-close.
6. `performance-reporting`: weekly/monthly/yearly/custom periods, configured timezone, resolver-based attribution, live backlog separated from historical metrics.

## Safety and rollout

All input and external provider responses are untrusted. Tenant/role checks occur server-side; concurrent pickup has one winner. No secrets, other tenants' data, internal notes or raw acknowledgement tokens in public responses or ordinary logs. Additive schema only, memory/Prisma parity; migrate and smoke-test on an isolated Neon branch before production. Missing Teams/email/scheduler configuration must be visible, never claimed operational. User has authorized relevant commits and push to main after verification; check the exact commit's Vercel deployment and provide a detailed change/setup/verification report.

## Verification

Focused red/green tests per slice; full Vitest, typecheck, lint, Prisma checks, security/environment checks and production build. Browser smoke at desktop/mobile; provider fallback and failures, transaction races/rollback, permission bypass attempts, calendar/date boundaries, acknowledgement replay, and monitoring with dashboards closed. No paid dependencies required; external credentials/account setup remain activation prerequisites.

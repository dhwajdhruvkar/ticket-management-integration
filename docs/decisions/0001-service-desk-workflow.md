# ADR 0001: Opt-in human workflow with durable database state

Date: 2026-09-30. Status: accepted for this release.

## Context

The portal needs review, department queues, accepted ownership, staged escalation
and external-requester confirmation without requiring a paid queue or Microsoft
credentials. Existing tenant integrations must continue working. Serverless
process timers and in-memory locks cannot guarantee background progress.

## Decision

- Enroll only new tickets from opted-in tenants; keep legacy tickets unchanged.
- Keep human transitions behind authenticated same-tenant staff authorization.
- Persist workflow state/version and perform transitions, audit and email enqueue
  in a serializable transaction. Compare-and-set protects competing acceptance.
- Use an authenticated minute endpoint with expiring database leases, a cursor
  and bounded execution. An external scheduler supplies liveness on Vercel.
- Store email jobs and confirmation hashes in PostgreSQL. Use a one-use link and
  explicit POST, never confirmation by GET. Email has at-least-once semantics.
- Reuse calendars, groups and roles. Separate offered assignment from accepted
  work; derive availability from hours/capacity with optional Teams presence.
- Record the actual resolver per event instead of inferring historical performance
  from mutable assignee fields. Keep live backlog outside date-filtered activity.

## Alternatives and consequences

Redis/BullMQ would provide a richer queue but adds infrastructure and operational
cost. Process-only timers lack reliable serverless execution. Automatic assignment
or AI resolution would violate human review and acceptance requirements.

Database transactions and row leases keep deployment small but create DB load.
Current tenant-history scans have a documented scale ceiling; index/aggregate
queries should replace them when measured volume warrants it. Provider delivery
can duplicate after an uncertain success. Disabling enrollment is safe; reverting
to an old binary after workflow adoption is not a complete feature rollback.

The [operations guide](../SERVICE_DESK_WORKFLOW.md) defines activation, migration,
retention, observability and rollback responsibilities.

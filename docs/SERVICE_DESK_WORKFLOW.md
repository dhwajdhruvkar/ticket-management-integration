# Service-desk workflow — operation and rollout

## What changed

This is an organization-level opt-in. Existing organizations default to disabled;
existing tickets stay on their legacy flow. No historical tickets, users or
settings are copied or reassigned.

1. **Manual intake:** search active requesters in your organization by name/email.
   A valid free-text email also works without creating an account. Requesters
   always file as themselves. Priority is assessed automatically from the final
   subject/body; the screen identifies AI versus the rules-based fallback.
   Staff can override with a recorded reason.
2. **Human review:** new workflow tickets enter the service-desk bucket. A staff
   reviewer claims/reviews and routes them to a department. AI can draft advice,
   but cannot resolve or skip this review.
3. **Department ownership:** an eligible agent picks up work, or a manager offers
   an assignment. An offer is not acceptance. The agent must accept before
   progressing/resolving. Decline/release requires a reason and returns work to
   the bucket. Concurrent pickup has one winner.
4. **Availability:** working-hours calendar, active accepted workload and timed
   Busy/Away determine availability. Capacity defaults to five tickets. Clearing
   an override does not bypass hours/capacity. Unconfigured hours are shown
   honestly. Optional Teams presence is cached and falls back when stale.
5. **Monitoring:** bucket warning at 80% of the pickup window; then escalation to
   the configured manager; then to the distinct senior RM after the additional
   manager window. Default windows are P1 5, P2 15, P3 30, P4 60, P5 120 minutes
   for each stage. Calendar/holiday and pending-hold time are respected. Accepted
   tickets retain their original resolution SLA and escalation path.
6. **Suggestions:** eligible agents in the same tenant/group are ranked by
   availability and prior similar resolved cases with a recorded actual resolver.
   This is advisory, not automatic assignment. No invented historical credit.
7. **Visibility:** dashboard and bucket alerts remain while the condition exists,
   with reduced-motion-safe emphasis. Review, offered, accepted, resolved and
   confirmed/unconfirmed closure states are shown separately.
8. **Email:** durable lifecycle/progress notices go to the requester and the active
   working agent. Internal notes are not emailed. Failed delivery retries with
   backoff; administrators can requeue failed deliveries from monitoring.
9. **Acknowledgement:** resolution mail contains a seven-day single-use link.
   Explicit confirm closes the ticket; reopen returns it to its queue. Opening
   the page alone changes nothing. Reminder at day three; day-seven auto-close
   explicitly says the requester did not confirm.
10. **Performance:** week/month/year or inclusive custom dates use organization
    timezone (UTC default). Actual recorded resolver receives credit at resolution
    time. Re-resolution is another event; cancelled tickets are not resolutions.
    Historical data without verified resolver events is excluded. Live backlog
    is deliberately separate from the selected dates.

## Configure an organization

1. Sign in as that organization's tenant administrator (or platform administrator
   in its tenant context). Create active staff accounts, departments and assignment
   groups using the existing administration screens.
2. Create at least one service-desk group and one department group; add staff
   members. Create distinct manager/senior-RM accounts with manager or administrator
   roles. There is no new global senior-RM role.
3. In **Settings → Service-desk workflow**, choose the service-desk group,
   department buckets and their manager/RM owners, timezone and stage windows.
   Enable and save. Cross-organization IDs and inactive owners are rejected.
4. In **Settings → Agent availability**, select a staff member, working-hours
   calendar and capacity. Staff can set their own timed Busy/Away overrides;
   administrators manage calendars/capacity and optional Teams user mappings.
5. Create a new test ticket, open **Triage**, claim review, route it, offer/pick up
   and accept. Resolve it using its ticket page. Confirm/reopen from the requester
   portal or emailed link once outbound email is configured.

Disabling the setting stops workflow enrollment for **new** tickets. Existing
workflow tickets retain their guards and must still be monitored and completed.
An occupied bucket cannot simply be removed from configuration.

## Free-service activation (separate from deploying code)

Core portal, buckets, in-app availability and rules-based priority need no new
paid service. Deploying code does not create provider accounts or send mail.

### Brevo outbound email

Create a Brevo account, verify your sender/domain, then add these production
secrets in Vercel and redeploy:

```dotenv
EMAIL_PROVIDER=brevo
BREVO_API_KEY=<provider-secret>
BREVO_SENDER=<verified-sender-email>
APP_BASE_URL=https://netlink-support.vercel.app
```

Keep the existing strong `AUTH_SECRET`; changing it invalidates sessions and
outstanding confirmation links. Never paste production secrets into source,
screenshots, issue reports or the guide. Brevo's free tier currently allows
300 emails/day; check [current limits](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans).
Each recipient, escalation and retry can consume provider quota. Outbound setup
does not configure per-organization inbound mailboxes or domain routing.

Delivery is **at least once**, with database deduplication/fenced leases and a
provider idempotency key. A provider success followed by a process failure can
still duplicate mail outside the provider's idempotency window. Do not claim
exactly-once email delivery. Pending mail remains queued when email is disabled;
review old pending notices before enabling a provider on an established tenant.

### Minute monitoring on Vercel

Vercel does not guarantee in-process timers. Configure an external scheduler:

1. Generate a separate random secret from at least 32 bytes; store as
   `CRON_SECRET` in Vercel production (not as an API integration key).
2. In cron-job.org create a job for
   `https://netlink-support.vercel.app/api/jobs/workflow` every minute.
3. Use **POST**, no body, and custom header
   `Authorization: Bearer <CRON_SECRET>`. Never put the secret in the URL.
4. Enable failure notifications, run once, and check its response and the
   dashboard's monitor health. A busy lease may return `skipped: true`; persistent
   skips beyond the two-minute lease need investigation.
5. Verify a complete scan updates `lastSuccessAt` and a controlled test ticket
   produces the intended warning/manager/RM events without duplicates.

[cron-job.org's FAQ](https://cron-job.org/en/faq/) describes minute scheduling and
request options. Its account is external; the app does not create this schedule.
Long-running local development runs this sweep every minute. Legacy digest and
mail-poll timers remain a separate mechanism; this endpoint does not replace
every legacy background job.

### Optional Microsoft Teams presence

Skip this until Microsoft credentials are available. The core workflow remains
usable with in-app availability. For each organization, supply a Graph app with
application `Presence.Read.All` consent and configure the deployment secret:

```text
TEAMS_PRESENCE_CONNECTIONS={"<organization-id>":{"tenantId":"<microsoft-tenant-uuid>","clientId":"<app-uuid>","clientSecret":"<secret>"}}
```

Map each agent's Microsoft user object ID in availability settings. No global
Microsoft credential is used as a cross-tenant fallback. Presence older than two
minutes or provider failures use in-app hours/capacity; the source is visible.
See [Graph presence permissions](https://learn.microsoft.com/en-us/graph/api/cloudcommunications-getpresencesbyuserid?view=graph-rest-1.0).

## API / Postman

Existing tenant-bound intake keys continue to work. Use `ticket_submitter` for
external intake-only access (or the already-bound requester key). Staff workflow
actions require a signed-in human session, not an integration key. An external
system cannot accept/review a ticket on an agent's behalf.

```http
POST /api/v1/tickets
Authorization: Bearer <tenant-api-key>
Content-Type: application/json

{
  "subject": "VPN connection fails",
  "body": "The finance team cannot connect to the VPN.",
  "type": "incident",
  "channel": "api",
  "priorityMode": "automatic",
  "autoResolve": false
}
```

Intake-only/requester keys file as their bound requester; staff keys must supply
`requesterEmail`. Omitting `priorityMode` preserves legacy staff-key behavior.
For opted-in organizations, `autoResolve` cannot bypass human review.

The authenticated `/api/v1/openapi.json` contract (version 2.3.0) includes requester
search, classification, workflow settings/board/alerts/actions, availability,
performance dates, public confirmation and the scheduler endpoint. Root `/api`
operations override the normal `/api/v1` server base. Never include live keys in
exported Postman collections.

## Data safety, rollout and rollback

The additive migration is
`prisma/migrations/20260930150000_service_desk_workflow/migration.sql`.
It adds optional tenant/user/ticket JSON fields, version/resolver fields, nullable
event attribution, and new lease/confirmation/delivery/rate-limit tables. It does
not rewrite existing tickets or enable organizations.

1. Create an isolated Neon branch of production. Use its **direct** URL for
   `prisma migrate deploy`, its **pooled** URL for runtime checks.
2. Validate/generate Prisma, run static checks/tests/build and
   `scripts/verify-workflow-postgres.ts` only on that disposable branch. The script
   requires `WORKFLOW_TEST_ENDPOINT` matching `DIRECT_URL` and external email off.
   It creates synthetic organizations; never run it against production.
3. Verify browser intake, review/acceptance, calendar escalation, confirmation,
   cross-tenant denial, concurrent pickup and audit consistency.
4. Apply the additive migration to production **before** deploying the new build.
   Confirm migration status; no production seed or fixture command is required.
5. Deploy, check the exact commit, health/login and tenant feature settings.
   Configure the minute job/email separately, then opt in organizations.

Rollback before any organization is enabled: redeploy the prior application and
leave the additive schema in place. Once workflow tickets exist, an old binary
does not enforce their guards: disable new intake enrollment and prefer a
roll-forward fix; do not silently downgrade active workflow organizations.
Do not drop tables/columns in production as an application rollback. A database
restore would discard newer records and needs explicit incident approval.

## Operations, limits and troubleshooting

- **Monitor stale (three minutes):** check scheduler history, correct POST URL,
  authorization secret, deployment readiness, DB connectivity and lease expiry.
  Structured `workflow.sweep.completed/failed` logs include request ID, counts and
  duration, not credentials or message bodies. Large datasets may take multiple
  bounded runs; freshness updates only when the full cursor scan completes.
- **Pending/failed mail:** verify provider, verified sender, public HTTPS base URL,
  quota and secret configuration. Failed deliveries stop after eight attempts;
  admins may use **Retry failed emails** after fixing the cause. Missing email
  configuration never counts as a successful send.
- **Confirmation invalid:** expired/reused link, a newer resolution or changed
  signing secret. Tokens are fragment-only in links, hashed in storage, and never
  persisted as raw secrets. Do not log the confirmation POST body.
- **Availability unexpectedly unavailable:** inspect work calendar/timezone,
  capacity, timed override and Teams freshness. Missing configuration is not
  evidence that someone is free. This models ticket capacity, not effort hours.
- **Suggestion missing:** confirm group membership, active staff, similar category
  and actual resolver history. Older assignee-only records are intentionally not
  treated as proof of experience.
- **Retention:** expired rate-limit metadata is removed after one day; old
  confirmation metadata and sent/suppressed delivery rows after 30 days. Each
  cleanup is bounded. Pending/failed deliveries, tickets, public/internal messages
  and audit history are not removed by this job.
- **Scale ceiling:** the current board/report loads a tenant's ticket history and
  filters it in memory; similarity compares up to 500 recent resolutions. Suitable
  for the current small desk, not an unbounded analytics warehouse. Before large
  tenant growth, measure p95 and add indexed aggregate queries/paged boards.
- **External dependencies unconfigured:** core UI works, but unattended escalation
  processing on Vercel requires the external minute trigger, outbound email needs
  a provider, and real Teams presence needs Microsoft credentials. The dashboard
  reports these separately; a successful deployment is not proof of activation.

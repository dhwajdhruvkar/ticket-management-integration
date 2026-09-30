# Service-desk implementation checkpoints

- [x] Ticket intake: requester search, automatic priority, override audit, API/UI tests.
- [x] Bucket workflow: schema/store concurrency, configuration, transitions, UI, isolation/race tests.
- [x] Availability and experience suggestions: schedules/capacity, Teams fallback, rankings, tests.
- [x] SLA monitoring: deadlines/escalations, durable jobs, alerts, restart/duplicate tests.
- [x] Notifications and acknowledgement: outbox, sender status, lifecycle emails, confirmation/reminders, tests.
- [x] Performance: timezone/date ranges, actual resolver attribution, UI and boundary tests.
- [x] Full verification and independent review; fix actionable findings.
- [x] Isolated Neon migration, rollback rehearsal and pooled-database smoke.
- [x] Production additive migration; tenant/user/ticket/audit counts unchanged.
- [ ] Compatible application rollout and exact deployment verification.
- [ ] Detailed change/setup report; verified commits pushed to main; exact Vercel deployment checked.

External activation remains separate: configure a minute scheduler and outbound
email provider before relying on unattended production escalation/email. Teams
presence is optional and currently uses the honest in-app fallback.

# Service-desk implementation checkpoints

- [ ] Ticket intake: requester search, automatic priority, override audit, API/UI tests.
- [ ] Bucket workflow: schema/store concurrency, configuration, transitions, UI, isolation/race tests.
- [ ] Availability and experience suggestions: schedules/capacity, Teams fallback, rankings, tests.
- [ ] SLA monitoring: deadlines/escalations, durable jobs, alerts, restart/duplicate tests.
- [ ] Notifications and acknowledgement: outbox, sender status, lifecycle emails, confirmation/reminders, tests.
- [ ] Performance: timezone/date ranges, actual resolver attribution, UI and boundary tests.
- [ ] Full verification and independent review; fix actionable findings.
- [ ] Isolated database migration and preview smoke; production migration and compatible rollout.
- [ ] Detailed change/setup report; verified commits pushed to main; exact Vercel deployment checked.

-- Performance indexes (additive; no data or column changes).
-- Ticket: active-ticket lists filter tenantId + deletedAt IS NULL and sort by createdAt DESC.
-- NotificationDelivery: workflow alerts count rows by tenantId + status.
--
-- Rollback (safe at any time; only removes the indexes):
--   DROP INDEX IF EXISTS "Ticket_tenantId_deletedAt_createdAt_idx";
--   DROP INDEX IF EXISTS "NotificationDelivery_tenantId_status_idx";

CREATE INDEX IF NOT EXISTS "Ticket_tenantId_deletedAt_createdAt_idx" ON "Ticket"("tenantId", "deletedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationDelivery_tenantId_status_idx" ON "NotificationDelivery"("tenantId", "status");

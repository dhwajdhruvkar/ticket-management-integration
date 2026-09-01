-- Tenant-owned rows in these tables predate their explicit Tenant relations.
-- Remove only impossible orphan rows before enforcing the ownership invariant.
DELETE FROM "Notification" AS n
WHERE NOT EXISTS (SELECT 1 FROM "Tenant" AS t WHERE t."id" = n."tenantId");

DELETE FROM "EmailMessage" AS e
WHERE NOT EXISTS (SELECT 1 FROM "Tenant" AS t WHERE t."id" = e."tenantId");

DELETE FROM "BusinessCalendar" AS c
WHERE NOT EXISTS (SELECT 1 FROM "Tenant" AS t WHERE t."id" = c."tenantId");

ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailMessage"
ADD CONSTRAINT "EmailMessage_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessCalendar"
ADD CONSTRAINT "BusinessCalendar_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

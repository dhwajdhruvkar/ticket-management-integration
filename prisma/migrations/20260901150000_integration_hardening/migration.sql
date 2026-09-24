-- Least-privilege ticket intake, idempotency, key rotation metadata, and
-- signed outbound ticket-status callbacks. Additive for zero-downtime rollout.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ticket_submitter';

ALTER TABLE "Ticket"
  ADD COLUMN "externalTicketId" TEXT,
  ADD COLUMN "idempotencyScopeHash" TEXT,
  ADD COLUMN "idempotencyRequestHash" TEXT,
  ADD COLUMN "integrationKeyId" TEXT;

CREATE UNIQUE INDEX "Ticket_idempotencyScopeHash_key"
  ON "Ticket"("idempotencyScopeHash");
CREATE INDEX "Ticket_tenantId_externalTicketId_idx"
  ON "Ticket"("tenantId", "externalTicketId");
CREATE INDEX "Ticket_integrationKeyId_idx"
  ON "Ticket"("integrationKeyId");

ALTER TABLE "ApiKey"
  ADD COLUMN "requesterId" TEXT,
  ADD COLUMN "lastTestedAt" TIMESTAMP(3),
  ADD COLUMN "lastTestStatus" TEXT,
  ADD COLUMN "rotatedAt" TIMESTAMP(3),
  ADD COLUMN "webhookUrl" TEXT,
  ADD COLUMN "webhookEvents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "webhookActive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "webhookSecretSalt" TEXT,
  ADD COLUMN "webhookLastDeliveredAt" TIMESTAMP(3),
  ADD COLUMN "webhookLastStatus" INTEGER,
  ADD COLUMN "webhookLastError" TEXT;

-- Legacy requester keys had no fixed requester identity and therefore cannot
-- safely authenticate under the hardened model. Keep their audit/history row,
-- but make the unusable credential state explicit so admins can replace it.
UPDATE "ApiKey"
SET "active" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "role" = 'requester' AND "requesterId" IS NULL;

CREATE INDEX "ApiKey_requesterId_idx" ON "ApiKey"("requesterId");

ALTER TABLE "ApiKey"
  ADD CONSTRAINT "ApiKey_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WebhookDelivery" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "apiKeyId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookDelivery_tenantId_nextAttemptAt_idx"
  ON "WebhookDelivery"("tenantId", "nextAttemptAt");
CREATE INDEX "WebhookDelivery_apiKeyId_createdAt_idx"
  ON "WebhookDelivery"("apiKeyId", "createdAt");

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

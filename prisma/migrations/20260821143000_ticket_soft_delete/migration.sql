-- Additive, idempotent soft-delete support. IF NOT EXISTS is intentional:
-- older environments may already have the column from a pre-migration
-- db push, while fresh databases still need migration history to create it.
ALTER TABLE "Ticket"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Ticket_tenantId_deletedAt_idx"
ON "Ticket"("tenantId", "deletedAt");

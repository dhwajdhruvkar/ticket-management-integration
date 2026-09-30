-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "workflowSettings" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "availabilitySettings" JSONB,
ADD COLUMN     "presenceSnapshot" JSONB;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "resolvedById" TEXT,
ADD COLUMN     "workflow" JSONB,
ADD COLUMN     "workflowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TicketEvent" ADD COLUMN     "resolverId" TEXT,
ADD COLUMN     "tenantId" TEXT;

-- CreateTable
CREATE TABLE "PublicRateLimit" (
    "id" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicRateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLease" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "cursor" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketAcknowledgement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "acknowledgementId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "leaseUntil" TIMESTAMP(3),
    "owner" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicRateLimit_resetAt_idx" ON "PublicRateLimit"("resetAt");

-- CreateIndex
CREATE UNIQUE INDEX "TicketAcknowledgement_tokenHash_key" ON "TicketAcknowledgement"("tokenHash");

-- CreateIndex
CREATE INDEX "TicketAcknowledgement_tenantId_ticketId_idx" ON "TicketAcknowledgement"("tenantId", "ticketId");

-- CreateIndex
CREATE INDEX "TicketAcknowledgement_expiresAt_idx" ON "TicketAcknowledgement"("expiresAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_tenantId_createdAt_idx" ON "NotificationDelivery"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketEvent_tenantId_type_createdAt_idx" ON "TicketEvent"("tenantId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "TicketAcknowledgement" ADD CONSTRAINT "TicketAcknowledgement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAcknowledgement" ADD CONSTRAINT "TicketAcknowledgement_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

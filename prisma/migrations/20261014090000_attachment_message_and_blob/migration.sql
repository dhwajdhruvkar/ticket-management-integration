-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN "messageId" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");

-- CreateTable
CREATE TABLE "AttachmentBlob" (
    "id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttachmentBlob_pkey" PRIMARY KEY ("id")
);

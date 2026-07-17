// =============================================================================
// Ticket attachments.
//
// Validates (size cap, MIME allow-list, filename sanitation), stores binaries
// through the BlobStore port, and records AttachmentRow metadata. Downloads
// always set Content-Disposition: attachment upstream, so even HTML/SVG can't
// execute in the app origin. Virus scanning hook: scanAttachment() is the
// single seam where an ICAP/ClamAV call belongs — documented no-op today.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { config } from "../config";
import { getStore } from "../data";
import { newId, now } from "../domain/ids";
import { getBlobStore } from "../storage/blobStore";
import { recordEvent } from "./ticketService";
import type { AttachmentRow } from "../domain/models";

/** Allowed upload types: documents, images, archives, text/logs, email. */
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/zip",
  "application/x-zip-compressed",
  "message/rfc822",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/octet-stream", // catch-all for email-extracted files; extension still checked
]);

const BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "jar", "msi", "sh", "apk",
]);

export class AttachmentError extends Error {}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^\w.\- ()\[\]]+/g, "_").slice(0, 140);
  return cleaned || "file";
}

function validate(fileName: string, mimeType: string, sizeBytes: number): void {
  if (sizeBytes <= 0) throw new AttachmentError("Empty file.");
  if (sizeBytes > config.attachmentMaxBytes) {
    throw new AttachmentError(
      `File exceeds the ${(config.attachmentMaxBytes / (1024 * 1024)).toFixed(0)} MB limit.`
    );
  }
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (BLOCKED_EXTENSIONS.has(ext)) throw new AttachmentError(`.${ext} files are not allowed.`);
  if (!ALLOWED_MIME.has(mimeType.toLowerCase())) {
    throw new AttachmentError(`File type "${mimeType}" is not allowed.`);
  }
}

/**
 * Virus-scanning seam. Wire ClamAV/Defender/ICAP here; throwing rejects the
 * upload. Intentionally a no-op in the default deployment.
 */
async function scanAttachment(_fileName: string, _bytes: Buffer): Promise<void> {
  return;
}

export async function saveAttachment(
  ticketId: string,
  input: { fileName: string; mimeType: string; bytes: Buffer },
  actor = "system"
): Promise<AttachmentRow> {
  const store = await getStore();
  const ticket = await store.tickets.get(ticketId);
  if (!ticket) throw new AttachmentError("Ticket not found.");

  const fileName = sanitizeFileName(input.fileName);
  const mimeType = input.mimeType.toLowerCase() || "application/octet-stream";
  validate(fileName, mimeType, input.bytes.length);
  await scanAttachment(fileName, input.bytes);

  const id = newId("att");
  const blobUrl = await getBlobStore().put(id, input.bytes);

  const record: AttachmentRow = {
    id,
    ticketId,
    fileName,
    mimeType,
    sizeBytes: input.bytes.length,
    blobUrl,
    createdAt: now(),
  };
  await store.attachments.create(record);
  await recordEvent(ticketId, "agent_action", `Attachment "${fileName}" added by ${actor}.`);
  await appendAudit({
    tenantId: ticket.tenantId,
    actor,
    action: "ticket.attachment.added",
    ticketId,
    payload: { fileName, mimeType, sizeBytes: record.sizeBytes },
  });
  return record;
}

export async function listAttachments(ticketId: string): Promise<AttachmentRow[]> {
  const store = await getStore();
  return (await store.attachments.list({ ticketId })).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
}

export async function readAttachment(
  id: string
): Promise<{ record: AttachmentRow; bytes: Buffer } | null> {
  const store = await getStore();
  const record = await store.attachments.get(id);
  if (!record) return null;
  const bytes = await getBlobStore().get(id);
  if (!bytes) return null;
  return { record, bytes };
}

export async function deleteAttachment(id: string, actor = "system"): Promise<boolean> {
  const store = await getStore();
  const record = await store.attachments.get(id);
  if (!record) return false;
  const ticket = await store.tickets.get(record.ticketId);
  await getBlobStore().delete(id);
  await store.attachments.remove(id);
  if (ticket) {
    await appendAudit({
      tenantId: ticket.tenantId,
      actor,
      action: "ticket.attachment.removed",
      ticketId: ticket.id,
      payload: { fileName: record.fileName },
    });
  }
  return true;
}

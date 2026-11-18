// =============================================================================
// Ticket attachments.
//
// Validates (size cap, MIME allow-list, filename sanitation), stores binaries
// through the BlobStore port, and records AttachmentRow metadata. Downloads
// always set Content-Disposition: attachment upstream, so even HTML/SVG can't
// execute in the app origin. Virus scanning hook: scanAttachment() is the
// single seam where an ICAP/ClamAV call belongs — documented no-op today.
// =============================================================================

import { createHash } from "node:crypto";
import { appendAudit } from "../audit/auditChain";
import { config } from "../config";
import { getStore } from "../data";
import { pageCollection, type ListOptions, type PageResult } from "../data/store";
import { newId, now } from "../domain/ids";
import { logger } from "../observability/logger";
import {
  BlobStorageUnavailableError,
  getBlobStore,
  type BlobStore,
} from "../storage/blobStore";
import { getTicket, recordEvent } from "./ticketService";
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
  "image/heic",
  "image/bmp",
  "video/mp4",
  "application/vnd.ms-outlook",
  "application/octet-stream", // catch-all for email-extracted files; extension still checked
]);

const BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "jar", "msi", "sh", "apk",
]);

export class AttachmentError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "AttachmentError";
  }
}

export interface AttachmentInput {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

export interface AttachmentDependencies {
  /** Test seam; production always resolves the configured BlobStore. */
  blobStore?: BlobStore;
}

function resolveBlobStore(dependencies: AttachmentDependencies): BlobStore {
  if (dependencies.blobStore) return dependencies.blobStore;
  if (!config.features.attachments) {
    throw new AttachmentError(
      "Attachment storage is not enabled for this deployment.",
      503
    );
  }
  try {
    return getBlobStore();
  } catch (error) {
    if (error instanceof BlobStorageUnavailableError) {
      throw new AttachmentError(error.message, 503);
    }
    throw error;
  }
}

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
async function scanAttachment(fileName: string, bytes: Buffer): Promise<void> {
  void fileName;
  void bytes;
  return;
}

export type SniffedImageType = "png" | "jpeg" | "gif" | "webp" | "bmp" | "heic";

/** Identifies an image by its leading bytes (never by name or declared type). Returns null for anything else. */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  const at = (offset: number, ...values: number[]) => values.every((v, i) => bytes[offset + i] === v);
  const text = (offset: number, value: string) => [...value].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "gif";
  if (text(0, "RIFF") && text(8, "WEBP")) return "webp";
  if (at(0, 0x42, 0x4d)) return "bmp";
  if (text(4, "ftyp") && (text(8, "heic") || text(8, "heix") || text(8, "mif1"))) return "heic";
  return null;
}

const MIME_FAMILY: Record<string, SniffedImageType> = {
  "image/png": "png", "image/jpeg": "jpeg", "image/jpg": "jpeg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp", "image/heic": "heic", "image/heif": "heic",
};
const EXT_FAMILY: Record<string, SniffedImageType> = { png: "png", jpg: "jpeg", jpeg: "jpeg", gif: "gif", webp: "webp", bmp: "bmp", heic: "heic" };

/** An image (by declared type or extension) must really be that kind of image. Non-images are untouched. */
function verifyImageContent(fileName: string, mimeType: string, bytes: Uint8Array): void {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const declaredImage = mimeType.startsWith("image/") && mimeType !== "image/svg+xml";
  const extFamily = EXT_FAMILY[ext];
  if (!declaredImage && !extFamily) return;
  const expected = declaredImage ? MIME_FAMILY[mimeType] : extFamily;
  const sniffed = sniffImageType(bytes);
  if (!sniffed || (expected && sniffed !== expected)) throw new AttachmentError("File content does not match its type.");
}

function prepareAttachment(input: AttachmentInput): AttachmentInput {
  const fileName = sanitizeFileName(input.fileName);
  const mimeType = input.mimeType.trim().toLowerCase() || "application/octet-stream";
  validate(fileName, mimeType, input.bytes.length);
  verifyImageContent(fileName, mimeType, input.bytes);
  return { fileName, mimeType, bytes: input.bytes };
}

/** Checks every file without storing anything, so callers can reject a request before posting its message. */
export function validateAttachmentFiles(inputs: AttachmentInput[]): void {
  inputs.forEach(prepareAttachment);
}

async function rollbackCreated(
  rows: AttachmentRow[],
  blobs: BlobStore
): Promise<void> {
  const store = await getStore();
  for (const row of [...rows].reverse()) {
    try {
      const metadataRemoved = await store.attachments.remove(row.id);
      if (!metadataRemoved) {
        logger.error("attachment upload rollback could not remove metadata", {
          attachmentId: row.id,
          ticketId: row.ticketId,
        });
        continue;
      }
      await blobs.delete(row.id);
    } catch (error) {
      logger.error("attachment upload rollback failed", {
        attachmentId: row.id,
        ticketId: row.ticketId,
        error,
      });
    }
  }
}

/**
 * Save one or more files as a single request-level operation. Every file is
 * validated before storage starts; a later storage/metadata failure rolls back
 * earlier files so callers never receive an unexplained partial upload.
 */
export async function saveAttachments(
  tenantId: string,
  ticketId: string,
  inputs: AttachmentInput[],
  actor = "system",
  dependencies: AttachmentDependencies = {},
  options: { messageId?: string; internal?: boolean } = {}
): Promise<AttachmentRow[]> {
  if (inputs.length === 0) return [];
  const store = await getStore();
  const ticket = await getTicket(ticketId, tenantId);
  if (!ticket) throw new AttachmentError("Ticket not found.");

  const prepared = inputs.map(prepareAttachment);
  for (const input of prepared) await scanAttachment(input.fileName, input.bytes);

  const blobs = resolveBlobStore(dependencies);
  const saved: AttachmentRow[] = [];
  try {
    for (const input of prepared) {
      const id = newId("att");
      const blobUrl = await blobs.put(id, input.bytes, { contentType: input.mimeType });

      const record: AttachmentRow = {
        id,
        ticketId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.length,
        blobUrl,
        messageId: options.messageId ?? null,
        createdAt: now(),
      };
      try {
        await store.attachments.create(record);
      } catch (error) {
        try {
          await blobs.delete(id);
        } catch (cleanupError) {
          logger.error("attachment blob cleanup failed after metadata error", {
            attachmentId: id,
            ticketId,
            error: cleanupError,
          });
        }
        throw error;
      }
      saved.push(record);
    }
  } catch (error) {
    await rollbackCreated(saved, blobs);
    throw error;
  }

  for (const record of saved) {
    // Internal-note files keep their name out of the ticket timeline, which requesters can read.
    await recordEvent(
      ticketId,
      "agent_action",
      options.internal ? `An internal attachment was added by ${actor}.` : `Attachment "${record.fileName}" added by ${actor}.`
    );
    await appendAudit({
      tenantId: ticket.tenantId,
      actor,
      action: "ticket.attachment.added",
      ticketId,
      payload: {
        fileName: record.fileName,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        messageId: record.messageId ?? null,
      },
    });
  }
  return saved;
}

// -----------------------------------------------------------------------------
// Idempotent single-file upload.
//
// The browser gives every selected screenshot one random upload key and re-sends
// the same key when it retries that file. The attachment id is derived from
// (tenant, ticket, key), so the primary key itself is the idempotency record:
//   - the same key on the same ticket always means the same row;
//   - a different key (even for an identical file) is a separate attachment;
//   - two concurrent requests with one key cannot both insert: the loser sees the
//     winner's row and verifies the bytes, it never writes a second record;
//   - a replay is only returned after the stored bytes match the new bytes, so a
//     name, size or header alone is never taken as proof of identity.
// The row is claimed BEFORE the blob is written, so a losing request never
// touches the winner's blob. No schema change is needed.
// -----------------------------------------------------------------------------

const UPLOAD_KEY = /^[A-Za-z0-9_-]{16,64}$/;
const STALE_CLAIM_MS = 60_000;
const CLAIM_POLL_MS = 100;
const CLAIM_POLLS = 10;

export const isValidUploadKey = (key: unknown): key is string => typeof key === "string" && UPLOAD_KEY.test(key);

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const uploadAttachmentId = (tenantId: string, ticketId: string, key: string) =>
  `att_${createHash("sha256").update(`${tenantId}\u0000${ticketId}\u0000${key}`).digest("hex").slice(0, 32)}`;

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  return e?.code === "P2002" || /unique constraint/i.test(e?.message ?? "");
}

export async function saveAttachmentWithKey(
  tenantId: string,
  ticketId: string,
  input: AttachmentInput,
  uploadKey: string,
  actor = "system",
  dependencies: AttachmentDependencies = {}
): Promise<{ record: AttachmentRow; replayed: boolean }> {
  if (!isValidUploadKey(uploadKey)) throw new AttachmentError("Invalid upload key.");
  const store = await getStore();
  const ticket = await getTicket(ticketId, tenantId); // another tenant's ticket reads as missing
  if (!ticket) throw new AttachmentError("Ticket not found.");
  const prepared = prepareAttachment(input);
  await scanAttachment(prepared.fileName, prepared.bytes);
  const blobs = resolveBlobStore(dependencies);
  const id = uploadAttachmentId(tenantId, ticketId, uploadKey);
  const digest = sha256(prepared.bytes);

  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await store.attachments.get(id);
    if (existing) {
      if (existing.ticketId !== ticketId) throw new AttachmentError("Upload key conflict.", 409);
      // The winner may still be writing its blob; give it a moment.
      let stored: Buffer | null = null;
      for (let poll = 0; poll < CLAIM_POLLS && !stored; poll++) {
        stored = await blobs.get(id);
        if (!stored) await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_MS));
      }
      if (stored) {
        if (stored.length !== prepared.bytes.length || sha256(stored) !== digest) {
          throw new AttachmentError("This upload key was already used for a different file.", 409);
        }
        return { record: existing, replayed: true };
      }
      if (Date.now() - Date.parse(existing.createdAt) < STALE_CLAIM_MS) {
        throw new AttachmentError("This upload is still being stored. Retry shortly.", 409);
      }
      // An abandoned claim (the request that made it died before storing the file): clear it and claim again.
      await store.attachments.remove(id);
      continue;
    }
    const record: AttachmentRow = {
      id, ticketId, fileName: prepared.fileName, mimeType: prepared.mimeType, sizeBytes: prepared.bytes.length,
      blobUrl: "", messageId: null, createdAt: now(),
    };
    try {
      await store.attachments.create(record);
    } catch (error) {
      if (isUniqueViolation(error)) continue; // lost the race: verify against the winner's row
      throw error;
    }
    try {
      record.blobUrl = await blobs.put(id, prepared.bytes, { contentType: prepared.mimeType });
      await store.attachments.update(id, { blobUrl: record.blobUrl });
    } catch (error) {
      // Leave neither a metadata row nor a blob behind.
      await store.attachments.remove(id).catch((e) => logger.error("upload claim cleanup failed", { attachmentId: id, error: e }));
      await blobs.delete(id).catch((e) => logger.error("upload blob cleanup failed", { attachmentId: id, error: e }));
      throw error;
    }
    await recordEvent(ticketId, "agent_action", `Attachment "${record.fileName}" added by ${actor}.`);
    await appendAudit({
      tenantId: ticket.tenantId, actor, action: "ticket.attachment.added", ticketId,
      payload: { fileName: record.fileName, mimeType: record.mimeType, sizeBytes: record.sizeBytes, messageId: null },
    });
    return { record, replayed: false };
  }
  throw new AttachmentError("Could not store this upload. Retry shortly.", 409);
}

/** Attachments the viewer may see: staff see everything; requesters lose files on internal notes. */
export async function listVisibleAttachments(tenantId: string, ticketId: string, includeInternal: boolean): Promise<AttachmentRow[]> {
  if (!(await getTicket(ticketId, tenantId))) return [];
  const store = await getStore();
  const [attachments, messages] = await Promise.all([
    store.attachments.list({ ticketId }),
    store.messages.list({ ticketId }),
  ]);
  const internalMessageIds = new Set(messages.filter((m) => m.visibility === "internal").map((m) => m.id));
  return attachments
    .filter((a) => includeInternal || !a.messageId || !internalMessageIds.has(a.messageId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** True when the file belongs to an internal note. Unknown tickets count as hidden. */
export async function isAttachmentInternal(tenantId: string, record: AttachmentRow): Promise<boolean> {
  if (!(await getTicket(record.ticketId, tenantId))) return true;
  if (!record.messageId) return false;
  const store = await getStore();
  const message = await store.messages.get(record.messageId);
  return message?.visibility === "internal";
}

export async function saveAttachment(
  tenantId: string,
  ticketId: string,
  input: AttachmentInput,
  actor = "system",
  dependencies: AttachmentDependencies = {}
): Promise<AttachmentRow> {
  const [record] = await saveAttachments(
    tenantId,
    ticketId,
    [input],
    actor,
    dependencies
  );
  return record;
}

export async function listAttachments(
  tenantId: string,
  ticketId: string,
  options: ListOptions<AttachmentRow> = { orderBy: { field: "createdAt", dir: "asc" } }
): Promise<PageResult<AttachmentRow>> {
  if (!(await getTicket(ticketId, tenantId))) return { data: [], total: 0 };
  const store = await getStore();
  return pageCollection(store.attachments, { ticketId }, options);
}

async function findAttachment(
  tenantId: string,
  id: string
): Promise<{ record: AttachmentRow; ticketId: string } | null> {
  const store = await getStore();
  const record = await store.attachments.get(id);
  if (!record) return null;
  const ticket = await getTicket(record.ticketId, tenantId);
  return ticket ? { record, ticketId: ticket.id } : null;
}

export async function getAttachmentMetadata(
  tenantId: string,
  id: string
): Promise<AttachmentRow | null> {
  return (await findAttachment(tenantId, id))?.record ?? null;
}

export async function readAttachment(
  tenantId: string,
  id: string,
  dependencies: AttachmentDependencies = {}
): Promise<{ record: AttachmentRow; bytes: Buffer } | null> {
  const found = await findAttachment(tenantId, id);
  if (!found) return null;
  const bytes = await resolveBlobStore(dependencies).get(id);
  if (!bytes) {
    logger.warn("attachment metadata points to a missing blob", {
      attachmentId: id,
      ticketId: found.ticketId,
    });
    return null;
  }
  if (bytes.length !== found.record.sizeBytes) {
    logger.warn("attachment size differs from stored metadata", {
      attachmentId: id,
      ticketId: found.ticketId,
      expectedBytes: found.record.sizeBytes,
      actualBytes: bytes.length,
    });
  }
  return { record: found.record, bytes };
}

export async function deleteAttachment(
  tenantId: string,
  id: string,
  actor = "system",
  dependencies: AttachmentDependencies = {}
): Promise<boolean> {
  const store = await getStore();
  const found = await findAttachment(tenantId, id);
  if (!found) return false;
  const { record } = found;

  const removed = await store.attachments.remove(id);
  if (!removed) return false;

  const blobs = resolveBlobStore(dependencies);
  try {
    const blobRemoved = await blobs.delete(id);
    if (!blobRemoved) {
      logger.warn("attachment blob was already missing during delete", {
        attachmentId: id,
        ticketId: record.ticketId,
      });
    }
  } catch (error) {
    try {
      await store.attachments.create(record);
    } catch (restoreError) {
      logger.error("attachment metadata restore failed after blob delete error", {
        attachmentId: id,
        ticketId: record.ticketId,
        error: restoreError,
      });
      throw new AggregateError(
        [error, restoreError],
        "Attachment delete failed and metadata could not be restored."
      );
    }
    throw error;
  }

  await appendAudit({
    tenantId,
    actor,
    action: "ticket.attachment.removed",
    ticketId: record.ticketId,
    payload: { fileName: record.fileName },
  });
  return true;
}

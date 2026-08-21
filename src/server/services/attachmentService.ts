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

function prepareAttachment(input: AttachmentInput): AttachmentInput {
  const fileName = sanitizeFileName(input.fileName);
  const mimeType = input.mimeType.trim().toLowerCase() || "application/octet-stream";
  validate(fileName, mimeType, input.bytes.length);
  return { fileName, mimeType, bytes: input.bytes };
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
  dependencies: AttachmentDependencies = {}
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
    await recordEvent(
      ticketId,
      "agent_action",
      `Attachment "${record.fileName}" added by ${actor}.`
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
      },
    });
  }
  return saved;
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

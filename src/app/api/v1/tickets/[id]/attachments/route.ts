import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parsePagination,
  readMultipartFormData,
} from "@/server/http";
import { actorContext, isResponse, loadTicket } from "@/server/guards";
import { can, isAgentRole } from "@/server/auth/rbac";
import { clientKey, rateLimit } from "@/server/rateLimit";
import { config } from "@/server/config";
import {
  AttachmentError,
  listAttachments,
  saveAttachments,
} from "@/server/services/attachmentService";
import type { AttachmentRow } from "@/server/domain/models";

// =============================================================================
// /api/v1/tickets/[id]/attachments
//
// GET  — list attachment metadata for a ticket.
// POST — multipart/form-data upload (field name "file", multiple allowed).
// Agents need ticket.write; requesters may act on their own tickets only.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES_PER_UPLOAD = 5;
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const MAX_MULTIPART_BYTES = Math.min(
  Number.MAX_SAFE_INTEGER,
  config.attachmentMaxBytes * MAX_FILES_PER_UPLOAD + MULTIPART_OVERHEAD_BYTES
);

async function guard(req: Request, ticketId: string, write: boolean) {
  const ctx = await actorContext(req);
  // Tenant scope for everyone; requesters additionally only see their own.
  const ticket = await loadTicket(ctx, ticketId);
  if (isResponse(ticket)) return { ok: false as const, response: ticket };

  if (isAgentRole(ctx.role)) {
    const needed = write ? "ticket.write" : "ticket.read";
    if (!can(ctx.role, needed)) {
      return { ok: false as const, response: fail("Forbidden.", 403) };
    }
  }
  // Requesters may read and upload on their own tickets.
  return { ok: true as const, actor: ctx.actor, ticket };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await guard(req, id, false);
  if (!res.ok) return res.response;
  const parsed = parsePagination(req, {
    defaultSortBy: "createdAt",
    defaultSortDir: "asc",
    allowedSortBy: ["createdAt", "fileName", "mimeType", "sizeBytes"] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  const result = await listAttachments(
    res.ticket.tenantId,
    id,
    listOptionsFromPagination<AttachmentRow>(pagination)
  );
  return paginated(result.data, result.total, pagination);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(clientKey(req, "attachments"), 30, 60_000)) {
    return fail("Rate limit exceeded. Try again shortly.", 429);
  }
  const { id } = await params;
  const res = await guard(req, id, true);
  if (!res.ok) return res.response;

  let form: FormData;
  try {
    const parsedForm = await readMultipartFormData(req, MAX_MULTIPART_BYTES);
    if (isResponse(parsedForm)) return parsedForm;
    form = parsedForm;
  } catch {
    return fail("Expected multipart/form-data with a \"file\" field.");
  }
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return fail("No files provided (use the \"file\" field).");
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return fail(`At most ${MAX_FILES_PER_UPLOAD} files per upload.`);
  }

  try {
    const inputs = await Promise.all(
      files.map(async (file) => ({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: Buffer.from(await file.arrayBuffer()),
      }))
    );
    const saved = await saveAttachments(
      res.ticket.tenantId,
      id,
      inputs,
      res.actor.name
    );
    return ok(saved, { status: 201 });
  } catch (err) {
    if (err instanceof AttachmentError) return fail(err.message);
    throw err;
  }
}

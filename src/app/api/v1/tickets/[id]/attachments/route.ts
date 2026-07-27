import { fail, ok } from "@/server/http";
import { actorContext, isResponse, loadTicket } from "@/server/guards";
import { can, isAgentRole } from "@/server/auth/rbac";
import { clientKey, rateLimit } from "@/server/rateLimit";
import {
  AttachmentError,
  listAttachments,
  saveAttachment,
} from "@/server/services/attachmentService";

// =============================================================================
// /api/v1/tickets/[id]/attachments
//
// GET  — list attachment metadata for a ticket.
// POST — multipart/form-data upload (field name "file", multiple allowed).
// Agents need ticket.write; requesters may act on their own tickets only.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(req: Request, ticketId: string, write: boolean) {
  const ctx = await actorContext(req);
  // Tenant scope for everyone; requesters additionally only see their own.
  const ticket = await loadTicket(ctx, ticketId);
  if (isResponse(ticket)) return { error: ticket };

  if (isAgentRole(ctx.role)) {
    const needed = write ? "ticket.write" : "ticket.read";
    if (!can(ctx.role, needed)) return { error: fail("Forbidden.", 403) };
  }
  // Requesters may read and upload on their own tickets.
  return { actor: ctx.actor, ticket };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await guard(req, id, false);
  if ("error" in res) return res.error;
  return ok(await listAttachments(id));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(clientKey(req, "attachments"), 30, 60_000)) {
    return fail("Rate limit exceeded. Try again shortly.", 429);
  }
  const { id } = await params;
  const res = await guard(req, id, true);
  if ("error" in res) return res.error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Expected multipart/form-data with a \"file\" field.");
  }
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return fail("No files provided (use the \"file\" field).");
  if (files.length > 5) return fail("At most 5 files per upload.");

  try {
    const saved = [];
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      saved.push(
        await saveAttachment(
          id,
          { fileName: file.name, mimeType: file.type || "application/octet-stream", bytes },
          res.actor.name
        )
      );
    }
    return ok(saved, { status: 201 });
  } catch (err) {
    if (err instanceof AttachmentError) return fail(err.message);
    throw err;
  }
}

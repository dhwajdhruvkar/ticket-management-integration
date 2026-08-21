import { NextResponse } from "next/server";
import { fail } from "@/server/http";
import { actorContext, isResponse, loadTicket, requirePermission } from "@/server/guards";
import { can } from "@/server/auth/rbac";
import {
  deleteAttachment,
  getAttachmentMetadata,
  readAttachment,
} from "@/server/services/attachmentService";

// =============================================================================
// /api/v1/attachments/[id]
//
// GET    — download the binary. Always Content-Disposition: attachment (and
//          nosniff) so uploads can never execute in the app origin.
// DELETE — agents with ticket.write only.
// Access control follows the parent ticket (agents, or the requester-owner).
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await actorContext(req);
  if (!can(ctx.role, "ticket.read")) return fail("Forbidden.", 403);

  const metadata = await getAttachmentMetadata(ctx.tenantId, id);
  if (!metadata) return fail("Attachment not found.", 404);

  // Access follows the parent ticket, which carries the tenant and the owner.
  const ticket = await loadTicket(ctx, metadata.ticketId);
  if (isResponse(ticket)) return fail("Attachment not found.", 404);

  // Fetch the binary only after tenant and requester ownership checks pass.
  const found = await readAttachment(ctx.tenantId, id);
  if (!found) return fail("Attachment not found.", 404);

  const encodedName = encodeURIComponent(found.record.fileName);
  return new NextResponse(new Uint8Array(found.bytes), {
    status: 200,
    headers: {
      "Content-Type": found.record.mimeType,
      "Content-Length": String(found.bytes.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=0",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "ticket.write");
  if (isResponse(ctx)) return ctx;

  const record = await getAttachmentMetadata(ctx.tenantId, id);
  if (!record) return fail("Attachment not found.", 404);
  const ticket = await loadTicket(ctx, record.ticketId);
  if (isResponse(ticket)) return fail("Attachment not found.", 404);

  const removed = await deleteAttachment(ctx.tenantId, id, ctx.actor.name);
  if (!removed) return fail("Attachment not found.", 404);
  return NextResponse.json({ ok: true, data: { deleted: true } });
}

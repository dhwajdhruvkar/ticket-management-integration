import { NextResponse } from "next/server";
import { currentActor } from "@/server/context";
import { fail } from "@/server/http";
import { can, isAgentRole } from "@/server/auth/rbac";
import { getStore } from "@/server/data";
import { deleteAttachment, readAttachment } from "@/server/services/attachmentService";
import type { Role } from "@/server/domain/models";

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
  const found = await readAttachment(id);
  if (!found) return fail("Attachment not found.", 404);

  const actor = await currentActor(req);
  const role = actor.role as Role;
  const store = await getStore();
  const ticket = await store.tickets.get(found.record.ticketId);
  if (!ticket) return fail("Attachment not found.", 404);

  if (isAgentRole(role)) {
    if (!can(role, "ticket.read")) return fail("Forbidden.", 403);
  } else if (ticket.requesterEmail.toLowerCase() !== (actor.email ?? "").toLowerCase()) {
    return fail("Forbidden.", 403);
  }

  const encodedName = encodeURIComponent(found.record.fileName);
  return new NextResponse(new Uint8Array(found.bytes), {
    status: 200,
    headers: {
      "Content-Type": found.record.mimeType,
      "Content-Length": String(found.record.sizeBytes),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=0",
    },
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "ticket.write")) return fail("Forbidden.", 403);
  const removed = await deleteAttachment(id, actor.name);
  if (!removed) return fail("Attachment not found.", 404);
  return NextResponse.json({ ok: true, data: { deleted: true } });
}

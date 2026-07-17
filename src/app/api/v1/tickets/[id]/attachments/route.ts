import { currentActor } from "@/server/context";
import { fail, ok } from "@/server/http";
import { can, isAgentRole } from "@/server/auth/rbac";
import { clientKey, rateLimit } from "@/server/rateLimit";
import { getStore } from "@/server/data";
import {
  AttachmentError,
  listAttachments,
  saveAttachment,
} from "@/server/services/attachmentService";
import type { Role } from "@/server/domain/models";

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
  const actor = await currentActor(req);
  const role = actor.role as Role;
  const store = await getStore();
  const ticket = await store.tickets.get(ticketId);
  if (!ticket) return { error: fail("Ticket not found.", 404) };

  if (isAgentRole(role)) {
    if (write && !can(role, "ticket.write")) return { error: fail("Forbidden.", 403) };
    if (!write && !can(role, "ticket.read")) return { error: fail("Forbidden.", 403) };
    return { actor, ticket };
  }
  // Requesters: own tickets only (read and upload both allowed).
  if (ticket.requesterEmail.toLowerCase() !== (actor.email ?? "").toLowerCase()) {
    return { error: fail("Forbidden.", 403) };
  }
  return { actor, ticket };
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

import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { linkTickets, unlinkTickets } from "@/server/services/agentActions";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// POST /api/v1/tickets/[id]/links — link or unlink related tickets.
//
// Body { ticketId, action?: "link" | "unlink" } relates two tickets (e.g.
// duplicates or dependencies). Requires ticket.write (agent+).
// =============================================================================

interface LinkBody {
  ticketId: string;
  action?: "link" | "unlink";
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "ticket.write")) return fail("Forbidden.", 403);

  const body = await readJson<LinkBody>(req);
  if (!body?.ticketId) return fail("ticketId is required.");
  if (body.ticketId === id) return fail("A ticket cannot be linked to itself.");

  const updated =
    body.action === "unlink"
      ? await unlinkTickets(id, body.ticketId, { name: actor.name, role: actor.role })
      : await linkTickets(id, body.ticketId, { name: actor.name, role: actor.role });

  return updated ? ok(updated) : fail("Ticket not found.", 404);
}

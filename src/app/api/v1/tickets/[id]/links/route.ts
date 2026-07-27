import { fail, ok, readJson } from "@/server/http";
import { isResponse, loadTicket, requirePermission } from "@/server/guards";
import { linkTickets, unlinkTickets } from "@/server/services/agentActions";

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
  const ctx = await requirePermission(req, "ticket.write");
  if (isResponse(ctx)) return ctx;

  const body = await readJson<LinkBody>(req);
  if (!body?.ticketId) return fail("ticketId is required.");
  if (body.ticketId === id) return fail("A ticket cannot be linked to itself.");

  // Both ends must be in the caller's tenant, otherwise linking would build a
  // cross-tenant reference that leaks the other ticket's reference number.
  const source = await loadTicket(ctx, id);
  if (isResponse(source)) return source;
  const target = await loadTicket(ctx, body.ticketId);
  if (isResponse(target)) return target;

  const { actor } = ctx;
  const updated =
    body.action === "unlink"
      ? await unlinkTickets(id, body.ticketId, { name: actor.name, role: actor.role })
      : await linkTickets(id, body.ticketId, { name: actor.name, role: actor.role });

  return updated ? ok(updated) : fail("Ticket not found.", 404);
}

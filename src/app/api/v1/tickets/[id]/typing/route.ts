import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { isAgentRole } from "@/server/auth/rbac";
import { publishEvent } from "@/server/events/bus";
import { getTicket } from "@/server/services/ticketService";
import type { MessageVisibility, Role } from "@/server/domain/models";

// =============================================================================
// POST /api/v1/tickets/:id/typing — ephemeral "someone is composing" signal.
//
// Broadcast straight onto the SSE bus (never persisted, never audited). The
// ticket page throttles pings to one every ~2s while the composer has input;
// viewers expire the indicator ~4s after the last ping. Internal-note typing
// is flagged so requesters never see it.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  const role = actor.role as Role;
  const agent = isAgentRole(role);

  const ticket = await getTicket(id);
  if (!ticket) return fail("Ticket not found.", 404);

  // Same record security as messages: requesters only on their own tickets.
  if (!agent && ticket.requesterEmail.toLowerCase() !== (actor.email ?? "").toLowerCase()) {
    return fail("Forbidden.", 403);
  }

  const payload = await readJson<{ visibility?: MessageVisibility }>(req);
  const visibility: MessageVisibility =
    agent && payload?.visibility === "internal" ? "internal" : "public";

  publishEvent({
    type: "ticket.typing",
    tenantId: ticket.tenantId,
    ticketId: ticket.id,
    ticketReference: ticket.reference,
    requesterEmail: ticket.requesterEmail,
    actorId: actor.id,
    actorName: actor.name,
    actorKind: agent ? "agent" : "requester",
    visibility,
  });
  return ok({ sent: true });
}

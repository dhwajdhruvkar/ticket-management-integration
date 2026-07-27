import { ok, readJson } from "@/server/http";
import { actorContext, isResponse, loadTicket } from "@/server/guards";
import { isAgentRole } from "@/server/auth/rbac";
import { publishEvent } from "@/server/events/bus";
import type { MessageVisibility } from "@/server/domain/models";

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
  const ctx = await actorContext(req);
  const { actor } = ctx;
  const agent = isAgentRole(ctx.role);

  // Same record security as messages: requesters only on their own tickets.
  const ticket = await loadTicket(ctx, id);
  if (isResponse(ticket)) return ticket;

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

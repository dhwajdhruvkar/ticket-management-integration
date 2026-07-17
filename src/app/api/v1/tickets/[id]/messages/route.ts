import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can, isAgentRole } from "@/server/auth/rbac";
import { agentReply, requesterReply } from "@/server/services/agentActions";
import { getTicket } from "@/server/services/ticketService";
import type { MessageVisibility, Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// POST /api/v1/tickets/[id]/messages — add a reply or internal note.
//
// Agents can post public replies or internal notes on any ticket; requesters
// can post public replies on their own tickets only (which un-parks/reopens as
// needed). Routes to agentReply/requesterReply based on the actor's role.
// =============================================================================

interface MessageBody {
  body: string;
  visibility?: MessageVisibility;
  asRequester?: boolean;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await readJson<MessageBody>(req);
  if (!payload?.body?.trim()) return fail("Message body is required.");
  const actor = await currentActor(req);
  const role = actor.role as Role;

  // Requesters can only reply publicly on their own tickets.
  if (payload.asRequester || !isAgentRole(role)) {
    const ticket = await getTicket(id);
    if (!ticket) return fail("Ticket not found.", 404);
    if (
      !isAgentRole(role) &&
      ticket.requesterEmail.toLowerCase() !== (actor.email ?? "").toLowerCase()
    ) {
      return fail("Forbidden.", 403);
    }
    const updated = await requesterReply(id, { name: actor.name, role: "requester" }, payload.body);
    return updated ? ok(updated) : fail("Ticket not found.", 404);
  }

  if (!can(role, "ticket.write")) return fail("Forbidden.", 403);
  const updated = await agentReply(id, actor, payload.body, payload.visibility ?? "public");
  return updated ? ok(updated) : fail("Ticket not found.", 404);
}

import { fail, ok, parseBody } from "@/server/http";
import { isResponse, loadTicket, requirePermission } from "@/server/guards";
import { can, isAgentRole, isTicketSubmitterRole } from "@/server/auth/rbac";
import { agentReply, requesterReply } from "@/server/services/agentActions";
import { z } from "zod";
import { WorkflowError } from "@/server/services/workflowService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// POST /api/v1/tickets/[id]/messages — add a reply or internal note.
//
// Agents can post public replies or internal notes on any ticket; requesters
// can post public replies on their own tickets only (which un-parks/reopens as
// needed). Routes to agentReply/requesterReply based on the actor's role.
// =============================================================================

const MessageBody = z.object({ body: z.string().trim().min(1).max(20000), visibility: z.enum(["public", "internal"]).optional(), asRequester: z.boolean().optional() }).strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "ticket.read");
  if (isResponse(ctx)) return ctx;
  if (isTicketSubmitterRole(ctx.role)) {
    return fail("Ticket submitter integrations are read-only after creation.", 403);
  }

  const payload = await parseBody(req, MessageBody);
  if (isResponse(payload)) return payload;

  // Tenant scope for everyone; requesters additionally only see their own.
  const ticket = await loadTicket(ctx, id);
  if (isResponse(ticket)) return ticket;

  // Requesters can only reply publicly on their own tickets.
  if (payload.asRequester && isAgentRole(ctx.role)) return fail("Staff cannot impersonate the requester.", 403);
  try {
  if (!isAgentRole(ctx.role)) {
    if (payload.visibility === "internal") return fail("Requesters can only send public replies.", 403);
    const updated = await requesterReply(id, { name: ctx.actor.name, role: "requester" }, payload.body);
    return updated ? ok(updated) : fail("Ticket not found.", 404);
  }

  if (!can(ctx.role, "ticket.write")) return fail("Forbidden.", 403);
  const updated = await agentReply(id, ctx.actor, payload.body, payload.visibility ?? "public");
  return updated ? ok(updated) : fail("Ticket not found.", 404);
  } catch (error) {
    if (error instanceof WorkflowError) return fail(error.message, error.status);
    throw error;
  }
}

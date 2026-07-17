import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can, isAgentRole } from "@/server/auth/rbac";
import { getTicketView } from "@/server/services/ticketService";
import { updateTicketFields, type TicketFieldPatch } from "@/server/services/agentActions";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  const role = actor.role as Role;
  if (!can(role, "ticket.read")) return fail("Forbidden.", 403);

  const view = await getTicketView(id);
  if (!view) return fail("Ticket not found.", 404);
  // Record security: requesters only ever see their own tickets.
  if (!isAgentRole(role) && view.requesterEmail.toLowerCase() !== (actor.email ?? "").toLowerCase()) {
    return fail("Forbidden.", 403);
  }
  return ok(view);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "ticket.write")) return fail("Forbidden.", 403);

  const patch = await readJson<TicketFieldPatch>(req);
  if (!patch) return fail("Invalid body.");
  const updated = await updateTicketFields(id, patch, actor);
  return updated ? ok(updated) : fail("Ticket not found.", 404);
}

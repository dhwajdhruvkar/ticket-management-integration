import { fail, ok, readJson } from "@/server/http";
import { isResponse, loadTicket, requirePermission } from "@/server/guards";
import { isAgentRole } from "@/server/auth/rbac";
import { getTicketView } from "@/server/services/ticketService";
import { updateTicketFields, type TicketFieldPatch } from "@/server/services/agentActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "ticket.read");
  if (isResponse(ctx)) return ctx;

  // Tenant scope + requester record security both live in loadTicket.
  const ticket = await loadTicket(ctx, id);
  if (isResponse(ticket)) return ticket;

  const view = await getTicketView(id, { includeInternal: isAgentRole(ctx.role) });
  return view ? ok(view) : fail("Ticket not found.", 404);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "ticket.write");
  if (isResponse(ctx)) return ctx;

  const ticket = await loadTicket(ctx, id);
  if (isResponse(ticket)) return ticket;

  const patch = await readJson<TicketFieldPatch>(req);
  if (!patch) return fail("Invalid body.");
  const updated = await updateTicketFields(id, patch, ctx.actor);
  return updated ? ok(updated) : fail("Ticket not found.", 404);
}

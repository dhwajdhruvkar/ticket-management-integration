import { fail, ok, parseBody } from "@/server/http";
import { isResponse, loadTicket, requirePermission } from "@/server/guards";
import { isAgentRole } from "@/server/auth/rbac";
import { getTicketView, deleteTicket } from "@/server/services/ticketService";
import { updateTicketFields, TicketFieldPatchSchema } from "@/server/services/agentActions";
import { WorkflowError } from "@/server/services/workflowService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "ticket.read");
  if (isResponse(ctx)) return ctx;

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

  const patch = await parseBody(req, TicketFieldPatchSchema);
  if (isResponse(patch)) return patch;
  try {
    const updated = await updateTicketFields(id, patch, ctx.actor);
    return updated ? ok(updated) : fail("Ticket not found.", 404);
  } catch (error) {
    if (error instanceof WorkflowError) return fail(error.message, error.status);
    throw error;
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "ticket.delete");
  if (isResponse(ctx)) return ctx;

  const ticket = await loadTicket(ctx, id);
  if (isResponse(ticket)) return ticket;

  const success = await deleteTicket(id, ctx.actor.email ?? "system");
  return success ? ok({ deleted: true }) : fail("Failed to delete ticket.");
}

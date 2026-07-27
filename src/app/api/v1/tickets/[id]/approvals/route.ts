import { fail, ok, readJson } from "@/server/http";
import { isResponse, loadTicket, requirePermission } from "@/server/guards";
import {
  decideTicketApproval,
  listTicketApprovals,
} from "@/server/services/approvalService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/tickets/[id]/approvals — service-request approvals.
//
// GET lists the ticket's approval records; POST records a decision
// (approve/reject) which resumes or cancels fulfilment. Deciding requires the
// change.approve permission (manager+).
// =============================================================================

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "ticket.read");
  if (isResponse(ctx)) return ctx;

  // Tenant scope for everyone; requesters additionally only see their own.
  const ticket = await loadTicket(ctx, id);
  if (isResponse(ticket)) return ticket;

  return ok(await listTicketApprovals(id));
}

interface DecisionBody {
  decision: "approved" | "rejected";
  comment?: string;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "change.approve");
  if (isResponse(ctx)) return ctx;

  const ticket = await loadTicket(ctx, id);
  if (isResponse(ticket)) return ticket;

  const body = await readJson<DecisionBody>(req);
  if (body?.decision !== "approved" && body?.decision !== "rejected") {
    return fail("decision must be 'approved' or 'rejected'.");
  }
  const updated = await decideTicketApproval(id, {
    decision: body.decision,
    approverName: ctx.actor.name,
    comment: body.comment,
  });
  return updated ? ok(updated) : fail("No pending approval on this ticket.", 404);
}

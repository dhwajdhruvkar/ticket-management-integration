import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can, isAgentRole } from "@/server/auth/rbac";
import {
  decideTicketApproval,
  listTicketApprovals,
} from "@/server/services/approvalService";
import { getTicket } from "@/server/services/ticketService";
import type { Role } from "@/server/domain/models";

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
  const actor = await currentActor(req);
  const role = actor.role as Role;
  if (!can(role, "ticket.read")) return fail("Forbidden.", 403);

  const ticket = await getTicket(id);
  if (!ticket) return fail("Ticket not found.", 404);
  // Record security: requesters only ever see their own tickets.
  if (!isAgentRole(role) && ticket.requesterEmail.toLowerCase() !== (actor.email ?? "").toLowerCase()) {
    return fail("Forbidden.", 403);
  }

  return ok(await listTicketApprovals(id));
}

interface DecisionBody {
  decision: "approved" | "rejected";
  comment?: string;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "change.approve")) return fail("Forbidden.", 403);

  const body = await readJson<DecisionBody>(req);
  if (body?.decision !== "approved" && body?.decision !== "rejected") {
    return fail("decision must be 'approved' or 'rejected'.");
  }
  const updated = await decideTicketApproval(id, {
    decision: body.decision,
    approverName: actor.name,
    comment: body.comment,
  });
  return updated ? ok(updated) : fail("No pending approval on this ticket.", 404);
}

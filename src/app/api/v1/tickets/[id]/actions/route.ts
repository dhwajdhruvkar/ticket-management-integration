import { fail, ok, readJson } from "@/server/http";
import { actorContext, isResponse, loadTicket } from "@/server/guards";
import { can, isAgentRole } from "@/server/auth/rbac";
import {
  agentClose,
  agentResolve,
  assignTicket,
  escalateTicket,
  reopenTicket,
  submitFeedback,
} from "@/server/services/agentActions";
import { acceptSuggestion, resolveTicket } from "@/server/ai/resolver";
import type { TicketStatus } from "@/server/domain/models";

// =============================================================================
// POST /api/v1/tickets/[id]/actions — ticket lifecycle actions.
//
// One endpoint dispatching by `action`: assign, resolve, close, reopen,
// escalate, accept_suggestion, run_ai (agents, gated by the relevant
// permission) and reopen/feedback (requesters, on their own tickets). Each
// action delegates to the matching service and returns the updated ticket.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ActionBody {
  action:
    | "assign"
    | "resolve"
    | "close"
    | "reopen"
    | "escalate"
    | "feedback"
    | "run_ai"
    | "accept_suggestion";
  assigneeId?: string | null;
  assignmentGroupId?: string | null;
  reply?: string;
  resolutionNotes?: string;
  reason?: string;
  satisfaction?: "satisfied" | "unsatisfied";
  comment?: string;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<ActionBody>(req);
  if (!body?.action) return fail("action is required.");
  const ctx = await actorContext(req);
  const { actor, role } = ctx;

  // Tenant scope for everyone; requesters additionally only see their own.
  const ticket = await loadTicket(ctx, id);
  if (isResponse(ticket)) return ticket;

  // Requesters may only reopen or give feedback on their own tickets.
  if (!isAgentRole(role)) {
    if (body.action !== "reopen" && body.action !== "feedback") return fail("Forbidden.", 403);
    // Governance: a cancelled ticket (e.g. a rejected service request) cannot
    // be resurrected by its requester — that would bypass the approval flow.
    if (ticket.status === "cancelled") {
      return fail("This request was cancelled. Please raise a new request instead.", 403);
    }
  }

  switch (body.action) {
    case "assign":
      if (!can(role, "ticket.assign")) return fail("Forbidden.", 403);
      return respond(await assignTicket(id, body.assigneeId ?? null, actor, body.assignmentGroupId));
    case "resolve":
      if (!can(role, "ticket.resolve")) return fail("Forbidden.", 403);
      return respond(await agentResolve(id, actor, body.reply, body.resolutionNotes));
    case "close":
      if (!can(role, "ticket.resolve")) return fail("Forbidden.", 403);
      return respond(await agentClose(id, actor));
    case "reopen":
      return respond(await reopenTicket(id, actor));
    case "escalate": {
      if (!can(role, "ticket.write")) return fail("Forbidden.", 403);
      // The reason is the whole point of the handoff: without it the dispatcher
      // is re-triaging from zero.
      if (!body.reason?.trim()) return fail("A reason is required to escalate.");
      if (!ACTIVE.has(ticket.status)) {
        return fail("Only an active ticket can be escalated.", 409);
      }
      return respond(await escalateTicket(id, body.reason, actor));
    }
    case "feedback": {
      if (!body.satisfaction) return fail("satisfaction is required for feedback.");
      // CSAT is feedback on an outcome; there is no outcome to rate until the
      // ticket has actually been resolved or closed.
      if (!RATEABLE.has(ticket.status)) {
        return fail("This ticket has not been resolved yet, so it cannot be rated.", 409);
      }
      return respond(await submitFeedback(id, body.satisfaction, body.comment));
    }
    case "run_ai":
      if (!can(role, "ticket.write")) return fail("Forbidden.", 403);
      return respond(await resolveTicket(id));
    case "accept_suggestion":
      if (!can(role, "ticket.resolve")) return fail("Forbidden.", 403);
      return respond(await acceptSuggestion(id, actor.name));
    default:
      return fail("Unknown action.");
  }
}

const RATEABLE = new Set<TicketStatus>(["resolved", "auto_resolved", "closed"]);

const ACTIVE = new Set<TicketStatus>([
  "new",
  "open",
  "in_progress",
  "pending",
  "pending_agent",
  "reopened",
]);

function respond<T>(result: T | null) {
  return result ? ok(result) : fail("Ticket not found.", 404);
}

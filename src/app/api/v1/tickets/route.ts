import { currentActor, currentTenantId } from "@/server/context";
import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parsePagination,
  readJson,
} from "@/server/http";
import { can, isAgentRole } from "@/server/auth/rbac";
import { clientKey, rateLimit } from "@/server/rateLimit";
import { listTickets, type NewTicketInput } from "@/server/services/ticketService";
import { intakeTicket } from "@/server/services/intake";
import type { Role, TicketRow } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/tickets — list + create.
//
// GET: list tickets with optional status/type/assignee/group filters; requesters
// are transparently scoped to their own tickets (record-level security).
// POST: create a ticket through the full intake pipeline (classification, SLA,
// routing, automations, AI triage); rate-limited, and requesters can only file
// as themselves.
// =============================================================================

// GET: return tickets the actor may see (requesters -> own only).
export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  const role = actor.role as Role;
  if (!can(role, "ticket.read")) return fail("Forbidden.", 403);
  const parsed = parsePagination(req, {
    defaultSortBy: "createdAt",
    defaultSortDir: "desc",
    allowedSortBy: [
      "createdAt",
      "updatedAt",
      "reference",
      "priority",
      "status",
      "subject",
    ] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;

  const url = new URL(req.url);
  const where: Partial<TicketRow> = {};
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("type");
  const assigneeId = url.searchParams.get("assigneeId");
  const groupId = url.searchParams.get("groupId");
  if (status) where.status = status as TicketRow["status"];
  if (type) where.type = type as TicketRow["type"];
  // `assigneeId=unassigned` filters to tickets with no assignee (dispatch queue).
  if (assigneeId === "unassigned") where.assigneeId = null;
  else if (assigneeId) where.assigneeId = assigneeId;
  if (groupId) where.assignmentGroupId = groupId;

  // Record security: requesters only ever see their own tickets.
  if (!isAgentRole(role)) {
    if (!actor.email) return paginated([], 0, pagination);
    where.requesterEmail = actor.email;
  }

  const { data, total } = await listTickets(
    tenantId,
    where,
    listOptionsFromPagination<TicketRow>(pagination)
  );
  return paginated(data, total, pagination);
}

// POST: create a ticket (requesters file as themselves; runs the intake pipeline).
export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, "tickets"), 60, 60_000)) {
    return fail("Rate limit exceeded. Try again shortly.", 429);
  }
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  const body = await readJson<NewTicketInput & { autoResolve?: boolean }>(req);
  if (!body?.subject || !body?.body) {
    return fail("subject and body are required.");
  }
  if (typeof body.subject !== "string" || typeof body.body !== "string" || body.subject.length > 300 || body.body.length > 50_000) {
    return fail("subject/body must be strings within size limits.");
  }
  // Requesters always raise tickets as themselves.
  if (!isAgentRole(actor.role as Role)) {
    if (!actor.email) return fail("Forbidden.", 403);
    body.requesterEmail = actor.email;
  }
  if (!body.requesterEmail) return fail("requesterEmail is required.");
  const ticket = await intakeTicket(tenantId, body);
  return ok(ticket, { status: 201 });
}

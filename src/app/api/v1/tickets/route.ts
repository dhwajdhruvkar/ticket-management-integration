import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parsePagination,
  readJson,
} from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { isAgentRole } from "@/server/auth/rbac";
import { clientKey, rateLimit } from "@/server/rateLimit";
import { listTickets, type NewTicketInput } from "@/server/services/ticketService";
import { intakeTicket } from "@/server/services/intake";
import {
  findIdempotentTicket,
  IdempotencyError,
  ticketIdempotencyMetadata,
} from "@/server/services/idempotencyService";
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
  const ctx = await requirePermission(req, "ticket.read");
  if (isResponse(ctx)) return ctx;
  const { tenantId, actor, role } = ctx;
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
  const ctx = await requirePermission(req, "ticket.create");
  if (isResponse(ctx)) return ctx;
  const { tenantId, actor } = ctx;
  const body = await readJson<NewTicketInput & { autoResolve?: boolean }>(req);
  if (!body?.subject || !body?.body) {
    return fail("subject and body are required.");
  }
  if (
    body.externalTicketId !== undefined &&
    (typeof body.externalTicketId !== "string" || body.externalTicketId.trim().length > 128)
  ) {
    return fail("externalTicketId must be a string of at most 128 characters.");
  }
  // These are always server-derived, even if a caller includes lookalike JSON.
  delete body.idempotencyScopeHash;
  delete body.idempotencyRequestHash;
  delete body.integrationKeyId;
  delete body.requesterId;
  if (typeof body.subject !== "string" || typeof body.body !== "string" || body.subject.length > 300 || body.body.length > 50_000) {
    return fail("subject/body must be strings within size limits.");
  }
  // Requesters always raise tickets as themselves.
  if (!isAgentRole(actor.role as Role)) {
    if (!actor.email) return fail("Forbidden.", 403);
    body.requesterEmail = actor.email;
  }
  if (!body.requesterEmail) return fail("requesterEmail is required.");

  let metadata;
  try {
    metadata = ticketIdempotencyMetadata(
      req,
      tenantId,
      actor,
      body as unknown as Record<string, unknown>
    );
    if (metadata) {
      const existing = await findIdempotentTicket(tenantId, metadata);
      if (existing) {
        return ok(existing, {
          status: 200,
          headers: { "Idempotency-Replayed": "true" },
        });
      }
      body.idempotencyScopeHash = metadata.scopeHash;
      body.idempotencyRequestHash = metadata.requestHash;
      body.integrationKeyId = metadata.integrationKeyId;
      body.externalTicketId = metadata.externalTicketId;
    }
    // Machine-created tickets retain their originating integration even when a
    // partner omitted idempotency metadata. Scoped callbacks use this binding
    // so they cannot observe other requesters' tickets in the tenant.
    if (actor.apiKeyId) body.integrationKeyId = actor.apiKeyId;

    const ticket = await intakeTicket(tenantId, body);
    return ok(ticket, {
      status: 201,
      headers: metadata ? { "Idempotency-Replayed": "false" } : undefined,
    });
  } catch (error) {
    // A concurrent request can win the unique idempotency insert after our
    // initial lookup. Re-read and replay its ticket instead of surfacing P2002.
    if (metadata) {
      try {
        const existing = await findIdempotentTicket(tenantId, metadata);
        if (existing) {
          return ok(existing, {
            status: 200,
            headers: { "Idempotency-Replayed": "true" },
          });
        }
      } catch (replayError) {
        if (replayError instanceof IdempotencyError) {
          return fail(replayError.message, replayError.status);
        }
      }
    }
    if (error instanceof IdempotencyError) return fail(error.message, error.status);
    throw error;
  }
}

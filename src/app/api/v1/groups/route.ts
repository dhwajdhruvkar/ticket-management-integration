import { fail, ok, readJson } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { createGroup, listGroups } from "@/server/services/groupService";
import type { TicketCategory } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/groups — assignment groups (support teams / queues).
//
// GET lists groups; POST creates one (admin). Groups own categories for auto-
// routing and an assignment strategy; membership/strategy edits are on [id].
// =============================================================================

export async function GET(req: Request) {
  // Group membership is agent-facing routing metadata, not requester data.
  const ctx = await requirePermission(req, "ticket.assign");
  if (isResponse(ctx)) return ctx;
  return ok(await listGroups(ctx.tenantId));
}

interface NewGroupBody {
  name: string;
  description?: string;
  memberIds?: string[];
  categories?: TicketCategory[];
  leadId?: string;
}

export async function POST(req: Request) {
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;

  const body = await readJson<NewGroupBody>(req);
  if (!body?.name?.trim()) return fail("name is required.");
  return ok(await createGroup(ctx.tenantId, body, ctx.actor.name), { status: 201 });
}

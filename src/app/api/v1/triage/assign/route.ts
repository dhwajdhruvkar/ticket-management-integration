import { fail, ok, readJson } from "@/server/http";
import { actorContext } from "@/server/guards";
import { can } from "@/server/auth/rbac";
import { getStore } from "@/server/data";
import { bulkAssignTickets, MAX_BULK_ASSIGN } from "@/server/services/triageService";

// =============================================================================
// POST /api/v1/triage/assign — clear the dispatcher queue in one round trip.
//
// With `assigneeId`, every listed ticket goes to that person. Without it, each
// ticket is routed to its own best fit, which is what makes the one-click and
// bulk buttons on the triage board viable at a few hundred tickets a day.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AssignBody {
  ticketIds?: string[];
  /** Omit to pick the best fit per ticket. */
  assigneeId?: string | null;
}

export async function POST(req: Request) {
  const { actor, role, tenantId } = await actorContext(req);
  if (!can(role, "ticket.dispatch")) return fail("Forbidden.", 403);

  const body = await readJson<AssignBody>(req);
  const ticketIds = [...new Set((body?.ticketIds ?? []).filter((id) => typeof id === "string"))];
  if (ticketIds.length === 0) return fail("ticketIds is required.");
  if (ticketIds.length > MAX_BULK_ASSIGN) {
    return fail(`At most ${MAX_BULK_ASSIGN} tickets per request.`);
  }

  if (body?.assigneeId) {
    const store = await getStore();
    const user = await store.users.get(body.assigneeId);
    if (!user || user.tenantId !== tenantId) return fail("Unknown assignee.", 404);
  }

  return ok(await bulkAssignTickets(tenantId, ticketIds, actor, body?.assigneeId));
}

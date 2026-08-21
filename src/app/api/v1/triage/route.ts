import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { getTriageBoard } from "@/server/services/triageService";
import type { Role } from "@/server/domain/models";

// GET /api/v1/triage — dispatcher board: unassigned queue, escalations awaiting
// reassignment, and per-agent workload. Restricted to dispatchers (manager+).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "ticket.dispatch")) return fail("Forbidden.", 403);
  return ok(await getTriageBoard(tenantId));
}

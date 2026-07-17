import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok } from "@/server/http";
import { getTriageBoard } from "@/server/services/triageService";
import type { Role } from "@/server/domain/models";

// GET /api/v1/triage — dispatcher board: unassigned queue + agent workload.
// Restricted to dispatchers (manager/tenant_admin/super_admin).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISPATCH_ROLES: Role[] = ["manager", "tenant_admin", "super_admin"];

export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!DISPATCH_ROLES.includes(actor.role as Role)) return fail("Forbidden.", 403);
  return ok(await getTriageBoard(tenantId));
}

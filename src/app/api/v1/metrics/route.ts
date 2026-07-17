import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { computeMetrics } from "@/server/services/metricsService";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/metrics — workspace KPIs for the dashboard/insights (deflection,
// MTTR, SLA compliance, backlog, CSAT, leaderboard). Gated by report.read.

export async function GET(req: Request) {
  const tenantId = await currentTenantId(req);
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "report.read")) return fail("Forbidden.", 403);
  return ok(await computeMetrics(tenantId));
}

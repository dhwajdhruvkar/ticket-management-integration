import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { computeTrends } from "@/server/services/metricsService";
import type { Role } from "@/server/domain/models";

// GET /api/v1/reports/trends?days=30 — daily created/resolved/SLA/CSAT series.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "report.read")) return fail("Forbidden.", 403);

  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") ?? 30);
  return ok(await computeTrends(tenantId, Number.isFinite(days) ? days : 30));
}

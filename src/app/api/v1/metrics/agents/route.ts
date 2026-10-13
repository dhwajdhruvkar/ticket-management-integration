import { isResponse, requirePermission } from "@/server/guards";
import { fail, ok } from "@/server/http";
import { getAgentPerformance, type Granularity, type PerformanceRange } from "@/server/services/agentPerformance";
import { WorkflowError } from "@/server/services/workflowService";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const ctx = await requirePermission(req, "report.read");
  if (isResponse(ctx)) return ctx;
  const query = new URL(req.url).searchParams;
  const range = query.get("range") ?? "week";
  if (!["week", "month", "year", "custom"].includes(range)) return fail("Invalid performance range.");
  const granularity = query.get("granularity") ?? undefined;
  if (granularity !== undefined && !["day", "week", "month"].includes(granularity)) return fail("Invalid granularity.");
  try { return ok(await getAgentPerformance(ctx.tenantId, range as PerformanceRange, query.get("from") ?? undefined, query.get("to") ?? undefined, granularity as Granularity | undefined), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { if (error instanceof WorkflowError) return fail(error.message, error.status); throw error; }
}

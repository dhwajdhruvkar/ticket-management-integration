import { isResponse, requirePermission } from "@/server/guards";
import { fail, ok } from "@/server/http";
import { getWorkflowBoard } from "@/server/services/workflowBoard";
import { WorkflowError } from "@/server/services/workflowService";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const ctx = await requirePermission(req, "report.read");
  if (isResponse(ctx)) return ctx;
  if (ctx.actor.apiKeyId) return fail("Use a staff account.", 403);
  try { return ok((await getWorkflowBoard(ctx.tenantId, ctx.actor, true)).monitoring, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { if (error instanceof WorkflowError) return fail(error.message, error.status); throw error; }
}

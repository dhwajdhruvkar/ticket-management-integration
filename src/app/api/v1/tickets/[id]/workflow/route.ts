import { isResponse, requirePermission } from "@/server/guards";
import { fail, ok, parseBody } from "@/server/http";
import { transitionWorkflow, WorkflowActionSchema, WorkflowError } from "@/server/services/workflowService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission(req, "ticket.write");
  if (isResponse(ctx)) return ctx;
  if (ctx.actor.apiKeyId) return fail("A staff account must accept or review tickets.", 403);
  const input = await parseBody(req, WorkflowActionSchema);
  if (isResponse(input)) return input;
  try { return ok(await transitionWorkflow(ctx.tenantId, (await params).id, ctx.actor, input)); }
  catch (error) { if (error instanceof WorkflowError) return fail(error.message, error.status); throw error; }
}

import { getStore } from "@/server/data";
import { isResponse, requirePermission } from "@/server/guards";
import { fail, ok, parseBody } from "@/server/http";
import { defaultWorkflowSettings } from "@/shared/workflow";
import { configureWorkflow, WorkflowError, WorkflowSettingsSchema } from "@/server/services/workflowService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const ctx = await requirePermission(req, "report.read");
  if (isResponse(ctx)) return ctx;
  const store = await getStore();
  return ok((await store.tenants.get(ctx.tenantId))?.workflowSettings ?? defaultWorkflowSettings());
}
export async function PATCH(req: Request) {
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  if (ctx.actor.apiKeyId) return fail("Use an administrator account to configure the workflow.", 403);
  const input = await parseBody(req, WorkflowSettingsSchema);
  if (isResponse(input)) return input;
  try { return ok(await configureWorkflow(ctx.tenantId, input, ctx.actor)); }
  catch (error) { if (error instanceof WorkflowError) return fail(error.message, error.status); throw error; }
}

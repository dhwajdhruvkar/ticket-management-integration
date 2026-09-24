import { fail, ok } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { deleteApiKey } from "@/server/auth/apiKeys";

// DELETE /api/v1/api-keys/[id] — permanently delete a key. Admin only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const actorContext = await requirePermission(req, "admin");
  if (isResponse(actorContext)) return actorContext;
  const { tenantId, actor } = actorContext;

  const deleted = await deleteApiKey(tenantId, id, actor.name);
  if (!deleted) return fail("API key not found.", 404);
  return ok({ deleted: true });
}

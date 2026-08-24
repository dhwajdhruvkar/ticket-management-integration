import { fail, ok } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { revokeApiKey } from "@/server/auth/apiKeys";

// DELETE /api/v1/api-keys/[id] — revoke (deactivate) a key. Admin only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const actorContext = await requirePermission(req, "admin");
  if (isResponse(actorContext)) return actorContext;
  const { tenantId, actor } = actorContext;

  const revoked = await revokeApiKey(tenantId, id, actor.name);
  if (!revoked) return fail("API key not found.", 404);
  return ok({ revoked: true });
}

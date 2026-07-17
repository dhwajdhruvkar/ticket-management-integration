import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { revokeApiKey } from "@/server/auth/apiKeys";
import type { Role } from "@/server/domain/models";

// DELETE /api/v1/api-keys/[id] — revoke (deactivate) a key. Admin only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);

  const revoked = await revokeApiKey(tenantId, id, actor.name);
  if (!revoked) return fail("API key not found.", 404);
  return ok({ revoked: true });
}

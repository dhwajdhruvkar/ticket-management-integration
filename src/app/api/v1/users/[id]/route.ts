import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { getStore } from "@/server/data";
// =============================================================================
// /api/v1/users/[id] — update or deactivate a user (admin).
//
// PATCH edits profile/role/department (role-escalation guarded); DELETE soft-
// deactivates. Both enforce that the actor may manage the target's role.
// =============================================================================
import {
  deactivateUser,
  updateUser,
  UserServiceError,
  type UpdateUserInput,
} from "@/server/services/userService";
import type { Role } from "@/server/domain/models";
import { toUserAccessView } from "@/server/services/accountAccessService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function targetTenantId(
  req: Request,
  currentTenant: string,
  actorRole: string
): Promise<string | Response> {
  const requested = new URL(req.url).searchParams.get("organizationId")?.trim();
  if (!requested || requested === currentTenant) return currentTenant;
  if (actorRole !== "super_admin") return fail("Forbidden.", 403);
  const store = await getStore();
  return (await store.tenants.get(requested))
    ? requested
    : fail("Organization not found.", 404);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [currentTenant, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);
  const tenantId = await targetTenantId(req, currentTenant, actor.role);
  if (tenantId instanceof Response) return tenantId;

  const body = await readJson<UpdateUserInput>(req);
  if (!body) return fail("Invalid body.");
  try {
    const user = await updateUser(tenantId, id, body, actor.role, actor.name);
    return ok(toUserAccessView(user));
  } catch (e) {
    if (e instanceof UserServiceError) return fail(e.message, e.status);
    throw e;
  }
}

// Soft-delete: deactivate the user (keeps ticket history intact).
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [currentTenant, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);
  const tenantId = await targetTenantId(req, currentTenant, actor.role);
  if (tenantId instanceof Response) return tenantId;

  try {
    const user = await deactivateUser(tenantId, id, actor.role, actor.name);
    return ok({ deactivated: true, id: user.id });
  } catch (e) {
    if (e instanceof UserServiceError) return fail(e.message, e.status);
    throw e;
  }
}

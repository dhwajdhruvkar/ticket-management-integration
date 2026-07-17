import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);

  const body = await readJson<UpdateUserInput>(req);
  if (!body) return fail("Invalid body.");
  try {
    const user = await updateUser(tenantId, id, body, actor.role, actor.name);
    return ok(user);
  } catch (e) {
    if (e instanceof UserServiceError) return fail(e.message, e.status);
    throw e;
  }
}

// Soft-delete: deactivate the user (keeps ticket history intact).
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);

  try {
    const user = await deactivateUser(tenantId, id, actor.role, actor.name);
    return ok({ deactivated: true, id: user.id });
  } catch (e) {
    if (e instanceof UserServiceError) return fail(e.message, e.status);
    throw e;
  }
}

import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import {
  deleteDepartment,
  updateDepartment,
  DepartmentServiceError,
} from "@/server/services/departmentService";
import type { Role } from "@/server/domain/models";

// PATCH/DELETE /api/v1/departments/[id] — rename/reassign or remove a
// department (admin). Users linked to a deleted department are detached.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);

  const body = await readJson<{ name?: string; description?: string | null }>(req);
  if (!body) return fail("Invalid body.");
  try {
    return ok(await updateDepartment(tenantId, id, body, actor.name));
  } catch (e) {
    if (e instanceof DepartmentServiceError) return fail(e.message, e.status);
    throw e;
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);

  const removed = await deleteDepartment(tenantId, id, actor.name);
  if (!removed) return fail("Department not found.", 404);
  return ok({ deleted: true });
}

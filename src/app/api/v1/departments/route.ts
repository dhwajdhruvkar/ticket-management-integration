import { currentActor, currentTenantId } from "@/server/context";
import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parsePagination,
  readJson,
} from "@/server/http";
import { can } from "@/server/auth/rbac";
import {
  createDepartment,
  listDepartments,
  DepartmentServiceError,
} from "@/server/services/departmentService";
import type { DepartmentRow, Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  // Agent+ may read departments (pickers); requesters cannot.
  if (!can(actor.role as Role, "report.read")) return fail("Forbidden.", 403);
  const parsed = parsePagination(req, {
    defaultSortBy: "name",
    defaultSortDir: "asc",
    allowedSortBy: ["name", "createdAt", "updatedAt"] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  const result = await listDepartments(
    tenantId,
    listOptionsFromPagination<DepartmentRow>(pagination)
  );
  return paginated(result.data, result.total, pagination);
}

export async function POST(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);

  const body = await readJson<{ name: string; description?: string }>(req);
  if (!body?.name?.trim()) return fail("name is required.");
  try {
    return ok(await createDepartment(tenantId, body, actor.name), { status: 201 });
  } catch (e) {
    if (e instanceof DepartmentServiceError) return fail(e.message, e.status);
    throw e;
  }
}

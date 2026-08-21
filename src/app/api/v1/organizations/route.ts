import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parsePagination,
  readJson,
} from "@/server/http";
import { actorContext, isResponse, requirePermission } from "@/server/guards";
import {
  createOrganization,
  listOrganizations,
  OrganizationServiceError,
} from "@/server/services/organizationService";
import type { TenantRow } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  // Only a super admin operates across organizations; a tenant admin sees the
  // one they administer, which is all the user form needs.
  const scope = ctx.role === "super_admin" ? undefined : ctx.tenantId;
  const parsed = parsePagination(req, {
    defaultSortBy: "name",
    defaultSortDir: "asc",
    allowedSortBy: ["name", "slug", "createdAt", "updatedAt"] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  const result = await listOrganizations(
    scope,
    listOptionsFromPagination<TenantRow>(pagination)
  );
  return paginated(result.data, result.total, pagination);
}

export async function POST(req: Request) {
  const { actor, role } = await actorContext(req);
  // Only a super admin can provision a new organization (tenant).
  if (role !== "super_admin") {
    return fail("Only a super admin can create organizations.", 403);
  }

  const body = await readJson<{ name: string; brand?: string; isInternal?: boolean }>(req);
  if (!body?.name?.trim()) return fail("name is required.");
  try {
    return ok(await createOrganization(body, actor.name), { status: 201 });
  } catch (e) {
    if (e instanceof OrganizationServiceError) return fail(e.message, e.status);
    throw e;
  }
}

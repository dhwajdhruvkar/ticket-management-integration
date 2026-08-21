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
import { getStore } from "@/server/data";
import {
  createUser,
  listUsers,
  UserServiceError,
  type CreateUserInput,
} from "@/server/services/userService";
import type { Role, UserRow } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  // Agent+ may list users (assignment pickers, triage, leaderboard); requesters cannot.
  if (!can(actor.role as Role, "report.read")) return fail("Forbidden.", 403);

  const url = new URL(req.url);
  const where: Partial<UserRow> = {};
  const role = url.searchParams.get("role");
  if (role) where.role = role as UserRow["role"];
  const parsed = parsePagination(req, {
    defaultSortBy: "name",
    defaultSortDir: "asc",
    allowedSortBy: [
      "name",
      "email",
      "role",
      "active",
      "createdAt",
      "updatedAt",
    ] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  const result = await listUsers(
    tenantId,
    where,
    listOptionsFromPagination<UserRow>(pagination)
  );
  return paginated(result.data, result.total, pagination);
}

export async function POST(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);

  const body = await readJson<CreateUserInput & { organizationId?: string }>(req);
  if (!body) return fail("Invalid body.");

  // super_admin may create the user in a different organization (tenant).
  let targetTenant = tenantId;
  if (body.organizationId && actor.role === "super_admin") {
    const store = await getStore();
    const org = await store.tenants.get(body.organizationId);
    if (!org) return fail("Organization not found.", 400);
    targetTenant = org.id;
  }

  try {
    const user = await createUser(targetTenant, body, actor.role, actor.name);
    return ok(user, { status: 201 });
  } catch (e) {
    if (e instanceof UserServiceError) return fail(e.message, e.status);
    throw e;
  }
}

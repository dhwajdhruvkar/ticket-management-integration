import { currentActor, currentTenantId } from "@/server/context";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parseBody,
  parsePagination,
} from "@/server/http";
import { can } from "@/server/auth/rbac";
import { getStore } from "@/server/data";
import { listUsers } from "@/server/services/userService";
import {
  accountAccessError,
  inviteUser,
  userAccessViews,
} from "@/server/services/accountAccessService";
import type { Role, UserRow } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  role: z.enum(["requester", "agent", "manager", "tenant_admin", "super_admin"]),
  title: z.string().trim().max(160).nullish(),
  departmentId: z.string().trim().max(80).nullish(),
  phone: z.string().trim().max(60).nullish(),
  location: z.string().trim().max(160).nullish(),
  timezone: z.string().trim().max(100).nullish(),
  organizationId: z.string().trim().max(80).optional(),
});

export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  // Agent+ may list users (assignment pickers, triage, leaderboard); requesters cannot.
  if (!can(actor.role as Role, "report.read")) return fail("Forbidden.", 403);

  const url = new URL(req.url);
  const requestedOrganizationId = url.searchParams.get("organizationId")?.trim();
  let targetTenant = tenantId;
  if (requestedOrganizationId && requestedOrganizationId !== tenantId) {
    if (actor.role !== "super_admin") return fail("Forbidden.", 403);
    const store = await getStore();
    if (!(await store.tenants.get(requestedOrganizationId))) {
      return fail("Organization not found.", 404);
    }
    targetTenant = requestedOrganizationId;
  }
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
    targetTenant,
    where,
    listOptionsFromPagination<UserRow>(pagination)
  );
  return paginated(
    await userAccessViews(result.data),
    result.total,
    pagination
  );
}

export async function POST(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);

  const body = await parseBody(req, CreateUserSchema);
  if (body instanceof NextResponse) return body;

  // super_admin may create the user in a different organization (tenant).
  let targetTenant = tenantId;
  if (body.organizationId && body.organizationId !== tenantId && actor.role !== "super_admin") {
    return fail("Forbidden.", 403);
  }
  if (body.organizationId && actor.role === "super_admin") {
    const store = await getStore();
    const org = await store.tenants.get(body.organizationId);
    if (!org) return fail("Organization not found.", 400);
    targetTenant = org.id;
  }

  try {
    const result = await inviteUser(
      targetTenant,
      body,
      actor.role,
      actor.name,
      new URL(req.url).origin
    );
    return ok(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const known = accountAccessError(e);
    if (known) return fail(known.message, known.status);
    throw e;
  }
}

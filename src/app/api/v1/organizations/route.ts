import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import {
  createOrganization,
  listOrganizations,
  OrganizationServiceError,
} from "@/server/services/organizationService";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const actor = await currentActor(req);
  // Admins can see the organization list (used by the super-admin user form).
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);
  return ok(await listOrganizations());
}

export async function POST(req: Request) {
  const actor = await currentActor(req);
  // Only a super admin can provision a new organization (tenant).
  if (actor.role !== "super_admin") {
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

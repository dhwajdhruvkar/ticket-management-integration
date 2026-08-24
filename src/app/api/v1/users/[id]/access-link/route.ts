import { currentActor, currentTenantId } from "@/server/context";
import { can } from "@/server/auth/rbac";
import { getStore } from "@/server/data";
import { fail, ok } from "@/server/http";
import type { Role } from "@/server/domain/models";
import {
  accountAccessError,
  generateUserAccessLink,
} from "@/server/services/accountAccessService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [currentTenant, actor] = await Promise.all([
    currentTenantId(req),
    currentActor(req),
  ]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);

  const requested = new URL(req.url).searchParams.get("organizationId")?.trim();
  let tenantId = currentTenant;
  if (requested && requested !== currentTenant) {
    if (actor.role !== "super_admin") return fail("Forbidden.", 403);
    const store = await getStore();
    if (!(await store.tenants.get(requested))) {
      return fail("Organization not found.", 404);
    }
    tenantId = requested;
  }

  try {
    return ok(
      await generateUserAccessLink(
        tenantId,
        id,
        actor.role,
        actor.name,
        new URL(req.url).origin
      ),
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const known = accountAccessError(error);
    if (known) return fail(known.message, known.status);
    throw error;
  }
}

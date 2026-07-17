import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { createChange, listChanges, type NewChangeInput } from "@/server/services/changeService";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/changes — change management (agent+).
//
// GET lists changes; POST creates one with an automatic AI risk assessment.
// =============================================================================

export async function GET(req: Request) {
  const tenantId = await currentTenantId(req);
  return ok(await listChanges(tenantId));
}

export async function POST(req: Request) {
  const tenantId = await currentTenantId(req);
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "change.write")) return fail("Forbidden.", 403);
  const body = await readJson<NewChangeInput>(req);
  if (!body?.title || !body?.description) return fail("title and description are required.");
  return ok(await createChange(tenantId, body), { status: 201 });
}

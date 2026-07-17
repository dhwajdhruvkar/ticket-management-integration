import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { createCI, linkCIs, listCIs } from "@/server/services/assetService";
import type { CIType, Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/cis — CMDB configuration items (agent+, gated by asset.write).
//
// GET lists CIs; POST either creates a CI or links a dependency edge between
// two CIs (body { link: { sourceId, targetId } }).
// =============================================================================

export async function GET(req: Request) {
  const tenantId = await currentTenantId(req);
  return ok(await listCIs(tenantId));
}

export async function POST(req: Request) {
  const tenantId = await currentTenantId(req);
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "asset.write")) return fail("Forbidden.", 403);
  const body = await readJson<{
    name?: string;
    type?: CIType;
    assetId?: string;
    link?: { sourceId: string; targetId: string; kind?: string };
  }>(req);

  if (body?.link) {
    const rel = await linkCIs(body.link.sourceId, body.link.targetId, body.link.kind);
    return rel ? ok(rel, { status: 201 }) : fail("Could not link CIs.", 400);
  }
  if (!body?.name) return fail("name is required.");
  return ok(await createCI(tenantId, { name: body.name, type: body.type, assetId: body.assetId }), { status: 201 });
}

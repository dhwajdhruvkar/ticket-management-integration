import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { createAsset, listAssets } from "@/server/services/assetService";
import type { AssetStatus, Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/assets — hardware/asset inventory (ITAM).
//
// GET lists tenant assets; POST creates one (agents, gated by asset.write).
// =============================================================================

export async function GET(req: Request) {
  const tenantId = await currentTenantId(req);
  return ok(await listAssets(tenantId));
}

export async function POST(req: Request) {
  const tenantId = await currentTenantId(req);
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "asset.write")) return fail("Forbidden.", 403);
  const body = await readJson<{ tag: string; name: string; type: string; status?: AssetStatus; owner?: string }>(req);
  if (!body?.tag || !body?.name) return fail("tag and name are required.");
  return ok(await createAsset(tenantId, body), { status: 201 });
}

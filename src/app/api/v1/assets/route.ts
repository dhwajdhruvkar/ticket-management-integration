import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parsePagination,
  readJson,
} from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { createAsset, listAssets } from "@/server/services/assetService";
import type { AssetRow, AssetStatus } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/assets — hardware/asset inventory (ITAM).
//
// GET lists tenant assets; POST creates one (agents, gated by asset.write).
// =============================================================================

export async function GET(req: Request) {
  const ctx = await requirePermission(req, "asset.read");
  if (isResponse(ctx)) return ctx;
  const parsed = parsePagination(req, {
    defaultSortBy: "tag",
    defaultSortDir: "asc",
    allowedSortBy: ["tag", "name", "type", "status", "createdAt", "updatedAt"] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  const result = await listAssets(
    ctx.tenantId,
    listOptionsFromPagination<AssetRow>(pagination)
  );
  return paginated(result.data, result.total, pagination);
}

export async function POST(req: Request) {
  const ctx = await requirePermission(req, "asset.write");
  if (isResponse(ctx)) return ctx;
  const body = await readJson<{ tag: string; name: string; type: string; status?: AssetStatus; owner?: string }>(req);
  if (!body?.tag || !body?.name) return fail("tag and name are required.");
  return ok(await createAsset(ctx.tenantId, body), { status: 201 });
}

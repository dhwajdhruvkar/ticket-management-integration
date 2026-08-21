import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parsePagination,
  readJson,
} from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { createCI, linkCIs, listCIs } from "@/server/services/assetService";
import type { CIRow, CIType } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/cis — CMDB configuration items (agent+, gated by asset.write).
//
// GET lists CIs; POST either creates a CI or links a dependency edge between
// two CIs (body { link: { sourceId, targetId } }).
// =============================================================================

export async function GET(req: Request) {
  const ctx = await requirePermission(req, "asset.read");
  if (isResponse(ctx)) return ctx;
  const parsed = parsePagination(req, {
    defaultSortBy: "name",
    defaultSortDir: "asc",
    allowedSortBy: ["name", "type", "status", "createdAt", "updatedAt"] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  const result = await listCIs(
    ctx.tenantId,
    listOptionsFromPagination<CIRow>(pagination)
  );
  return paginated(result.data, result.total, pagination);
}

export async function POST(req: Request) {
  const ctx = await requirePermission(req, "asset.write");
  if (isResponse(ctx)) return ctx;
  const body = await readJson<{
    name?: string;
    type?: CIType;
    assetId?: string;
    link?: { sourceId: string; targetId: string; kind?: string };
  }>(req);

  if (body?.link) {
    const rel = await linkCIs(body.link.sourceId, body.link.targetId, body.link.kind, ctx.tenantId);
    return rel ? ok(rel, { status: 201 }) : fail("Could not link CIs.", 400);
  }
  if (!body?.name) return fail("name is required.");
  return ok(await createCI(ctx.tenantId, { name: body.name, type: body.type, assetId: body.assetId }), {
    status: 201,
  });
}

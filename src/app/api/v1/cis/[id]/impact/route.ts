import { fail, ok } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { impactOf } from "@/server/services/assetService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/cis/[id]/impact — impact analysis for a CI: its dependent CIs and
// the tickets that reference it (what breaks downstream if this CI fails).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "asset.read");
  if (isResponse(ctx)) return ctx;
  const impact = await impactOf(id, ctx.tenantId);
  return impact ? ok(impact) : fail("CI not found.", 404);
}

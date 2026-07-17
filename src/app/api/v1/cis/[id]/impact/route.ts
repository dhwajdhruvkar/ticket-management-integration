import { fail, ok } from "@/server/http";
import { impactOf } from "@/server/services/assetService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/cis/[id]/impact — impact analysis for a CI: its dependent CIs and
// the tickets that reference it (what breaks downstream if this CI fails).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const impact = await impactOf(id);
  return impact ? ok(impact) : fail("CI not found.", 404);
}

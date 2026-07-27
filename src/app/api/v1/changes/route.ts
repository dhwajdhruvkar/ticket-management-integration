import { fail, ok, readJson } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { createChange, listChanges, type NewChangeInput } from "@/server/services/changeService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/changes — change management (agent+).
//
// GET lists changes; POST creates one with an automatic AI risk assessment.
// =============================================================================

export async function GET(req: Request) {
  const ctx = await requirePermission(req, "change.read");
  if (isResponse(ctx)) return ctx;
  return ok(await listChanges(ctx.tenantId));
}

export async function POST(req: Request) {
  const ctx = await requirePermission(req, "change.write");
  if (isResponse(ctx)) return ctx;
  const body = await readJson<NewChangeInput>(req);
  if (!body?.title || !body?.description) return fail("title and description are required.");
  return ok(await createChange(ctx.tenantId, body), { status: 201 });
}

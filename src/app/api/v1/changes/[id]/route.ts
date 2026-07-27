import { fail, ok, readJson } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import {
  ChangeStateError,
  getChangeView,
  updateChange,
} from "@/server/services/changeService";
import type { ChangeRow } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/changes/[id] — single change.
//
// GET returns the change view (with approvals); PATCH advances its lifecycle
// state (scheduled/implementing/review/closed) or edits fields (agent+).
// =============================================================================

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "change.read");
  if (isResponse(ctx)) return ctx;
  const view = await getChangeView(id, ctx.tenantId);
  return view ? ok(view) : fail("Change not found.", 404);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "change.write");
  if (isResponse(ctx)) return ctx;
  const patch = await readJson<Partial<ChangeRow>>(req);
  if (!patch) return fail("Invalid body.");
  try {
    const updated = await updateChange(id, patch, {
      tenantId: ctx.tenantId,
      actor: ctx.actor.name,
    });
    return updated ? ok(updated) : fail("Change not found.", 404);
  } catch (err) {
    if (err instanceof ChangeStateError) return fail(err.message, 409);
    throw err;
  }
}

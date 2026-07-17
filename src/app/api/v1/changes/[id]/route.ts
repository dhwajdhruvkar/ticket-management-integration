import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { getChangeView, updateChange } from "@/server/services/changeService";
import type { ChangeRow, Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/changes/[id] — single change.
//
// GET returns the change view (with approvals); PATCH advances its lifecycle
// state (scheduled/implementing/review/closed) or edits fields (agent+).
// =============================================================================

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getChangeView(id);
  return view ? ok(view) : fail("Change not found.", 404);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "change.write")) return fail("Forbidden.", 403);
  const patch = await readJson<Partial<ChangeRow>>(req);
  if (!patch) return fail("Invalid body.");
  const updated = await updateChange(id, patch);
  return updated ? ok(updated) : fail("Change not found.", 404);
}

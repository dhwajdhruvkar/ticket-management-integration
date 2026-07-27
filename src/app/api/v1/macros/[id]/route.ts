import { fail, ok, readJson } from "@/server/http";
import { isResponse, loadOwned, requirePermission } from "@/server/guards";
import { deleteMacro, updateMacro, type NewMacroInput } from "@/server/services/macroService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH/DELETE /api/v1/macros/[id] — update or remove a macro (admin).

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  const owned = await loadOwned(ctx, "macros", id, "Macro");
  if (isResponse(owned)) return owned;

  const body = await readJson<Partial<NewMacroInput>>(req);
  if (!body) return fail("Invalid body.");
  const updated = await updateMacro(id, body);
  return updated ? ok(updated) : fail("Macro not found.", 404);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  const owned = await loadOwned(ctx, "macros", id, "Macro");
  if (isResponse(owned)) return owned;

  const removed = await deleteMacro(id);
  return removed ? ok({ removed: true }) : fail("Macro not found.", 404);
}

import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { deleteMacro, updateMacro, type NewMacroInput } from "@/server/services/macroService";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH/DELETE /api/v1/macros/[id] — update or remove a macro (automation.write).

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);
  const body = await readJson<Partial<NewMacroInput>>(req);
  if (!body) return fail("Invalid body.");
  const updated = await updateMacro(id, body);
  return updated ? ok(updated) : fail("Macro not found.", 404);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);
  const removed = await deleteMacro(id);
  return removed ? ok({ removed: true }) : fail("Macro not found.", 404);
}

import { fail, ok, readJson } from "@/server/http";
import { isResponse, loadOwned, requirePermission } from "@/server/guards";
import {
  deleteCustomField,
  updateCustomField,
  type NewCustomFieldInput,
} from "@/server/services/customFieldService";

// PATCH/DELETE /api/v1/custom-fields/[id] — update or remove a custom field
// definition (admin).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  const owned = await loadOwned(ctx, "customFieldDefs", id, "Custom field");
  if (isResponse(owned)) return owned;

  const body = await readJson<Partial<NewCustomFieldInput>>(req);
  if (!body) return fail("Invalid body.");
  const updated = await updateCustomField(id, body);
  return updated ? ok(updated) : fail("Custom field not found.", 404);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  const owned = await loadOwned(ctx, "customFieldDefs", id, "Custom field");
  if (isResponse(owned)) return owned;

  const removed = await deleteCustomField(id);
  return removed ? ok({ removed: true }) : fail("Custom field not found.", 404);
}

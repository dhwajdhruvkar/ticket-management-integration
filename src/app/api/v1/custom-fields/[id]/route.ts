import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import {
  deleteCustomField,
  updateCustomField,
  type NewCustomFieldInput,
} from "@/server/services/customFieldService";
import type { Role } from "@/server/domain/models";

// PATCH/DELETE /api/v1/custom-fields/[id] — update or remove a custom field
// definition (admin).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);
  const body = await readJson<Partial<NewCustomFieldInput>>(req);
  if (!body) return fail("Invalid body.");
  const updated = await updateCustomField(id, body);
  return updated ? ok(updated) : fail("Custom field not found.", 404);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);
  const removed = await deleteCustomField(id);
  return removed ? ok({ removed: true }) : fail("Custom field not found.", 404);
}

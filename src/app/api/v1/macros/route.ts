import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can, isAgentRole } from "@/server/auth/rbac";
import { createMacro, listMacros, type NewMacroInput } from "@/server/services/macroService";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/v1/macros — agent canned responses / bulk-action presets. GET lists
// macros (any agent); POST creates one (gated by automation.write). Edits on [id].

export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!isAgentRole(actor.role as Role)) return fail("Forbidden.", 403);
  return ok(await listMacros(tenantId));
}

export async function POST(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);
  const body = await readJson<NewMacroInput>(req);
  if (!body?.name?.trim() || !body?.body?.trim()) return fail("name and body are required.");
  return ok(await createMacro(tenantId, body), { status: 201 });
}

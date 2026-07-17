import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { toggleAutomation } from "@/server/services/automationService";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/v1/automations/[id] — enable/disable (or update) an automation
// rule. Requires automation.write (admin).

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "automation.write")) return fail("Forbidden.", 403);
  const body = await readJson<{ enabled: boolean }>(req);
  if (!body || typeof body.enabled !== "boolean") return fail("enabled (boolean) is required.");
  const updated = await toggleAutomation(id, body.enabled);
  return updated ? ok(updated) : fail("Automation not found.", 404);
}

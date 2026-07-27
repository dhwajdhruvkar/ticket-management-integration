import { fail, ok, readJson } from "@/server/http";
import { isResponse, loadOwned, requirePermission } from "@/server/guards";
import { toggleAutomation } from "@/server/services/automationService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/v1/automations/[id] — enable/disable (or update) an automation
// rule. Requires automation.write (admin).

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "automation.write");
  if (isResponse(ctx)) return ctx;
  const owned = await loadOwned(ctx, "automations", id, "Automation");
  if (isResponse(owned)) return owned;

  const body = await readJson<{ enabled: boolean }>(req);
  if (!body || typeof body.enabled !== "boolean") return fail("enabled (boolean) is required.");
  const updated = await toggleAutomation(id, body.enabled, ctx.actor.name);
  return updated ? ok(updated) : fail("Automation not found.", 404);
}

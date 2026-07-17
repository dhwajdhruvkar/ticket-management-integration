import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import {
  createAutomation,
  dryRun,
  listAutomations,
  type Action,
  type RuleConditions,
} from "@/server/services/automationService";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/automations — rules engine (admin, gated by automation.write).
//
// GET lists rules (or, with ?dryRun=<ticketId>&trigger=, reports which rules
// WOULD fire for a ticket without applying them); POST creates a rule after
// validating its trigger.
// =============================================================================

export async function GET(req: Request) {
  const tenantId = await currentTenantId(req);
  const url = new URL(req.url);
  const dryRunTicket = url.searchParams.get("dryRun");
  if (dryRunTicket) {
    return ok(await dryRun(tenantId, dryRunTicket, url.searchParams.get("trigger") ?? "ticket.created"));
  }
  return ok(await listAutomations(tenantId));
}

export async function POST(req: Request) {
  const tenantId = await currentTenantId(req);
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "automation.write")) return fail("Forbidden.", 403);
  const body = await readJson<{ name: string; trigger: string; conditions: RuleConditions; actions: Action[]; enabled?: boolean }>(req);
  if (!body?.name || !body?.trigger) return fail("name and trigger are required.");
  const TRIGGERS = ["ticket.created", "ticket.updated", "sla.at_risk", "sla.breached"];
  if (!TRIGGERS.includes(body.trigger)) return fail(`trigger must be one of: ${TRIGGERS.join(", ")}.`);
  return ok(await createAutomation(tenantId, body), { status: 201 });
}

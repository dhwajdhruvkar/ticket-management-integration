import { fail, ok, readJson } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import {
  createAutomation,
  dryRun,
  listAutomations,
  type Action,
  type RuleConditions,
} from "@/server/services/automationService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// /api/v1/automations — rules engine (admin, gated by automation.write).
//
// GET lists rules (or, with ?dryRun=<ticketId>&trigger=, reports which rules
// WOULD fire for a ticket without applying them); POST creates a rule after
// validating its trigger.
// =============================================================================

const TRIGGERS = ["ticket.created", "ticket.updated", "sla.at_risk", "sla.breached"];

export async function GET(req: Request) {
  const ctx = await requirePermission(req, "automation.read");
  if (isResponse(ctx)) return ctx;
  const url = new URL(req.url);
  const dryRunTicket = url.searchParams.get("dryRun");
  if (dryRunTicket) {
    return ok(
      await dryRun(ctx.tenantId, dryRunTicket, url.searchParams.get("trigger") ?? "ticket.created")
    );
  }
  return ok(await listAutomations(ctx.tenantId));
}

export async function POST(req: Request) {
  const ctx = await requirePermission(req, "automation.write");
  if (isResponse(ctx)) return ctx;
  const body = await readJson<{
    name: string;
    trigger: string;
    conditions: RuleConditions;
    actions: Action[];
    enabled?: boolean;
  }>(req);
  if (!body?.name || !body?.trigger) return fail("name and trigger are required.");
  if (!TRIGGERS.includes(body.trigger)) return fail(`trigger must be one of: ${TRIGGERS.join(", ")}.`);
  return ok(await createAutomation(ctx.tenantId, body, ctx.actor.name), { status: 201 });
}

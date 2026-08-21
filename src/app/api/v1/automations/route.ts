import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parsePagination,
  readJson,
} from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import {
  createAutomation,
  dryRun,
  listAutomations,
  type Action,
  type RuleConditions,
} from "@/server/services/automationService";
import type { AutomationRow } from "@/server/domain/models";

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
  const parsed = parsePagination(req, {
    defaultSortBy: "name",
    defaultSortDir: "asc",
    allowedSortBy: [
      "name",
      "enabled",
      "trigger",
      "runCount",
      "createdAt",
      "updatedAt",
    ] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  const result = await listAutomations(
    ctx.tenantId,
    listOptionsFromPagination<AutomationRow>(pagination)
  );
  return paginated(result.data, result.total, pagination);
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

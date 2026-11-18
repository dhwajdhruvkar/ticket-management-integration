import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, ok, parseBody } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { isAgentRole } from "@/server/auth/rbac";
import { intakeTicket } from "@/server/services/intake";
import { TicketInputError } from "@/server/services/ticketService";
import { CREATABLE_TICKET_TYPES, checkTypeDetails } from "@/shared/ticketTypes";
import { handleTeamsActivity } from "@/server/channels/teams";
import { clientKey, rateLimit } from "@/server/rateLimit";
import { getStore } from "@/server/data";
import type { ImpactLevel, TicketChannel } from "@/server/domain/models";

// Unified inbound intake for external channels (generic webhooks, email relays,
// chat widget, Teams, monitoring alerts). One endpoint, the same AI +
// automation pipeline.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AlertSchema = z.object({
  source: z.string().max(120).optional(),
  severity: z.enum(["critical", "major", "warning", "info"]).optional(),
  ci: z.string().max(200).optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20_000).optional(),
  requesterEmail: z.string().email().optional(),
});

const IntakeSchema = z.object({
  channel: z.enum(["email", "portal", "chat", "api", "phone", "teams", "alert"]).optional(),
  subject: z.string().trim().max(300).optional(),
  body: z.string().max(50_000).optional(),
  requesterEmail: z.string().email().optional(),
  source: z.string().max(120).optional(),
  catalogItemId: z.string().max(64).optional(),
  // Only the creatable types are accepted; anything else (including legacy "problem") is a 400 from the schema.
  type: z.enum(CREATABLE_TICKET_TYPES).optional(),
  typeDetails: z.record(z.string(), z.unknown()).optional(),
  teams: z
    .object({
      text: z.string().max(10_000).optional(),
      from: z
        .object({
          name: z.string().max(200).optional(),
          aadObjectId: z.string().max(120).optional(),
          email: z.string().email().optional(),
        })
        .optional(),
    })
    .optional(),
  alert: AlertSchema.optional(),
});

// Monitoring severities -> ITIL impact x urgency (priority follows the matrix).
const SEVERITY_MAP: Record<string, { impact: ImpactLevel; urgency: ImpactLevel }> = {
  critical: { impact: "high", urgency: "high" },
  major: { impact: "high", urgency: "medium" },
  warning: { impact: "medium", urgency: "medium" },
  info: { impact: "low", urgency: "low" },
};

export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, "intake"), 30, 60_000)) {
    return fail("Rate limit exceeded. Try again shortly.", 429);
  }
  const ctx = await requirePermission(req, "ticket.create");
  if (isResponse(ctx)) return ctx;
  const { tenantId } = ctx;
  const payload = await parseBody(req, IntakeSchema);
  if (payload instanceof NextResponse) return payload;

  // A requester (or an integration acting as one) may only file as themselves;
  // otherwise anyone with portal access could raise tickets in a colleague's
  // name and then read the thread from their own queue.
  const agent = isAgentRole(ctx.role);
  if (!agent) {
    if (!ctx.actor.email) return fail("Forbidden.", 403);
    payload.requesterEmail = ctx.actor.email;
    if (payload.alert) payload.alert.requesterEmail = ctx.actor.email;
  }

  if (payload.channel === "teams" && payload.teams) {
    const reply = await handleTeamsActivity(payload.teams);
    return ok({ reply });
  }

  // Monitoring/event-management alerts: severity -> impact x urgency, and the
  // named CI is resolved against the CMDB and linked to the incident.
  if (payload.channel === "alert" && payload.alert) {
    // Alerts set impact and urgency directly, so they bypass classification and
    // can mint a P1. Only agent-level integrations may do that.
    if (!agent) return fail("Forbidden.", 403);
    const alert = payload.alert;
    if (!alert.title) return fail("alert.title is required.");
    const levels = SEVERITY_MAP[alert.severity ?? "warning"] ?? SEVERITY_MAP.warning;

    const ciIds: string[] = [];
    if (alert.ci) {
      const store = await getStore();
      const cis = await store.cis.list({ tenantId });
      const match = cis.find((c) => c.name.toLowerCase() === alert.ci!.toLowerCase());
      if (match) ciIds.push(match.id);
    }

    const ticket = await intakeTicket(tenantId, {
      type: "incident",
      subject: alert.title,
      body: alert.description ?? `Automated alert from ${alert.source ?? "monitoring"}.`,
      requesterEmail: alert.requesterEmail ?? "monitoring@netlink.local",
      channel: "api",
      source: `monitoring:${alert.source ?? "unknown"}`,
      impact: levels.impact,
      urgency: levels.urgency,
      ciIds,
      tags: ["monitoring"],
      integrationKeyId: ctx.actor.apiKeyId,
    });
    return ok(ticket, { status: 201 });
  }

  if (!payload.subject || !payload.body || !payload.requesterEmail) {
    return fail("subject, body, and requesterEmail are required.");
  }
  // A catalog request is always a service request; calls that name no type keep the old defaults.
  if (payload.catalogItemId && payload.type && payload.type !== "service_request") {
    return fail("A catalog item can only be requested as a service_request.");
  }
  const checked = checkTypeDetails(payload.catalogItemId ? "service_request" : payload.type, payload.typeDetails);
  if ("error" in checked) return fail(checked.error);
  try {
    const ticket = await intakeTicket(tenantId, {
      subject: payload.subject,
      body: payload.body,
      requesterEmail: payload.requesterEmail,
      channel: (payload.channel as TicketChannel) ?? "api",
      source: payload.source ?? "intake",
      // Omitted type stays the old default (incident, or service request for a catalog item); details are sanitized and approval is derived from the catalog item server-side.
      type: payload.catalogItemId || payload.type ? checked.type : undefined,
      typeDetails: checked.details,
      catalogItemId: payload.catalogItemId,
      integrationKeyId: ctx.actor.apiKeyId,
    });
    return ok(ticket, { status: 201 });
  } catch (error) {
    if (error instanceof TicketInputError) return fail(error.message, error.status);
    throw error;
  }
}

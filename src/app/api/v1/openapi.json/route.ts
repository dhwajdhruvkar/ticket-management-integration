import { NextResponse } from "next/server";

// =============================================================================
// GET /api/v1/openapi.json — hand-maintained OpenAPI 3.1 description of the
// REST surface. Import into Swagger UI / Postman / client generators.
// Update alongside route changes (single source below keeps review easy).
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-static";

const envelope = (dataSchema: Record<string, unknown>) => ({
  type: "object",
  properties: { ok: { type: "boolean" }, data: dataSchema, error: { type: "string" } },
});

const ID = { name: "id", in: "path", required: true, schema: { type: "string" } };

const SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Netlink Support API",
    version: "1.0.0",
    description:
      "ITSM REST API: tickets, intake, knowledge base, problems, changes, CMDB, SLA, automations, reporting, and audit. " +
      "All responses use the `{ ok, data | error }` envelope. Authenticate with a session cookie (browser) or an API key: " +
      "`Authorization: Bearer nlk_...` (create keys in Settings → API keys). Webhooks authenticate via HMAC signature headers.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      apiKey: { type: "http", scheme: "bearer", bearerFormat: "nlk_..." },
      session: { type: "apiKey", in: "cookie", name: "authjs.session-token" },
    },
    schemas: {
      Envelope: envelope({ type: "object" }),
      Ticket: {
        type: "object",
        properties: {
          id: { type: "string" },
          reference: { type: "string", example: "INC-8F3K2A" },
          type: { type: "string", enum: ["incident", "service_request", "problem", "change"] },
          subject: { type: "string" },
          status: { type: "string" },
          priority: { type: "string", enum: ["critical", "high", "medium", "low", "very_low"] },
          impact: { type: "string", enum: ["low", "medium", "high"] },
          urgency: { type: "string", enum: ["low", "medium", "high"] },
          category: { type: "string" },
          requesterEmail: { type: "string" },
          assigneeId: { type: "string" },
          assignmentGroupId: { type: "string" },
          dueResponseAt: { type: "string", format: "date-time" },
          dueResolveAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
  security: [{ apiKey: [] }, { session: [] }],
  paths: {
    "/health": { get: { summary: "Liveness probe (no auth)", responses: { "200": { description: "OK" } } } },
    "/tickets": {
      get: {
        summary: "List tickets (requesters see their own only)",
        parameters: [
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "type", in: "query", schema: { type: "string" } },
          { name: "assigneeId", in: "query", schema: { type: "string" }, description: "User id, or 'unassigned' for the dispatch queue." },
          { name: "groupId", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Ticket list" } },
      },
      post: {
        summary: "Create a ticket (runs the full intake pipeline)",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["subject", "body"],
                properties: {
                  type: { type: "string" },
                  subject: { type: "string" },
                  body: { type: "string" },
                  requesterEmail: { type: "string" },
                  category: { type: "string" },
                  impact: { type: "string" },
                  urgency: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Created ticket" }, "429": { description: "Rate limited" } },
      },
    },
    "/tickets/{id}": {
      get: { summary: "Ticket detail view (messages, events, SLA, approvals)", parameters: [ID], responses: { "200": { description: "Ticket view" }, "404": { description: "Not found" } } },
      patch: { summary: "Update ticket fields (agent)", parameters: [ID], responses: { "200": { description: "Updated" } } },
    },
    "/tickets/{id}/actions": {
      post: {
        summary: "Lifecycle actions (assign, resolve, close, reopen, accept_suggestion, feedback...)",
        parameters: [ID],
        responses: { "200": { description: "Action applied" } },
      },
    },
    "/tickets/{id}/messages": {
      post: { summary: "Append a public reply or internal note", parameters: [ID], responses: { "200": { description: "Message added" } } },
    },
    "/tickets/{id}/attachments": {
      get: { summary: "List attachments", parameters: [ID], responses: { "200": { description: "Attachment metadata" } } },
      post: {
        summary: "Upload attachments (multipart/form-data, field `file`, max 5 files / 10 MB each)",
        parameters: [ID],
        responses: { "201": { description: "Stored" }, "400": { description: "Type/size rejected" } },
      },
    },
    "/attachments/{id}": {
      get: { summary: "Download an attachment (Content-Disposition: attachment)", parameters: [ID], responses: { "200": { description: "Binary" } } },
      delete: { summary: "Delete an attachment (agent)", parameters: [ID], responses: { "200": { description: "Deleted" } } },
    },
    "/tickets/{id}/approvals": {
      get: { summary: "List approvals for a ticket", parameters: [ID], responses: { "200": { description: "Approvals" } } },
      post: { summary: "Decide a pending approval (manager/admin)", parameters: [ID], responses: { "200": { description: "Decision recorded" } } },
    },
    "/tickets/{id}/links": {
      post: { summary: "Link or unlink a related ticket ({ ticketId, action: 'link'|'unlink' })", parameters: [ID], responses: { "200": { description: "Updated ticket" } } },
    },
    "/tickets/{id}/merge": {
      post: { summary: "Merge this ticket into a target ({ targetId }); re-parents messages and cancels the source", parameters: [ID], responses: { "200": { description: "Merged" }, "400": { description: "Invalid merge" } } },
    },
    "/tickets/{id}/translate": {
      post: { summary: "Translate text in a ticket's context ({ text, targetLang })", parameters: [ID], responses: { "200": { description: "{ translated, detectedLang? }" } } },
    },
    "/intake": {
      post: {
        summary: "Unified omnichannel intake (portal/email/chat/teams/alert payloads)",
        responses: { "201": { description: "Ticket created" }, "429": { description: "Rate limited" } },
      },
    },
    "/kb": {
      get: { summary: "List knowledge articles", responses: { "200": { description: "Articles" } } },
      post: { summary: "Create an article (embeds for retrieval)", responses: { "200": { description: "Created" } } },
    },
    "/kb/search": {
      get: {
        summary: "Vector search",
        parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Hits with scores" } },
      },
    },
    "/kb/{id}": {
      patch: { summary: "Update an article (re-embeds)", parameters: [ID], responses: { "200": { description: "Updated" } } },
      delete: { summary: "Delete an article", parameters: [ID], responses: { "200": { description: "Deleted" } } },
    },
    "/problems": { get: { summary: "List problems (?metrics=1, ?suggest=1 for AI clusters)", responses: { "200": { description: "Problems" } } }, post: { summary: "Create a problem (or from an AI cluster)", responses: { "200": { description: "Created" } } } },
    "/problems/{id}": { get: { summary: "Problem detail", parameters: [ID], responses: { "200": { description: "Problem" } } }, patch: { summary: "Update (status, RCA, workaround, known error)", parameters: [ID], responses: { "200": { description: "Updated" } } } },
    "/problems/{id}/actions": { post: { summary: "Actions: link/unlink incident, publish workaround, raise change, AI RCA, add note", parameters: [ID], responses: { "200": { description: "Applied" } } } },
    "/changes": { get: { summary: "List changes", responses: { "200": { description: "Changes" } } }, post: { summary: "Create a change (AI risk-scored)", responses: { "200": { description: "Created" } } } },
    "/changes/{id}/approvals": { post: { summary: "Submit for CAB / decide an approval", parameters: [ID], responses: { "200": { description: "Recorded" } } } },
    "/assets": { get: { summary: "List assets", responses: { "200": { description: "Assets" } } }, post: { summary: "Create an asset", responses: { "200": { description: "Created" } } } },
    "/cis": { get: { summary: "List configuration items", responses: { "200": { description: "CIs" } } }, post: { summary: "Create a CI or link a dependency", responses: { "200": { description: "Created" } } } },
    "/cis/{id}/impact": { get: { summary: "Impact analysis (dependents + related tickets)", parameters: [ID], responses: { "200": { description: "Impact" } } } },
    "/groups": { get: { summary: "List assignment groups", responses: { "200": { description: "Groups" } } }, post: { summary: "Create a group (admin)", responses: { "201": { description: "Created" } } } },
    "/groups/{id}": { patch: { summary: "Update members/categories/strategy (admin)", parameters: [ID], responses: { "200": { description: "Updated" } } } },
    "/sla-policies": { get: { summary: "List SLA policies", responses: { "200": { description: "Policies" } } } },
    "/sla-policies/{id}": { patch: { summary: "Update targets / link a business calendar (admin)", parameters: [ID], responses: { "200": { description: "Updated" } } } },
    "/calendars": { get: { summary: "List business calendars", responses: { "200": { description: "Calendars" } } }, post: { summary: "Create a calendar (admin)", responses: { "201": { description: "Created" } } } },
    "/calendars/{id}": { patch: { summary: "Update a calendar (admin)", parameters: [ID], responses: { "200": { description: "Updated" } } }, delete: { summary: "Delete a calendar (admin)", parameters: [ID], responses: { "200": { description: "Deleted" } } } },
    "/automations": { get: { summary: "List automation rules", responses: { "200": { description: "Rules" } } }, post: { summary: "Create a rule (admin)", responses: { "200": { description: "Created" } } } },
    "/automations/{id}": { patch: { summary: "Toggle/update a rule (admin)", parameters: [ID], responses: { "200": { description: "Updated" } } } },
    "/macros": { get: { summary: "List macros / canned responses (agent+)", responses: { "200": { description: "Macros" } } }, post: { summary: "Create a macro (admin)", responses: { "201": { description: "Created" } } } },
    "/macros/{id}": { patch: { summary: "Update a macro (admin)", parameters: [ID], responses: { "200": { description: "Updated" } } }, delete: { summary: "Delete a macro (admin)", parameters: [ID], responses: { "200": { description: "Deleted" } } } },
    "/custom-fields": { get: { summary: "List custom field definitions (agent+)", responses: { "200": { description: "Definitions" } } }, post: { summary: "Create a custom field (admin)", responses: { "201": { description: "Created" } } } },
    "/custom-fields/{id}": { patch: { summary: "Update a custom field (admin)", parameters: [ID], responses: { "200": { description: "Updated" } } }, delete: { summary: "Delete a custom field (admin)", parameters: [ID], responses: { "200": { description: "Deleted" } } } },
    "/api-keys": { get: { summary: "List API keys (admin; hashes never returned)", responses: { "200": { description: "Keys" } } }, post: { summary: "Create a key (admin) — full secret returned once", responses: { "201": { description: "Created" } } } },
    "/api-keys/{id}": { delete: { summary: "Revoke a key (admin)", parameters: [ID], responses: { "200": { description: "Revoked" } } } },
    "/triage": { get: { summary: "Dispatcher board: unassigned queue + per-agent open-load, availability, and group memberships (manager/admin)", responses: { "200": { description: "Triage board" }, "403": { description: "Not a dispatcher" } } } },
    "/metrics": { get: { summary: "Workspace KPIs (deflection, MTTR, SLA compliance, backlog...)", responses: { "200": { description: "Metrics" } } } },
    "/reports": { get: { summary: "Per-ticket report rows (?format=csv or ?format=pdf for a downloadable report)", responses: { "200": { description: "Report (JSON, CSV, or PDF)" } } } },
    "/reports/trends": {
      get: {
        summary: "Daily created/resolved/SLA/CSAT series",
        parameters: [{ name: "days", in: "query", schema: { type: "integer", default: 30 } }],
        responses: { "200": { description: "Trend points" } },
      },
    },
    "/notifications": { get: { summary: "Current user's notification feed + unread count", responses: { "200": { description: "Feed" } } }, post: { summary: "Mark notifications read", responses: { "200": { description: "Marked" } } } },
    "/events": { get: { summary: "Server-Sent Events stream (notifications + ticket updates)", responses: { "200": { description: "text/event-stream" } } } },
    "/audit": { get: { summary: "Audit chain (?verify=1 recomputes hashes)", responses: { "200": { description: "Records / verification" } } } },
    "/users": { get: { summary: "List users", responses: { "200": { description: "Users" } } } },
    "/me": { get: { summary: "Current user profile", responses: { "200": { description: "Profile" } } }, patch: { summary: "Update profile/preferences", responses: { "200": { description: "Updated" } } } },
    "/catalog": { get: { summary: "Service request catalog", responses: { "200": { description: "Items" } } } },
  },
} as const;

export async function GET() {
  return NextResponse.json(SPEC);
}

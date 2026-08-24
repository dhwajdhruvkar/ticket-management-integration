import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/server/guards";

// =============================================================================
// GET /api/v1/openapi.json — hand-maintained OpenAPI 3.1 description of the
// REST surface. Import into Swagger UI / Postman / client generators.
// Update alongside route changes (single source below keeps review easy).
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const envelope = (dataSchema: Record<string, unknown>) => ({
  type: "object",
  properties: { ok: { type: "boolean" }, data: dataSchema, error: { type: "string" } },
});

const ID = { name: "id", in: "path", required: true, schema: { type: "string" } };
const PAGINATION = [
  {
    name: "page",
    in: "query",
    schema: { type: "integer", minimum: 1, default: 1 },
  },
  {
    name: "pageSize",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  },
  {
    name: "limit",
    in: "query",
    deprecated: true,
    description: "Legacy alias for pageSize.",
    schema: { type: "integer", minimum: 1, maximum: 100 },
  },
  { name: "sortBy", in: "query", schema: { type: "string" } },
  {
    name: "sortDir",
    in: "query",
    schema: { type: "string", enum: ["asc", "desc"] },
  },
] as const;

const BASE_SPEC = {
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
      PageMeta: {
        type: "object",
        required: ["total", "page", "pageSize", "limit", "totalPages"],
        properties: {
          total: { type: "integer", minimum: 0 },
          page: { type: "integer", minimum: 1 },
          pageSize: { type: "integer", minimum: 1, maximum: 100 },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Backward-compatible alias for pageSize.",
          },
          totalPages: { type: "integer", minimum: 0 },
        },
      },
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
          ...PAGINATION,
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
      delete: { summary: "Soft-delete a ticket (manager/admin); history and reporting are preserved", parameters: [ID], responses: { "200": { description: "Soft-deleted" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } } },
    },
    "/tickets/{id}/actions": {
      post: {
        summary: "Lifecycle actions (assign, resolve, close, reopen, escalate, accept_suggestion, feedback...)",
        parameters: [ID],
        responses: { "200": { description: "Action applied" } },
      },
    },
    "/tickets/{id}/messages": {
      post: { summary: "Append a public reply or internal note", parameters: [ID], responses: { "200": { description: "Message added" } } },
    },
    "/tickets/{id}/attachments": {
      get: { summary: "List attachments", parameters: [ID, ...PAGINATION], responses: { "200": { description: "Paginated attachment metadata" } } },
      post: {
        summary: "Upload attachments (multipart/form-data, field `file`, max 5 files / 10 MB each)",
        parameters: [ID],
        responses: {
          "201": { description: "Stored" },
          "400": { description: "Type/size rejected" },
          "503": { description: "Attachment storage is disabled" },
        },
      },
    },
    "/attachments/{id}": {
      get: { summary: "Download an attachment (Content-Disposition: attachment)", parameters: [ID], responses: { "200": { description: "Binary" }, "503": { description: "Attachment storage is disabled" } } },
      delete: { summary: "Delete an attachment (agent)", parameters: [ID], responses: { "200": { description: "Deleted" }, "503": { description: "Attachment storage is disabled" } } },
    },
    "/tickets/{id}/approvals": {
      get: { summary: "List approvals for a ticket", parameters: [ID, ...PAGINATION], responses: { "200": { description: "Paginated approvals" } } },
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
      get: { summary: "List knowledge articles", parameters: PAGINATION, responses: { "200": { description: "Paginated articles" } } },
      post: { summary: "Create an article (embeds for retrieval)", responses: { "200": { description: "Created" } } },
    },
    "/kb/search": {
      get: {
        summary: "Vector search",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
          ...PAGINATION,
          { name: "k", in: "query", deprecated: true, description: "Legacy initial page-size parameter (maximum 25).", schema: { type: "integer", minimum: 1, maximum: 25 } },
        ],
        responses: { "200": { description: "Paginated hits with scores" } },
      },
    },
    "/kb/{id}": {
      patch: { summary: "Update an article (re-embeds)", parameters: [ID], responses: { "200": { description: "Updated" } } },
      delete: { summary: "Delete an article", parameters: [ID], responses: { "200": { description: "Deleted" } } },
    },
    "/problems": { get: { summary: "List problems (?metrics=1, ?suggest=1 return non-list views)", parameters: PAGINATION, responses: { "200": { description: "Paginated problems or requested aggregate" } } }, post: { summary: "Create a problem (or from an AI cluster)", responses: { "200": { description: "Created" } } } },
    "/problems/{id}": { get: { summary: "Problem detail", parameters: [ID], responses: { "200": { description: "Problem" } } }, patch: { summary: "Update (status, RCA, workaround, known error)", parameters: [ID], responses: { "200": { description: "Updated" } } } },
    "/problems/{id}/actions": { post: { summary: "Actions: link/unlink incident, publish workaround, raise change, AI RCA, add note", parameters: [ID], responses: { "200": { description: "Applied" } } } },
    "/changes": { get: { summary: "List changes", parameters: PAGINATION, responses: { "200": { description: "Paginated changes" } } }, post: { summary: "Create a change (AI risk-scored)", responses: { "200": { description: "Created" } } } },
    "/changes/{id}/approvals": { post: { summary: "Submit for CAB / decide an approval", parameters: [ID], responses: { "200": { description: "Recorded" } } } },
    "/assets": { get: { summary: "List assets", parameters: PAGINATION, responses: { "200": { description: "Paginated assets" } } }, post: { summary: "Create an asset", responses: { "200": { description: "Created" } } } },
    "/cis": { get: { summary: "List configuration items", parameters: PAGINATION, responses: { "200": { description: "Paginated CIs" } } }, post: { summary: "Create a CI or link a dependency", responses: { "200": { description: "Created" } } } },
    "/cis/{id}/impact": { get: { summary: "Impact analysis (dependents + related tickets)", parameters: [ID], responses: { "200": { description: "Impact" } } } },
    "/groups": { get: { summary: "List assignment groups", parameters: PAGINATION, responses: { "200": { description: "Paginated groups" } } }, post: { summary: "Create a group (admin)", responses: { "201": { description: "Created" } } } },
    "/groups/{id}": { patch: { summary: "Update members/categories/strategy (admin)", parameters: [ID], responses: { "200": { description: "Updated" } } } },
    "/sla-policies": { get: { summary: "List SLA policies", parameters: PAGINATION, responses: { "200": { description: "Paginated policies" } } } },
    "/sla-policies/{id}": { patch: { summary: "Update targets / link a business calendar (admin)", parameters: [ID], responses: { "200": { description: "Updated" } } } },
    "/calendars": { get: { summary: "List business calendars", parameters: PAGINATION, responses: { "200": { description: "Paginated calendars" } } }, post: { summary: "Create a calendar (admin)", responses: { "201": { description: "Created" } } } },
    "/calendars/{id}": { patch: { summary: "Update a calendar (admin)", parameters: [ID], responses: { "200": { description: "Updated" } } }, delete: { summary: "Delete a calendar (admin)", parameters: [ID], responses: { "200": { description: "Deleted" } } } },
    "/automations": { get: { summary: "List automation rules (?dryRun returns a non-list view)", parameters: PAGINATION, responses: { "200": { description: "Paginated rules or dry-run result" } } }, post: { summary: "Create a rule (admin)", responses: { "200": { description: "Created" } } } },
    "/automations/{id}": { patch: { summary: "Toggle/update a rule (admin)", parameters: [ID], responses: { "200": { description: "Updated" } } } },
    "/macros": { get: { summary: "List macros / canned responses (agent+)", parameters: PAGINATION, responses: { "200": { description: "Paginated macros" } } }, post: { summary: "Create a macro (admin)", responses: { "201": { description: "Created" } } } },
    "/macros/{id}": { patch: { summary: "Update a macro (admin)", parameters: [ID], responses: { "200": { description: "Updated" } } }, delete: { summary: "Delete a macro (admin)", parameters: [ID], responses: { "200": { description: "Deleted" } } } },
    "/custom-fields": { get: { summary: "List custom field definitions (agent+)", parameters: PAGINATION, responses: { "200": { description: "Paginated definitions" } } }, post: { summary: "Create a custom field (admin)", responses: { "201": { description: "Created" } } } },
    "/custom-fields/{id}": { patch: { summary: "Update a custom field (admin)", parameters: [ID], responses: { "200": { description: "Updated" } } }, delete: { summary: "Delete a custom field (admin)", parameters: [ID], responses: { "200": { description: "Deleted" } } } },
    "/api-keys": { get: { summary: "List API keys (admin; hashes never returned)", parameters: PAGINATION, responses: { "200": { description: "Paginated keys" } } }, post: { summary: "Create a key (admin) — full secret returned once", responses: { "201": { description: "Created" } } } },
    "/api-keys/{id}": { delete: { summary: "Revoke a key (admin)", parameters: [ID], responses: { "200": { description: "Revoked" } } } },
    "/triage": { get: { summary: "Dispatcher board: unassigned queue, escalations, and per-agent open-load, availability and group memberships (manager+)", responses: { "200": { description: "Triage board" }, "403": { description: "Lacks ticket.dispatch" } } } },
    "/triage/assign": { post: { summary: "Bulk assign tickets (manager+); omit assigneeId to send each to its best fit", responses: { "200": { description: "Assigned + skipped ids" }, "403": { description: "Lacks ticket.dispatch" } } } },
    "/metrics": { get: { summary: "Workspace KPIs (deflection, MTTR, SLA compliance, backlog...)", responses: { "200": { description: "Metrics" } } } },
    "/reports": { get: { summary: "Per-ticket report rows (?format=csv or ?format=pdf for a downloadable report)", responses: { "200": { description: "Report (JSON, CSV, or PDF)" } } } },
    "/reports/trends": {
      get: {
        summary: "Daily created/resolved/SLA/CSAT series",
        parameters: [{ name: "days", in: "query", schema: { type: "integer", default: 30 } }],
        responses: { "200": { description: "Trend points" } },
      },
    },
    "/notifications": { get: { summary: "Current user's paginated notification feed + total unread count", parameters: PAGINATION, responses: { "200": { description: "Paginated feed" } } }, post: { summary: "Mark notifications read", responses: { "200": { description: "Marked" } } } },
    "/events": { get: { summary: "Server-Sent Events stream (notifications + ticket updates)", responses: { "200": { description: "text/event-stream" } } } },
    "/audit": { get: { summary: "Audit chain (?verify=1 returns a non-list integrity result)", parameters: PAGINATION, responses: { "200": { description: "Paginated records or verification result" } } } },
    "/users": { get: { summary: "List users", parameters: PAGINATION, responses: { "200": { description: "Paginated users" } } } },
    "/departments": { get: { summary: "List departments", parameters: PAGINATION, responses: { "200": { description: "Paginated departments" } } }, post: { summary: "Create a department (admin)", responses: { "201": { description: "Created" } } } },
    "/organizations": { get: { summary: "List organizations (admin)", parameters: PAGINATION, responses: { "200": { description: "Paginated organizations" } } }, post: { summary: "Create an organization (super admin)", responses: { "201": { description: "Created" } } } },
    "/me": { get: { summary: "Current user profile", responses: { "200": { description: "Profile" } } }, patch: { summary: "Update profile/preferences", responses: { "200": { description: "Updated" } } } },
    "/catalog": { get: { summary: "Service request catalog", parameters: PAGINATION, responses: { "200": { description: "Paginated items" } } } },
  },
} as const;

const ref = (name: string): Record<string, unknown> => ({
  $ref: "#/components/schemas/" + name,
});

const jsonContent = (schema: Record<string, unknown>) => ({
  "application/json": { schema },
});

const jsonResponse = (
  description: string,
  schema: Record<string, unknown>
) => ({
  description,
  content: jsonContent(schema),
});

const errorResponse = (description: string, error: string) => ({
  description,
  content: {
    "application/json": {
      schema: ref("ErrorResponse"),
      example: { ok: false, error },
    },
  },
});

const TICKET_STATUS = [
  "new",
  "open",
  "in_progress",
  "pending",
  "auto_resolved",
  "pending_agent",
  "escalated",
  "resolved",
  "reopened",
  "closed",
  "cancelled",
] as const;

const TICKET_TYPE = [
  "incident",
  "service_request",
  "problem",
  "change",
] as const;

const TICKET_PRIORITY = [
  "critical",
  "high",
  "medium",
  "low",
  "very_low",
] as const;

const IMPACT = ["low", "medium", "high"] as const;
const CATEGORY = [
  "IT",
  "HR",
  "Access",
  "Software",
  "Hardware",
  "Network",
  "Billing",
  "Other",
] as const;

const TICKET_PAGINATION = [
  PAGINATION[0],
  PAGINATION[1],
  PAGINATION[2],
  {
    name: "sortBy",
    in: "query",
    schema: {
      type: "string",
      enum: [
        "createdAt",
        "updatedAt",
        "reference",
        "priority",
        "status",
        "subject",
      ],
      default: "createdAt",
    },
  },
  {
    ...PAGINATION[4],
    schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
  },
] as const;

const API_KEY_PAGINATION = [
  PAGINATION[0],
  PAGINATION[1],
  PAGINATION[2],
  {
    name: "sortBy",
    in: "query",
    schema: {
      type: "string",
      enum: ["createdAt", "updatedAt", "name", "active", "role"],
      default: "createdAt",
    },
  },
  {
    ...PAGINATION[4],
    schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
  },
] as const;

const CORE_SCHEMAS = {
  ErrorResponse: {
    type: "object",
    required: ["ok", "error"],
    properties: {
      ok: { type: "boolean", const: false },
      error: { type: "string" },
    },
    additionalProperties: false,
  },
  HealthResponse: {
    type: "object",
    required: [
      "ok",
      "service",
      "version",
      "dataDriver",
      "productionProfile",
      "features",
      "time",
    ],
    properties: {
      ok: { type: "boolean", const: true },
      service: { type: "string", example: "netlink-support" },
      version: { type: "string", example: "2.0.0" },
      dataDriver: { type: "string", enum: ["memory", "prisma"] },
      productionProfile: {
        type: "object",
        required: ["authentication", "attachmentStorage"],
        properties: {
          authentication: {
            type: "string",
            enum: ["demo", "entra", "api-key-only"],
          },
          attachmentStorage: {
            type: "string",
            enum: ["local", "azure", "disabled"],
          },
        },
      },
      features: {
        type: "object",
        additionalProperties: { type: "boolean" },
      },
      time: { type: "string", format: "date-time" },
    },
  },
  Ticket: {
    type: "object",
    required: [
      "id",
      "reference",
      "tenantId",
      "type",
      "subject",
      "body",
      "status",
      "priority",
      "category",
      "channel",
      "tags",
      "requesterEmail",
      "ciIds",
      "linkedTicketIds",
      "slaPausedMins",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ],
    properties: {
      id: { type: "string", example: "tkt_example" },
      reference: { type: "string", example: "INC-8F3K2A" },
      tenantId: { type: "string" },
      type: { type: "string", enum: TICKET_TYPE },
      subject: { type: "string" },
      body: { type: "string" },
      status: { type: "string", enum: TICKET_STATUS },
      priority: { type: "string", enum: TICKET_PRIORITY },
      impact: { type: ["string", "null"], enum: [...IMPACT, null] },
      urgency: { type: ["string", "null"], enum: [...IMPACT, null] },
      category: { type: "string", enum: CATEGORY },
      subcategory: { type: ["string", "null"] },
      channel: {
        type: "string",
        enum: ["email", "portal", "chat", "api", "phone", "teams"],
      },
      source: { type: ["string", "null"] },
      tags: { type: "array", items: { type: "string" } },
      customFields: { type: ["object", "null"], additionalProperties: true },
      requesterEmail: { type: "string", format: "email" },
      requesterId: { type: ["string", "null"] },
      assigneeId: { type: ["string", "null"] },
      assignmentGroupId: { type: ["string", "null"] },
      problemId: { type: ["string", "null"] },
      changeId: { type: ["string", "null"] },
      catalogItemId: { type: ["string", "null"] },
      ciIds: { type: "array", items: { type: "string" } },
      linkedTicketIds: { type: "array", items: { type: "string" } },
      mergedIntoId: { type: ["string", "null"] },
      satisfaction: { type: ["string", "null"] },
      resolutionNotes: { type: ["string", "null"] },
      escalationReason: { type: ["string", "null"] },
      escalatedById: { type: ["string", "null"] },
      escalatedAt: { type: ["string", "null"], format: "date-time" },
      firstRespondedAt: { type: ["string", "null"], format: "date-time" },
      resolvedAt: { type: ["string", "null"], format: "date-time" },
      closedAt: { type: ["string", "null"], format: "date-time" },
      dueResponseAt: { type: ["string", "null"], format: "date-time" },
      dueResolveAt: { type: ["string", "null"], format: "date-time" },
      slaPolicyId: { type: ["string", "null"] },
      slaPausedAt: { type: ["string", "null"], format: "date-time" },
      slaPausedMins: { type: "integer", minimum: 0 },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      deletedAt: { type: ["string", "null"], format: "date-time" },
    },
  },
  TicketMessage: {
    type: "object",
    required: [
      "id",
      "ticketId",
      "authorKind",
      "authorName",
      "visibility",
      "body",
      "createdAt",
    ],
    properties: {
      id: { type: "string" },
      ticketId: { type: "string" },
      authorKind: {
        type: "string",
        enum: ["requester", "agent", "assistant", "system"],
      },
      authorName: { type: "string" },
      visibility: { type: "string", enum: ["public", "internal"] },
      body: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  TicketView: {
    allOf: [
      ref("Ticket"),
      {
        type: "object",
        required: [
          "messages",
          "events",
          "resolution",
          "assignee",
          "assignmentGroup",
          "linkedCIs",
          "approvals",
          "sla",
        ],
        properties: {
          messages: {
            type: "array",
            items: ref("TicketMessage"),
            description:
              "Internal messages are included only for agent-or-higher callers.",
          },
          events: { type: "array", items: { type: "object" } },
          resolution: { type: ["object", "null"] },
          assignee: { type: ["object", "null"] },
          assignmentGroup: { type: ["object", "null"] },
          linkedCIs: { type: "array", items: { type: "object" } },
          approvals: { type: "array", items: { type: "object" } },
          sla: { type: "object" },
        },
      },
    ],
  },
  CreateTicketRequest: {
    type: "object",
    required: ["subject", "body"],
    properties: {
      subject: { type: "string", minLength: 1, maxLength: 300 },
      body: { type: "string", minLength: 1, maxLength: 50000 },
      requesterEmail: {
        type: "string",
        format: "email",
        description:
          "Required for agent-or-higher keys. Requester keys always file as their own identity.",
      },
      type: { type: "string", enum: TICKET_TYPE, default: "incident" },
      channel: {
        type: "string",
        enum: ["email", "portal", "chat", "api", "phone", "teams"],
        default: "api",
      },
      category: { type: "string", enum: CATEGORY },
      subcategory: { type: "string" },
      impact: { type: "string", enum: IMPACT },
      urgency: { type: "string", enum: IMPACT },
      priority: { type: "string", enum: TICKET_PRIORITY },
      tags: { type: "array", items: { type: "string" } },
      source: { type: "string" },
      catalogItemId: { type: "string" },
      ciIds: { type: "array", items: { type: "string" } },
      autoResolve: { type: "boolean", default: false },
    },
    example: {
      subject: "VPN access fails after client update",
      body: "The VPN client reports an authentication error.",
      requesterEmail: "requester@example.com",
      type: "incident",
      channel: "api",
      category: "Network",
      impact: "medium",
      urgency: "high",
      tags: ["external-integration"],
      autoResolve: false,
    },
  },
  UpdateTicketRequest: {
    type: "object",
    minProperties: 1,
    properties: {
      priority: { type: "string", enum: TICKET_PRIORITY },
      priorityJustification: {
        type: "string",
        description:
          "Supply when manually overriding the impact-by-urgency derived priority.",
      },
      impact: { type: "string", enum: IMPACT },
      urgency: { type: "string", enum: IMPACT },
      category: { type: "string", enum: CATEGORY },
      subcategory: { type: ["string", "null"] },
      tags: { type: "array", items: { type: "string" } },
      status: { type: "string", enum: TICKET_STATUS },
      assignmentGroupId: { type: ["string", "null"] },
      resolutionNotes: { type: ["string", "null"] },
      ciIds: { type: "array", items: { type: "string" } },
      customFields: { type: "object", additionalProperties: true },
    },
  },
  AddMessageRequest: {
    type: "object",
    required: ["body"],
    properties: {
      body: { type: "string", minLength: 1 },
      visibility: {
        type: "string",
        enum: ["public", "internal"],
        default: "public",
        description:
          "Internal notes require ticket.write and are never returned to requesters.",
      },
      asRequester: {
        type: "boolean",
        default: false,
        description:
          "Requester-role keys always post publicly as the requester regardless of this value.",
      },
    },
  },
  ApiKey: {
    type: "object",
    required: [
      "id",
      "tenantId",
      "name",
      "prefix",
      "role",
      "active",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: { type: "string", example: "key_example" },
      tenantId: { type: "string" },
      name: { type: "string" },
      prefix: {
        type: "string",
        description: "Non-secret prefix used to identify the key.",
      },
      role: {
        type: "string",
        enum: ["requester", "agent", "manager", "tenant_admin", "super_admin"],
      },
      agentIds: { type: "array", items: { type: "string" } },
      description: { type: ["string", "null"] },
      active: { type: "boolean" },
      lastUsedAt: { type: ["string", "null"], format: "date-time" },
      expiresAt: { type: ["string", "null"], format: "date-time" },
      createdBy: { type: ["string", "null"] },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  CreatedApiKey: {
    allOf: [
      ref("ApiKey"),
      {
        type: "object",
        required: ["key"],
        properties: {
          key: {
            type: "string",
            readOnly: true,
            description:
              "Full secret returned exactly once. Store it in a secret manager.",
          },
        },
      },
    ],
  },
  CreateApiKeyRequest: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 80 },
      role: {
        type: "string",
        enum: ["requester", "agent", "manager", "tenant_admin"],
        default: "agent",
      },
      description: { type: ["string", "null"], maxLength: 300 },
      agentIds: { type: "array", items: { type: "string" } },
      expiresAt: { type: ["string", "null"], format: "date-time" },
    },
  },
  TicketResponse: {
    type: "object",
    required: ["ok", "data"],
    properties: {
      ok: { type: "boolean", const: true },
      data: ref("Ticket"),
    },
  },
  TicketViewResponse: {
    type: "object",
    required: ["ok", "data"],
    properties: {
      ok: { type: "boolean", const: true },
      data: ref("TicketView"),
    },
  },
  TicketListResponse: {
    type: "object",
    required: ["ok", "data", "meta"],
    properties: {
      ok: { type: "boolean", const: true },
      data: { type: "array", items: ref("Ticket") },
      meta: ref("PageMeta"),
    },
  },
  ApiKeyListResponse: {
    type: "object",
    required: ["ok", "data", "meta"],
    properties: {
      ok: { type: "boolean", const: true },
      data: { type: "array", items: ref("ApiKey") },
      meta: ref("PageMeta"),
    },
  },
  CreateApiKeyResponse: {
    type: "object",
    required: ["ok", "data"],
    properties: {
      ok: { type: "boolean", const: true },
      data: ref("CreatedApiKey"),
    },
  },
  DeleteTicketResponse: {
    type: "object",
    required: ["ok", "data"],
    properties: {
      ok: { type: "boolean", const: true },
      data: {
        type: "object",
        required: ["deleted"],
        properties: { deleted: { type: "boolean", const: true } },
      },
    },
  },
  RevokeApiKeyResponse: {
    type: "object",
    required: ["ok", "data"],
    properties: {
      ok: { type: "boolean", const: true },
      data: {
        type: "object",
        required: ["revoked"],
        properties: { revoked: { type: "boolean", const: true } },
      },
    },
  },
} as const;

const SPEC = {
  ...BASE_SPEC,
  info: {
    ...BASE_SPEC.info,
    version: "2.0.0",
    description:
      "Production ITSM REST API. External systems authenticate with a tenant-scoped API key using Authorization: Bearer or x-api-key. Responses use the documented success/error envelopes; the health probe is intentionally flat and unauthenticated.",
  },
  servers: [
    {
      url: "https://netlink-support.vercel.app/api/v1",
      description: "Production",
    },
    {
      url: "/api/v1",
      description: "Current origin (local development or first-party UI)",
    },
  ],
  externalDocs: {
    description: "External integration guide",
    url: "https://github.com/dhwajdhruvkar/ticket-management-integration/blob/main/docs/EXTERNAL_API_GUIDE.md",
  },
  tags: [
    { name: "Health", description: "Unauthenticated service capability probe." },
    { name: "OpenAPI", description: "Machine-readable API contract." },
    { name: "Tickets", description: "Ticket intake, retrieval, updates, and soft deletion." },
    { name: "Messages", description: "Public replies and agent-only internal notes." },
    { name: "API Keys", description: "Tenant-admin credential lifecycle." },
  ],
  components: {
    ...BASE_SPEC.components,
    securitySchemes: {
      bearerApiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "nlk_...",
        description:
          "Recommended external-system authentication. Send the full key as Authorization: Bearer <key>.",
      },
      headerApiKey: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description:
          "Alternative API-key header. Do not send both API-key forms in one request.",
      },
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "authjs.session-token",
        description:
          "First-party browser session only. External integrations should use an API key.",
      },
    },
    schemas: {
      ...BASE_SPEC.components.schemas,
      ...CORE_SCHEMAS,
    },
    responses: {
      BadRequest: errorResponse(
        "Malformed JSON, validation failure, or invalid pagination.",
        "Validation failed."
      ),
      Unauthorized: errorResponse(
        "Credentials are missing, invalid, expired, or revoked.",
        "Invalid, expired, or revoked API key."
      ),
      Forbidden: errorResponse(
        "The authenticated role lacks the required permission.",
        "Forbidden."
      ),
      NotFound: errorResponse(
        "The resource is absent or outside the caller's tenant/record scope.",
        "Ticket not found."
      ),
      BodyTooLarge: errorResponse(
        "The request body exceeds the one-megabyte JSON/text limit.",
        "Request body too large."
      ),
      RateLimited: errorResponse(
        "A fixed-window per-client limit was exceeded.",
        "Rate limit exceeded. Try again shortly."
      ),
    },
  },
  security: [
    { bearerApiKey: [] },
    { headerApiKey: [] },
    { sessionCookie: [] },
  ],
  paths: {
    ...BASE_SPEC.paths,
    "/openapi.json": {
      get: {
        tags: ["OpenAPI"],
        operationId: "getOpenApiDocument",
        summary: "Download the OpenAPI 3.1 document",
        description: "Requires ticket.read and a fully validated session or API key.",
        "x-required-permission": "ticket.read",
        responses: {
          "200": jsonResponse("OpenAPI document", { type: "object" }),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/health": {
      get: {
        tags: ["Health"],
        operationId: "getHealth",
        summary: "Read service health and enabled capabilities",
        security: [],
        responses: {
          "200": jsonResponse("Service is healthy", ref("HealthResponse")),
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/tickets": {
      get: {
        tags: ["Tickets"],
        operationId: "listTickets",
        summary: "List visible active tickets",
        description:
          "Requires ticket.read. Requester keys receive only tickets filed by their own requester identity.",
        "x-required-permission": "ticket.read",
        parameters: [
          ...TICKET_PAGINATION,
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: TICKET_STATUS },
          },
          {
            name: "type",
            in: "query",
            schema: { type: "string", enum: TICKET_TYPE },
          },
          {
            name: "assigneeId",
            in: "query",
            description:
              "User id, or unassigned for tickets without an assignee.",
            schema: { type: "string" },
          },
          { name: "groupId", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": jsonResponse("Paginated ticket list", ref("TicketListResponse")),
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      post: {
        tags: ["Tickets"],
        operationId: "createTicket",
        summary: "Create a ticket through the full intake pipeline",
        description:
          "Requires ticket.create. The intake pipeline applies classification, SLA, routing, automations, and optional AI handling.",
        "x-required-permission": "ticket.create",
        requestBody: {
          required: true,
          content: jsonContent(ref("CreateTicketRequest")),
        },
        responses: {
          "201": jsonResponse("Ticket created", ref("TicketResponse")),
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/tickets/{id}": {
      get: {
        tags: ["Tickets"],
        operationId: "getTicket",
        summary: "Get a ticket and its conversation",
        description:
          "Requires ticket.read. Agent-or-higher roles receive internal notes; requesters receive only their own ticket and public conversation.",
        "x-required-permission": "ticket.read",
        parameters: [ID],
        responses: {
          "200": jsonResponse("Ticket detail", ref("TicketViewResponse")),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      patch: {
        tags: ["Tickets"],
        operationId: "updateTicket",
        summary: "Update ticket fields",
        description:
          "Requires ticket.write (agent or higher). Impact/urgency changes recalculate priority unless an explicit priority override wins.",
        "x-required-permission": "ticket.write",
        parameters: [ID],
        requestBody: {
          required: true,
          content: jsonContent(ref("UpdateTicketRequest")),
        },
        responses: {
          "200": jsonResponse("Ticket updated", ref("TicketResponse")),
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      delete: {
        tags: ["Tickets"],
        operationId: "softDeleteTicket",
        summary: "Soft-delete a ticket",
        description:
          "Requires ticket.delete (manager or higher). The ticket row, conversation, audit history, and reporting history are preserved.",
        "x-required-permission": "ticket.delete",
        parameters: [ID],
        responses: {
          "200": jsonResponse("Ticket soft-deleted", ref("DeleteTicketResponse")),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/tickets/{id}/messages": {
      post: {
        tags: ["Messages"],
        operationId: "addTicketMessage",
        summary: "Add a public reply or internal note",
        description:
          "Requires ticket.read on the visible ticket. Public requester replies are allowed for the owning requester; agent/internal replies additionally require ticket.write. Retrieve messages through GET /tickets/{id}.",
        "x-required-permission": "ticket.read",
        parameters: [ID],
        requestBody: {
          required: true,
          content: jsonContent(ref("AddMessageRequest")),
        },
        responses: {
          "200": jsonResponse("Message added and ticket returned", ref("TicketResponse")),
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/api-keys": {
      get: {
        tags: ["API Keys"],
        operationId: "listApiKeys",
        summary: "List API-key metadata",
        description:
          "Requires admin (tenant_admin or super_admin). Full secrets and hashes are never returned.",
        "x-required-permission": "admin",
        parameters: API_KEY_PAGINATION,
        responses: {
          "200": jsonResponse("Paginated API-key metadata", ref("ApiKeyListResponse")),
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      post: {
        tags: ["API Keys"],
        operationId: "createApiKey",
        summary: "Create an API key",
        description:
          "Requires admin (tenant_admin or super_admin). The full secret is returned exactly once.",
        "x-required-permission": "admin",
        requestBody: {
          required: true,
          content: jsonContent(ref("CreateApiKeyRequest")),
        },
        responses: {
          "201": jsonResponse("API key created", ref("CreateApiKeyResponse")),
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "413": { $ref: "#/components/responses/BodyTooLarge" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/api-keys/{id}": {
      delete: {
        tags: ["API Keys"],
        operationId: "revokeApiKey",
        summary: "Revoke an API key",
        description:
          "Requires admin (tenant_admin or super_admin). Revocation is immediate and audited.",
        "x-required-permission": "admin",
        parameters: [ID],
        responses: {
          "200": jsonResponse("API key revoked", ref("RevokeApiKeyResponse")),
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
  },
} as const;

export async function GET(req: Request) {
  const ctx = await requirePermission(req, "ticket.read");
  if (isResponse(ctx)) return ctx;
  return NextResponse.json(SPEC);
}

// Additive workflow contract. Match the route validators and tenant/session guards.
import { z } from "zod";
import { WorkflowActionSchema, WorkflowSettingsSchema } from "./services/workflowService";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ "application/json": { schema } });
const body = (schema: object) => ({ required: true, content: json(schema) });
const object = { type: "object" };
const response = (description: string, schema: object = object) => ({ description, content: json({ type: "object", required: ["ok", "data"], properties: { ok: { const: true }, data: schema } }) });
const errors = {
  "400": { description: "Invalid input." }, "401": { description: "Authentication required." },
  "403": { description: "Role, tenant, session or bucket membership forbids this action." },
  "404": { description: "Resource not found in this organization." },
  "409": { description: "State conflict; refresh before retrying." }, "429": { description: "Rate limit exceeded." },
};
const id = { name: "id", in: "path", required: true, schema: { type: "string" } };
const query = (name: string, schema: object) => ({ name, in: "query", schema });
const session = [{ sessionCookie: [] }];

export const workflowSchemas = {
  WorkflowSettings: z.toJSONSchema(WorkflowSettingsSchema),
  WorkflowAction: z.toJSONSchema(WorkflowActionSchema),
  AvailabilityUpdate: { type: "object", additionalProperties: false, properties: {
    calendarId: { type: "string", maxLength: 100 }, capacity: { type: "integer", minimum: 1, maximum: 100 },
    teamsUserId: { type: "string", description: "Microsoft user UUID, or empty string to clear." },
    override: { type: "string", enum: ["available", "busy", "away"] },
    overrideUntil: { type: "string", description: "ISO date-time within the next 24 hours for Busy/Away; empty string clears an override." },
  } },
};

export const workflowPaths = {
  "/requesters": { get: { tags: ["Workflow"], operationId: "searchTenantRequesters", summary: "Search active users in the caller's organization", "x-required-permission": "report.read",
    description: "Matches name/email; at most 20 results. Free email ticket intake does not create an account.",
    parameters: [query("q", { type: "string", maxLength: 254 })],
    responses: { "200": response("Matching requesters", { type: "object", properties: { items: { type: "array", items: object }, hasMore: { type: "boolean" } } }), ...errors } } },
  "/tickets/classification": { post: { tags: ["Workflow"], operationId: "previewTicketPriority", summary: "Preview automatic impact, urgency and priority", "x-required-permission": "ticket.create",
    description: "30 requests per IP per minute. The source identifies AI or rules-based fallback. Preview is not a reservation; creation assesses the final content.",
    requestBody: body({ type: "object", required: ["subject", "body"], properties: { subject: { type: "string", minLength: 1, maxLength: 300 }, body: { type: "string", minLength: 1, maxLength: 50000 } } }),
    responses: { "200": response("Classification with source and explanation"), ...errors } } },
  "/workflow/settings": {
    get: { tags: ["Workflow"], operationId: "getWorkflowSettings", summary: "Read organization workflow settings", "x-required-permission": "report.read", responses: { "200": response("Settings", ref("WorkflowSettings")), ...errors } },
    patch: { tags: ["Workflow"], operationId: "configureWorkflow", summary: "Opt in and configure organization buckets", security: session, "x-required-permission": "admin",
      description: "Administrator browser session only. Same-tenant groups/departments and distinct active manager/RM owners are validated. Disabling affects new intake only; existing workflow tickets retain their guards.",
      requestBody: body(ref("WorkflowSettings")), responses: { "200": response("Saved settings", ref("WorkflowSettings")), ...errors } },
  },
  "/workflow/board": { get: { tags: ["Workflow"], operationId: "getWorkflowBoard", summary: "Read authorized buckets, workload and similar-case suggestions", security: session, "x-required-permission": "report.read", responses: { "200": response("Bucket board and monitoring health"), ...errors } } },
  "/workflow/alerts": { get: { tags: ["Workflow"], operationId: "getWorkflowAlerts", summary: "Read persistent unattended-ticket alerts and job/email health", security: session, "x-required-permission": "report.read", responses: { "200": response("Alerts and monitoring health"), ...errors } } },
  "/workflow/retry-emails": { post: { tags: ["Workflow"], operationId: "retryWorkflowEmails", summary: "Queue up to 100 failed tenant email deliveries for retry", security: session, "x-required-permission": "admin", responses: { "200": response("Number queued; this does not synchronously send mail"), ...errors } } },
  "/tickets/{id}/workflow": { post: { tags: ["Workflow"], operationId: "transitionTicketWorkflow", summary: "Review, route, offer or accept a ticket", security: session, "x-required-permission": "ticket.write", parameters: [id], requestBody: body(ref("WorkflowAction")),
    description: "Active staff session only. Routing requires groupId; offer requires userId; decline/release require a reason. Membership and role are checked against the current organization. Pickup/accept is atomic. Resolve through the existing ticket action endpoint after acceptance.",
    responses: { "200": response("Updated ticket", ref("Ticket")), ...errors } } },
  "/users/{id}/availability": { patch: { tags: ["Workflow"], operationId: "updateAgentAvailability", summary: "Update working hours, capacity or timed status", security: session, "x-required-permission": "ticket.write", parameters: [id], requestBody: body(ref("AvailabilityUpdate")),
    description: "Staff can change their own timed override. Only organization/platform administrators can change calendars, capacity, Teams mapping or another staff member. Available clears the manual override; it does not bypass working hours/capacity.",
    responses: { "200": response("Availability settings"), ...errors } } },
  "/metrics/agents": { get: { tags: ["Workflow"], operationId: "getAgentPerformance", summary: "Resolution activity by recorded resolver and organization-local dates", "x-required-permission": "report.read",
    parameters: [query("range", { type: "string", enum: ["week", "month", "year", "custom"], default: "week" }), query("from", { type: "string", format: "date" }), query("to", { type: "string", format: "date" })],
    description: "Custom dates are inclusive, ordered, and limited to five years. Week is Monday–Sunday. Historical records without a verified resolver are excluded; re-resolution is a new event. Live open workload is not date-filtered.", responses: { "200": response("Period and per-agent rows"), ...errors } } },
  "/account/ticket-confirmation": { servers: [{ url: "/api" }], post: { tags: ["Workflow"], operationId: "confirmTicketResolution", summary: "Use a single-use requester confirmation link", security: [],
    description: "Public, shared IP limit 10/minute. Links expire seven days after resolution. Token arrives through /ticket-confirmation#token=... and is posted only after an explicit confirm/reopen choice. GET never mutates a ticket.",
    requestBody: body({ type: "object", additionalProperties: false, required: ["token", "action"], properties: { token: { type: "string", minLength: 32, maxLength: 256 }, action: { type: "string", enum: ["confirm", "reopen"] } } }), responses: { "200": response("Confirmation outcome, without ticket PII"), ...errors } } },
  "/jobs/workflow": { servers: [{ url: "/api" }], post: { tags: ["Workflow"], operationId: "runWorkflowMaintenance", summary: "Authenticated minute trigger for monitoring and durable delivery", security: [{ cronSecret: [] }],
    description: "POST with Authorization: Bearer <CRON_SECRET>. Not a tenant API key. A database lease prevents concurrent sweeps; bounded runs resume by cursor. No request body.", responses: { "200": response("Sweep result or skipped lease"), "401": errors["401"], "503": { description: "Sweep failed; inspect deployment logs." } } } },
};

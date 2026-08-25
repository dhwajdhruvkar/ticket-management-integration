# Netlink Support External API Integration Guide

This guide is for backend-to-backend integrations with the Netlink Support REST API. It covers the production ticket workflow verified in Phase 13 and the OpenAPI contract finalized in Phase 14.

## Quick reference

| Item | Value |
|---|---|
| Production API base URL | https://netlink-support.vercel.app/api/v1 |
| Health probe | GET /health |
| OpenAPI 3.1 document | GET /openapi.json |
| Recommended authentication | Authorization: Bearer with a tenant-scoped API key |
| Alternative authentication | x-api-key header |
| Content type | application/json |
| Maximum JSON/text request body | 1 MiB |
| Browser CORS support | None; call the API from a backend |

The OpenAPI endpoint is protected in Production. Download it with the same API-key header used for other authenticated endpoints. The health endpoint is intentionally unauthenticated.

## Authentication

External systems authenticate with an API key. The key is bound to one tenant and one role.

Recommended header:

~~~http
Authorization: Bearer <api-key>
~~~

Alternative header:

~~~http
x-api-key: <api-key>
~~~

Use only one API-key header per request. Never place a key in a query string, URL, source file, browser bundle, log, ticket body, or error report.

A key begins with the Netlink key prefix, but the examples in this guide never contain a usable secret. Read the value from a secret manager or protected environment variable.

### API key setup

A tenant administrator or platform administrator creates the first integration key. Available setup paths are:

1. Sign in as a tenant administrator and open Settings ? API keys.
2. Use POST /api-keys with an existing tenant_admin or super_admin session/key.
3. If the deployment has no initial administrator credential, ask the platform owner to bootstrap one through the controlled application-operator process.

Do not insert a key hash directly into PostgreSQL. The application generates a cryptographically random secret, stores only its SHA-256 hash, returns the full key once, and records creation/deletion in the audit chain.

Create a key with an existing administrator credential:

~~~bash
curl --request POST \
  "$NETLINK_BASE_URL/api-keys" \
  --header "Authorization: Bearer $NETLINK_ADMIN_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "name": "External ticket synchronization",
    "role": "manager",
    "description": "Backend integration for the external support platform"
  }'
~~~

The response data contains the full key exactly once. Store it immediately in a secret manager. Later list calls return only non-secret metadata and the identifying prefix.

Delete a key immediately when it is replaced, exposed, or no longer required. This permanently removes the credential row while retaining its non-secret audit history:

~~~bash
curl --request DELETE \
  "$NETLINK_BASE_URL/api-keys/$KEY_ID" \
  --header "Authorization: Bearer $NETLINK_ADMIN_API_KEY"
~~~

Deleted and expired keys return HTTP 401 on permission-guarded endpoints.

## Roles and permissions

Choose the least-privileged role that supports the integration.

| Role | Ticket access | Messages | Delete tickets | Manage API keys |
|---|---|---|---|---|
| requester | Create tickets and read only tickets filed by that requester identity | Public replies on owned tickets | No | No |
| agent | Create/read/update tenant tickets | Public replies and internal notes | No | No |
| manager | Agent capabilities plus dispatch and soft delete | Public replies and internal notes | Yes | No |
| tenant_admin | Manager capabilities plus administration | Public replies and internal notes | Yes | Yes |
| super_admin | All permissions | All | Yes | Yes |

The core permissions used by this workflow are:

| Operation | Required permission |
|---|---|
| POST /tickets | ticket.create |
| GET /tickets | ticket.read |
| GET /tickets/{id} | ticket.read |
| PATCH /tickets/{id} | ticket.write |
| POST /tickets/{id}/messages | ticket.read; agent/internal replies also need ticket.write |
| DELETE /tickets/{id} | ticket.delete |
| GET/POST/DELETE API-key endpoints | admin |

Record-level security is enforced in addition to RBAC. Requester keys can access only their own tickets. Cross-tenant or non-visible resource identifiers return 404 to avoid disclosing that a record exists.

## Response envelopes

Most successful endpoints return:

~~~json
{
  "ok": true,
  "data": {}
}
~~~

Paginated list endpoints add meta:

~~~json
{
  "ok": true,
  "data": [],
  "meta": {
    "total": 0,
    "page": 1,
    "pageSize": 50,
    "limit": 50,
    "totalPages": 0
  }
}
~~~

Errors return:

~~~json
{
  "ok": false,
  "error": "Human-readable error message."
}
~~~

The health probe is the intentional exception. It is a flat capability document with ok, service, version, dataDriver, productionProfile, features, and time fields.

## Configure curl safely

The following Bash example reads the secret without putting it in shell history:

~~~bash
export NETLINK_BASE_URL="https://netlink-support.vercel.app/api/v1"
read -s -p "Netlink API key: " NETLINK_API_KEY
export NETLINK_API_KEY
echo
~~~

Use your platform's secret manager for production services. Do not commit a populated environment file.

## Create a ticket

POST /tickets runs the same intake pipeline as the existing UI: classification, SLA selection, group routing, automations, and optional AI handling.

For agent-or-higher keys, requesterEmail is required. A requester-role key is always forced to its own requester identity.

~~~bash
curl --request POST \
  "$NETLINK_BASE_URL/tickets" \
  --header "Authorization: Bearer $NETLINK_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "subject": "VPN access fails after client update",
    "body": "The VPN client reports an authentication error.",
    "requesterEmail": "requester@example.com",
    "type": "incident",
    "channel": "api",
    "category": "Network",
    "impact": "medium",
    "urgency": "high",
    "tags": ["external-integration"],
    "source": "external-support-system",
    "autoResolve": false
  }'
~~~

A successful request returns HTTP 201. Persist both data.id and data.reference in the external system. Subsequent API paths use the opaque id, not the human-readable reference.

The API currently has no idempotency-key contract. Before retrying a timed-out create request, reconcile the external system's stored mapping or search/list results to avoid duplicate tickets.

## Retrieve a ticket and its messages

~~~bash
curl \
  "$NETLINK_BASE_URL/tickets/$TICKET_ID" \
  --header "Authorization: Bearer $NETLINK_API_KEY"
~~~

The response data is the ticket detail view. It includes messages, events, SLA state, assignment data, linked CIs, approvals, and resolution data.

Agent-or-higher roles receive public and internal messages. Requesters receive only public messages on their own ticket.

There is no separate GET messages endpoint. Retrieve the conversation through GET /tickets/{id}.

## Update a ticket

PATCH /tickets/{id} requires an agent-or-higher key.

~~~bash
curl --request PATCH \
  "$NETLINK_BASE_URL/tickets/$TICKET_ID" \
  --header "Authorization: Bearer $NETLINK_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "status": "in_progress",
    "subcategory": "Remote access",
    "tags": ["external-integration", "vpn"]
  }'
~~~

Supported update fields include priority, priorityJustification, impact, urgency, category, subcategory, tags, status, assignmentGroupId, resolutionNotes, ciIds, and customFields.

Changing impact or urgency recalculates priority. If the integration explicitly overrides that derived priority, provide priorityJustification so the audit record explains the decision.

## Add a message

Add a public reply:

~~~bash
curl --request POST \
  "$NETLINK_BASE_URL/tickets/$TICKET_ID/messages" \
  --header "Authorization: Bearer $NETLINK_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "body": "We are investigating the VPN authentication failure.",
    "visibility": "public"
  }'
~~~

Add an agent-only internal note:

~~~bash
curl --request POST \
  "$NETLINK_BASE_URL/tickets/$TICKET_ID/messages" \
  --header "Authorization: Bearer $NETLINK_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "body": "Correlate this incident with the identity-provider maintenance.",
    "visibility": "internal"
  }'
~~~

Internal notes require ticket.write and are never exposed to requesters. Requester-role keys always create public requester replies.

A successful message request returns the updated ticket row. Fetch GET /tickets/{id} to read the complete conversation.

## List and paginate tickets

~~~bash
curl \
  "$NETLINK_BASE_URL/tickets?page=1&pageSize=50&sortBy=createdAt&sortDir=desc" \
  --header "Authorization: Bearer $NETLINK_API_KEY"
~~~

Ticket list query parameters:

| Parameter | Contract |
|---|---|
| page | Positive integer; default 1 |
| pageSize | 1 through 100; default 50 |
| limit | Deprecated alias for pageSize |
| sortBy | createdAt, updatedAt, reference, priority, status, or subject |
| sortDir | asc or desc; default desc |
| status | Optional ticket-status filter |
| type | Optional ticket-type filter |
| assigneeId | User id, or unassigned |
| groupId | Assignment-group id |

If both pageSize and limit are sent, their values must match. Continue while page is less than meta.totalPages. Ordering is deterministic, including a stable id tie-breaker.

## Soft-delete a test or obsolete ticket

Manager-or-higher keys can call:

~~~bash
curl --request DELETE \
  "$NETLINK_BASE_URL/tickets/$TICKET_ID" \
  --header "Authorization: Bearer $NETLINK_API_KEY"
~~~

This is a recoverable application soft delete. The record, conversation, events, audit trail, and reporting history are preserved, while normal ticket lists and detail routes hide it.

## JavaScript example

The example uses the built-in fetch API available in current Node.js releases.

~~~javascript
const baseUrl =
  process.env.NETLINK_BASE_URL ||
  "https://netlink-support.vercel.app/api/v1";
const apiKey = process.env.NETLINK_API_KEY;

if (!apiKey) {
  throw new Error("NETLINK_API_KEY is required.");
}

async function api(path, options = {}) {
  const method = options.method || "GET";
  const body = options.body;

  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      Authorization: "Bearer " + apiKey,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json();

  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || "Netlink API request failed.");
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function createAndUpdateTicket() {
  const created = await api("/tickets", {
    method: "POST",
    body: {
      subject: "VPN access fails after client update",
      body: "The VPN client reports an authentication error.",
      requesterEmail: "requester@example.com",
      type: "incident",
      channel: "api",
      category: "Network",
      impact: "medium",
      urgency: "high",
      source: "external-support-system",
      tags: ["external-integration"],
      autoResolve: false,
    },
  });

  const ticketId = created.data.id;

  await api("/tickets/" + encodeURIComponent(ticketId), {
    method: "PATCH",
    body: {
      status: "in_progress",
      subcategory: "Remote access",
    },
  });

  await api("/tickets/" + encodeURIComponent(ticketId) + "/messages", {
    method: "POST",
    body: {
      body: "Investigation started by the external support system.",
      visibility: "internal",
    },
  });

  return api("/tickets/" + encodeURIComponent(ticketId));
}

createAndUpdateTicket()
  .then((result) => {
    console.log(result.data.reference, result.data.status);
  })
  .catch((error) => {
    console.error("Netlink request failed with status", error.status);
    process.exitCode = 1;
  });
~~~

Paginate all visible tickets:

~~~javascript
async function listAllTickets() {
  const tickets = [];
  let page = 1;

  while (true) {
    const result = await api(
      "/tickets?page=" +
        page +
        "&pageSize=100&sortBy=createdAt&sortDir=desc"
    );

    tickets.push(...result.data);

    if (page >= result.meta.totalPages) {
      return tickets;
    }

    page += 1;
  }
}
~~~

Do not log full response headers or request configuration if they include Authorization.

## Error handling

| HTTP status | Meaning | Recommended action |
|---|---|---|
| 200 | Successful read/update/message/delete | Process data |
| 201 | Ticket or API key created | Persist returned identifiers; store a newly returned key once |
| 400 | Malformed JSON, missing/invalid values, or invalid pagination | Fix the request; do not retry unchanged |
| 401 | No credentials, or key is invalid, expired, or deleted | Stop and rotate/reconfigure credentials |
| 403 | Key is valid but its role lacks the required permission | Use an appropriately scoped key or change the workflow |
| 404 | Resource is absent or outside tenant/requester scope | Reconcile the stored id; do not infer cross-tenant existence |
| 413 | A selected validated-body endpoint rejected a body above 1 MiB | Reduce the payload |
| 429 | Per-client fixed-window limit exceeded | Retry with exponential backoff and jitter |
| 503 | An optional provider such as attachment storage is unavailable | Retry only after confirming the capability is enabled |
| 5xx | Unexpected server failure | Retry safe reads; reconcile before retrying creates |

Error strings are intended for diagnostics, not program control. Branch on HTTP status and the ok flag.

## Rate limiting

The current v1 safeguards are:

- Global API gateway: 200 requests per minute per client IP for /api/v1.
- POST /tickets: an additional 60 requests per minute per client IP.
- POST /api-keys: an additional 10 requests per minute per client IP.

These are fixed-window, in-memory limits scoped to a process or edge isolate. They can reset on restart and are not aggregated across horizontally scaled replicas. The API does not currently emit quota or Retry-After headers.

Treat the values as protective soft caps, not a guaranteed distributed quota. Use bounded concurrency, exponential backoff, jitter, and your own request budget. A distributed limiter is required before relying on a single global quota across replicas.

## CORS and browser clients

The supported external integration is backend-to-backend. Netlink Support intentionally does not emit a cross-origin browser CORS policy and does not provide an unauthenticated OPTIONS bypass.

Do not call the API directly from browser JavaScript:

- it would expose the API key to users and browser tooling;
- cross-origin preflight is not supported;
- the integration key belongs in a server-side secret manager.

Call Netlink Support from the external system's backend. The existing Netlink UI uses a same-origin Auth.js session.

## Health and capability detection

GET /health requires no authentication:

~~~bash
curl "$NETLINK_BASE_URL/health"
~~~

Check productionProfile and features before using optional capabilities. The current production profile reports `public-demo` browser authentication for the six approved showcase identities. External integrations still authenticate with API keys. Attachment storage remains disabled until Azure Blob credentials are configured; Microsoft Entra ID is deferred.

## Download the OpenAPI document

~~~bash
curl \
  "$NETLINK_BASE_URL/openapi.json" \
  --header "Authorization: Bearer $NETLINK_API_KEY" \
  --output netlink-support-openapi.json
~~~

The document is OpenAPI 3.1 and can be imported into Swagger UI, Postman, or a compatible client generator. The implementation and this guide remain authoritative where a tool does not understand OpenAPI 3.1 JSON Schema features.

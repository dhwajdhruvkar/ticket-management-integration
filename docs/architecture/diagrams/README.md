# Netlink Support architecture

An internal IT and HR service desk where people raise tickets and staff route, resolve and audit them under per-tenant access control.

Analysed at [`c0d86aa`](https://github.com/dhwajdhruvkar/ticket-management-integration/tree/c0d86aa14de4f19dac02a307b38c767dd417684c).

**Read from.** src/, prisma/, next.config.mjs, vercel.json, Dockerfile, docker-compose.yml, .github/workflows/ci.yml (code); README.md, docs/SERVICE_DESK_WORKFLOW.md (document); docs/IMPLEMENTATION_STATUS.md, docs/SERVICE_DESK_WORKFLOW.md (document).

> Generated from the analysis by archlens. Edit the analysis, never this file.

## What this architecture answers

### What is the system, who uses it, and where does data live

**Who talks to Netlink Support, how does a request get in, and where does a ticket end up?**

Netlink Support is one Next.js application that serves a browser UI, a REST API for customers' own systems, and webhooks for other tools. Everything funnels into a single ticket pipeline and a single datastore abstraction. Seeing the outside world and the single spine through the middle first makes the later diagrams easier to place.

People use a browser UI and customer systems call a keyed REST API; other tools post signed webhooks. All three paths converge on the unified intake pipeline, which writes through one DataStore port to PostgreSQL, and mail goes out through Graph.

[Open the diagram](landscape.architecture.html). 10 components.

| Component | Responsibility |
|---|---|
| **Browser UI** | Renders the portal, ticket console, triage board and admin screens, and talks to the server only through fetch calls to /api/v1 and one EventSource stream. |
| **API-key integrator** | A customer's own server that files and reads tickets with an nlk_ API key and receives signed callbacks about them. |
| **Webhook senders** | Other systems that push JSON events at us (Zendesk, Freshdesk, internal scripts) signed with a shared secret. |
| **Edge proxy** | Rejects page requests without a session and /api/v1 requests without any credential, and applies a coarse per-IP rate limit before any route runs. |
| **REST API /api/v1** | Validates each request, asks the guards who the caller is and what they may do, then calls one service and shapes the JSON reply. |
| **Inbound webhook routes** | Verifies each sender's signature or secret against the raw body, rate-limits by IP, and normalises the payload into a ticket request. |
| **Unified intake** | Runs every new ticket, whatever its channel, through classification, creation, SLA, acknowledgement, approval hold, routing, automation and AI triage in a fixed order. |
| **DataStore port** | Defines the one collection interface every service uses, and picks the Prisma or memory adapter once per process from DATA_DRIVER. |
| **Prisma adapter** | Implements the DataStore port against PostgreSQL through Prisma, including compare-and-set updates and transactions. |
| **PostgreSQL** | Holds every tenant's tickets, users, knowledge base, audit blocks, outbox rows and API keys in production. |

**Deliberately not shown.** The Notifier and mail providers, Brevo, Slack, Teams, Entra ID, the AI providers, Azure Blob and every background job. They have their own diagrams.

#### The long read

Start at the left edge. A person's browser runs the React UI and calls /api/v1 with a session cookie. A customer's backend calls the same API with an nlk_ key. Zendesk, Freshdesk and scripts post signed JSON to /api/webhooks instead, because those callers cannot hold a session and need the raw body for signature checks.

The first stop for API calls is the Edge proxy, which only checks that some credential is present and applies a coarse rate limit. It does not decide who you are. Webhooks skip the proxy's API check and verify their own signature.

Both routes then reach the intake service: the REST API calls it when a ticket is filed, and the webhook routes call it with a payload normalised to the same shape. That single pipeline is why a ticket from a form, an email and a script behave identically afterwards.

Everything the services read or write goes through the DataStore port. In production that is the Prisma adapter and PostgreSQL; with no database configured it is a memory adapter instead (see the deployment diagram). The REST API also reads the store directly in some routes.

Finally the Notifier records in-app notifications and, when a provider is configured, sends email, here shown through Microsoft Graph. Brevo is the alternative provider.

#### Terms used here

- **tenant**: One customer organization. Almost every row carries a tenantId and every query is filtered by the caller's tenant, so two organizations share the database but never see each other.
- **API key**: A machine credential beginning nlk_. Shown once at creation, stored only as a hash, bound to one tenant and one role.
- **demo mode**: A zero-setup mode with passwordless sign-in, an in-memory datastore and header-based impersonation. It is on by default and must be turned off for production.
- **DataStore port**: The small interface of collections (list, get, create, update, compare-and-set, transaction) that all services use. A Prisma and a memory adapter both implement it.
- **intake**: The fixed pipeline every new ticket passes through, whatever its channel: classify, create, SLA, acknowledge, hold for approval, route, run rules, AI triage.
- **SLA**: Response and resolution deadlines per priority. The clock pauses while a ticket is pending and escalates when 80% elapsed and again on breach.
- **optimistic concurrency**: Updating a row only if it still has the version you read; if someone else changed it first the update returns nothing and the caller must retry.
- **outbox**: A table of messages waiting to be sent. A worker claims rows, sends them and records the result, so a crash or provider outage delays mail instead of losing it.
- **SSE**: A one-way stream from server to browser over a long-lived HTTP response, used to push live notifications without polling.
- **embedding**: A list of numbers representing the meaning of a text, so similar texts sit close together. Without a model provider the app uses a simple hashed word-count vector instead.
- **HMAC**: A signature made from a shared secret and the message body. The receiver recomputes it to confirm the sender knows the secret and the body was not altered.
- **proxy**: The Next.js file that runs before every matched request. Here it enforces sign-in for pages and a credential-present check for the API.

### How the server code is layered

**What may call what inside the server, and what stands between a service and the database?**

The README describes a ports-and-adapters design. The question for a maintainer is whether that is true in the code: does anything bypass the DataStore port, and where is tenant scoping enforced? This diagram shows the layers as they actually import each other.

Route handlers call guards and services; services call the audit chain and the DataStore port; the port builds one adapter, and only the Prisma adapter reaches PostgreSQL. There are two leaks: sixteen route files read the store directly, and the database attachment store reaches the Prisma client without the port.

[Open the diagram](layering.architecture.html). 8 components.

| Component | Responsibility |
|---|---|
| **REST API /api/v1** | Validates each request, asks the guards who the caller is and what they may do, then calls one service and shapes the JSON reply. |
| **Unified intake** | Runs every new ticket, whatever its channel, through classification, creation, SLA, acknowledgement, approval hold, routing, automation and AI triage in a fixed order. |
| **Ticket services** | Owns ticket rows: creates them, applies every patch, appends the lifecycle event and messages, and emits the side effects of a change. |
| **DataStore port** | Defines the one collection interface every service uses, and picks the Prisma or memory adapter once per process from DATA_DRIVER. |
| **Attachment storage** | Validates attachments and stores their bytes through a blob port with local-disk (demo only), Azure Blob or database-backed adapters. |
| **Prisma adapter** | Implements the DataStore port against PostgreSQL through Prisma, including compare-and-set updates and transactions. |
| **Memory adapter** | Implements the same port in process memory, seeds demo data, and flushes the whole dataset to a JSON file on every mutation. |
| **PostgreSQL** | Holds every tenant's tickets, users, knowledge base, audit blocks, outbox rows and API keys in production. |

**Deliberately not shown.** The guards, the audit chain every service calls in the same transaction as its change, the other services (same layer, same rule) and the .data/store.json file.

#### The long read

Read top to bottom. A route handler in the REST API first calls the guards, which return who the caller is, their tenant and whether they hold the permission, or a ready-made 401, 403 or 404. Only then does the route call a service.

The services are the middle layer. Intake orchestrates the others; Ticket services own ticket rows; the SLA, routing and rules module and the other domain services handle the rest. Services call the audit chain in the same transaction as their change, so an action and its audit block commit or fail together.

Below the services is the DataStore port: one interface that lists, gets, creates, updates, compare-and-sets and transacts over collections. It builds exactly one adapter per process, chosen by configuration. The Prisma adapter talks to PostgreSQL; the memory adapter keeps data in process and flushes it to a JSON file.

The intended constraint is that only the port reaches the Prisma adapter, and enforce confirms one exception: Attachment storage imports the Prisma client directly when attachments are kept in the database, which is why it is drawn with its own arrow to the Prisma adapter. The other honest exception to the picture is the arrow from the REST API straight to the store: sixteen route files import getStore themselves. That is not a violation of the port rule, since they still go through the port, but each such route must remember its own tenant filter.

#### Terms used here

- **tenant**: One customer organization. Almost every row carries a tenantId and every query is filtered by the caller's tenant, so two organizations share the database but never see each other.
- **API key**: A machine credential beginning nlk_. Shown once at creation, stored only as a hash, bound to one tenant and one role.
- **DataStore port**: The small interface of collections (list, get, create, update, compare-and-set, transaction) that all services use. A Prisma and a memory adapter both implement it.
- **intake**: The fixed pipeline every new ticket passes through, whatever its channel: classify, create, SLA, acknowledge, hold for approval, route, run rules, AI triage.
- **SLA**: Response and resolution deadlines per priority. The clock pauses while a ticket is pending and escalates when 80% elapsed and again on breach.
- **optimistic concurrency**: Updating a row only if it still has the version you read; if someone else changed it first the update returns nothing and the caller must retry.
- **audit chain**: A per-tenant log where each block includes a hash of the previous one, so editing or deleting any past block breaks every later hash and can be detected.
- **outbox**: A table of messages waiting to be sent. A worker claims rows, sends them and records the result, so a crash or provider outage delays mail instead of losing it.
- **RAG**: Answering from a knowledge base: find the most relevant articles, give them to a language model as context, then score how well they support the answer.
- **embedding**: A list of numbers representing the meaning of a text, so similar texts sit close together. Without a model provider the app uses a simple hashed word-count vector instead.

### What happens when a ticket is filed

**What exactly happens, in order, when someone submits a new ticket through the API?**

Filing a ticket is the most important write in the system and it fans out: classification, SLA, notifications, routing, rules and AI triage all hang off it. Knowing the order tells you where a failure leaves a ticket half-processed and which steps are retried.

The proxy admits the request, the guards resolve the actor and tenant, and intake classifies the ticket, stores it with its event and audit block, then applies SLA, sends the acknowledgement, routes it and finally asks the AI to triage.

[Open the diagram](ticket-create.sequence.html). 9 participants.

| Component | Responsibility |
|---|---|
| **Browser UI** | Renders the portal, ticket console, triage board and admin screens, and talks to the server only through fetch calls to /api/v1 and one EventSource stream. |
| **Edge proxy** | Rejects page requests without a session and /api/v1 requests without any credential, and applies a coarse per-IP rate limit before any route runs. |
| **REST API /api/v1** | Validates each request, asks the guards who the caller is and what they may do, then calls one service and shapes the JSON reply. |
| **Context and guards** | Resolves the acting user and tenant from session or API key, checks the RBAC permission, and answers 404 for rows in another tenant. |
| **Unified intake** | Runs every new ticket, whatever its channel, through classification, creation, SLA, acknowledgement, approval hold, routing, automation and AI triage in a fixed order. |
| **AI resolver** | Classifies tickets and runs retrieve-generate-score-decide against the knowledge base, choosing auto-resolve, suggest or escalate. |
| **Ticket services** | Owns ticket rows: creates them, applies every patch, appends the lifecycle event and messages, and emits the side effects of a change. |
| **SLA and routing** | Computes SLA clocks and pauses, routes tickets to assignment groups, fires automation rules and holds tickets for approval. |
| **DataStore port** | Defines the one collection interface every service uses, and picks the Prisma or memory adapter once per process from DATA_DRIVER. |

**Deliberately not shown.** The guards' own tenant and user lookup in the store, the audit block written with the insert, the acknowledgement email, idempotency-key handling and approval holds. A catalog item that needs approval stops after the acknowledgement and resumes the routing and triage steps once approved.

In order:

*Admit*

1. **Browser UI → Edge proxy**: POST /api/v1/tickets. A session cookie and JSON or multipart bodies. Never a database credential or another tenant's id as authority.

*Authorise*

2. **REST API /api/v1 → Context and guards**: requirePermission(). The Request and a permission name; back comes the actor, role and tenant, or a ready 401/403 response.
3. **Context and guards ⇢ REST API /api/v1**: actor, role, tenant

*Classify*

4. **REST API /api/v1 → Unified intake**: intakeTicket(). A validated ticket request and the tenant id taken from the guard, never from the body.
5. **Unified intake → AI resolver**: classify and auto-tag. Subject and body in; category, impact, urgency and tags out; later a ticket id for resolution.
6. **AI resolver ⇢ Unified intake**: classification

*Persist*

7. **Unified intake → Ticket services**: createTicket(). A fully classified ticket request; the stored ticket row comes back.
8. **Ticket services → DataStore port**: ticket + event rows. Ticket, event and delivery rows written in one store transaction.

*Policies*

9. **Unified intake → SLA and routing**: apply SLA due dates. The new ticket, to stamp due dates, hold for approval, pick an assignment group and fire rules.
10. **Unified intake → SLA and routing**: SLA, routing and rules. The new ticket, to stamp due dates, hold for approval, pick an assignment group and fire rules.

*Triage*

11. **Unified intake → AI resolver**: AI triage. Subject and body in; category, impact, urgency and tags out; later a ticket id for resolution.

#### The long read

The browser posts to /api/v1/tickets. The proxy checks only that a session or key is present, then hands the request to the route.

The route calls requirePermission. The guards read the Auth.js session or verify the API key, look up the tenant and user in the store, and return the actor, role and tenant. Note that the tenant comes from here and never from the request body. Requesters are forced to file as themselves; manual priority needs an override reason.

Intake first classifies the ticket: the AI module proposes category, impact, urgency and tags, using the requester's VIP flag as an input. Then Ticket services create the ticket. The insert, the lifecycle event, any outbox rows and the audit block are written in one store transaction, so they commit together.

Next come the policy steps, each wrapped so a failure is retried and, if it keeps failing, written to the audit chain rather than lost: SLA due dates, an acknowledgement to the requester (for non-workflow tickets), then routing to an assignment group and automation rules. Finally, if the ticket is still open and is an incident or request, the AI triage runs. The route returns the stored ticket row up the chain.

#### Terms used here

- **tenant**: One customer organization. Almost every row carries a tenantId and every query is filtered by the caller's tenant, so two organizations share the database but never see each other.
- **RBAC**: A table of which roles hold which permissions (ticket.read, ticket.write, admin and so on). Roles rise from requester to agent, manager, tenant admin and super admin.
- **API key**: A machine credential beginning nlk_. Shown once at creation, stored only as a hash, bound to one tenant and one role.
- **demo mode**: A zero-setup mode with passwordless sign-in, an in-memory datastore and header-based impersonation. It is on by default and must be turned off for production.
- **DataStore port**: The small interface of collections (list, get, create, update, compare-and-set, transaction) that all services use. A Prisma and a memory adapter both implement it.
- **intake**: The fixed pipeline every new ticket passes through, whatever its channel: classify, create, SLA, acknowledge, hold for approval, route, run rules, AI triage.
- **SLA**: Response and resolution deadlines per priority. The clock pauses while a ticket is pending and escalates when 80% elapsed and again on breach.
- **audit chain**: A per-tenant log where each block includes a hash of the previous one, so editing or deleting any past block breaks every later hash and can be detected.
- **outbox**: A table of messages waiting to be sent. A worker claims rows, sends them and records the result, so a crash or provider outage delays mail instead of losing it.
- **SSE**: A one-way stream from server to browser over a long-lived HTTP response, used to push live notifications without polling.
- **RAG**: Answering from a knowledge base: find the most relevant articles, give them to a language model as context, then score how well they support the answer.
- **proxy**: The Next.js file that runs before every matched request. Here it enforces sign-in for pages and a credential-present check for the API.

### How tickets arrive from email, chat and other tools

**How does a ticket from email, Slack, Teams or another help-desk reach intake, and how is each one authenticated?**

The portal is only one way in. Email is the main one, but chat and other helpdesks also create tickets. Each channel proves who it is differently, and each ends in the same intake call. Knowing which is push and which is poll explains why some need a scheduled job.

Zendesk, Freshdesk and scripts post signed JSON to webhook routes; Brevo pushes parsed mail and Slack posts signed events to the same route family; Graph mail is polled by the scheduler; Teams calls the authenticated /intake API. All end in intake.

[Open the diagram](inbound.architecture.html). 9 components.

| Component | Responsibility |
|---|---|
| **Webhook senders** | Other systems that push JSON events at us (Zendesk, Freshdesk, internal scripts) signed with a shared secret. |
| **Brevo** | Optional email provider: pushes parsed inbound mail to a webhook and delivers our outbound transactional mail. |
| **Slack** | Optional chat channel: sends events and slash commands in, receives our notifications through an incoming-webhook URL. |
| **Microsoft Teams** | Optional chat channel: a bot posts activities in, and a webhook URL receives our notifications. |
| **Inbound webhook routes** | Verifies each sender's signature or secret against the raw body, rate-limits by IP, and normalises the payload into a ticket request. |
| **REST API /api/v1** | Validates each request, asks the guards who the caller is and what they may do, then calls one service and shapes the JSON reply. |
| **Channel adapters** | Turns mailbox messages, Slack events and Teams activities into intake calls, de-duplicating mail and attaching replies to the right thread. |
| **Legacy scheduler** | On boot starts an interval that sweeps SLA breaches, auto-closes stale tickets, sends digests and reports, retries callbacks and polls the mailbox. |
| **Unified intake** | Runs every new ticket, whatever its channel, through classification, creation, SLA, acknowledgement, approval hold, routing, automation and AI triage in a fixed order. |

**Deliberately not shown.** Outbound mail and notifications (delivery diagram), and the Graph mailbox itself, which the Channel adapters poll over HTTPS.

#### The long read

Four of the five inbound paths are pushes. Webhook senders (Zendesk, Freshdesk, internal scripts) post JSON with an HMAC signature; the route verifies it against the raw body and normalises the payload through a per-source adapter, then calls intake. Slack posts signed events and a slash command to its own route, verified with Slack's own signing scheme. Brevo pushes parsed email, but it cannot sign requests, so its route accepts a shared secret in the query string or a header.

Teams is the odd one: its bot posts an activity object to the normal /api/v1/intake API, which means it must carry a valid session or key like any other API call. The route hands the activity to the Teams channel module.

Graph mail is a pull. The Legacy scheduler calls the mailbox poll every five minutes, but only when Graph is the active email provider. The email module de-duplicates by Message-ID, writing a ledger row before processing so a crash cannot ingest twice, drops auto-replies and loops, matches reply threads to existing tickets, and otherwise creates a new ticket through intake.

In demo mode, webhooks with no configured secret are open. In production they are rejected.

#### Terms used here

- **tenant**: One customer organization. Almost every row carries a tenantId and every query is filtered by the caller's tenant, so two organizations share the database but never see each other.
- **demo mode**: A zero-setup mode with passwordless sign-in, an in-memory datastore and header-based impersonation. It is on by default and must be turned off for production.
- **intake**: The fixed pipeline every new ticket passes through, whatever its channel: classify, create, SLA, acknowledge, hold for approval, route, run rules, AI triage.
- **SLA**: Response and resolution deadlines per priority. The clock pauses while a ticket is pending and escalates when 80% elapsed and again on breach.
- **HMAC**: A signature made from a shared secret and the message body. The receiver recomputes it to confirm the sender knows the secret and the body was not altered.

### How the AI decides to resolve, suggest or escalate

**When the AI looks at a ticket, what does it read, what leaves the system, and what is it allowed to do?**

The AI step can close a ticket without a human. That is the part of the system with the most risk to a requester, and it sends ticket text to a third party. This diagram shows what is retrieved, what is sent out, what is written down, and the guardrails on acting.

It embeds the ticket, retrieves published knowledge-base articles, asks the model to answer only from them, scores confidence, records the evidence on the audit chain, and then acts: auto-resolve at 0.78 or more, draft at 0.55 or more, otherwise escalate. P1 and workflow tickets never auto-resolve.

[Open the diagram](ai-resolution.sequence.html). 7 participants.

| Component | Responsibility |
|---|---|
| **Unified intake** | Runs every new ticket, whatever its channel, through classification, creation, SLA, acknowledgement, approval hold, routing, automation and AI triage in a fixed order. |
| **AI resolver** | Classifies tickets and runs retrieve-generate-score-decide against the knowledge base, choosing auto-resolve, suggest or escalate. |
| **LLM gateway** | Picks the model provider by configuration and falls back to a deterministic offline template and hashed embeddings so triage never breaks. |
| **LLM providers** | Optional hosted models that write grounded answers and embeddings; absent, an offline template and hashed embeddings stand in. |
| **DataStore port** | Defines the one collection interface every service uses, and picks the Prisma or memory adapter once per process from DATA_DRIVER. |
| **Audit chain** | Appends each audited action as a block hashed with its predecessor, inside the caller's transaction, and can recompute the chain to expose tampering. |
| **Ticket services** | Owns ticket rows: creates them, applies every patch, appends the lifecycle event and messages, and emits the side effects of a change. |

**Deliberately not shown.** The persisted resolution with its citations. The fallback path is also not drawn: with no provider configured, an offline template and hashed embeddings are used and the same steps run.

In order:

*Retrieve*

1. **Unified intake → AI resolver**: resolveTicket(ticketId). Subject and body in; category, impact, urgency and tags out; later a ticket id for resolution.
2. **AI resolver → LLM gateway**: embed ticket text. Text to embed or a prompt of ticket plus knowledge-base context.
3. **LLM gateway → LLM providers**: embeddings request. Ticket text and retrieved article text leave the system; vectors and answers come back. Keys stay server-side.
4. **LLM providers ⇢ LLM gateway**: vector or fallback
5. **AI resolver → DataStore port**: load KB articles. Published articles in; one resolution and its citations out, replacing any earlier run.
6. **AI resolver → Audit chain**: ticket.retrieval. ticket.retrieval with hit scores, then ticket.decision.* with confidence and reasoning.

*Generate*

7. **AI resolver → LLM gateway**: answer from context. Text to embed or a prompt of ticket plus knowledge-base context.
8. **LLM gateway → LLM providers**: chat completion. Ticket text and retrieved article text leave the system; vectors and answers come back. Keys stay server-side.
9. **LLM providers ⇢ LLM gateway**: answer or ESCALATE

*Decide*

10. **AI resolver → Audit chain**: decision + confidence. ticket.retrieval with hit scores, then ticket.decision.* with confidence and reasoning.

*Act*

11. **AI resolver → Ticket services**: reply, auto_resolved. An assistant message and a status change, but only when the decision is auto-resolve or suggest.

#### The long read

Intake calls the resolver with a ticket id. The resolver first turns the subject and body into an embedding. That text goes through the LLM gateway to Azure OpenAI, Gemini or Groq if one is configured; otherwise a local hashed embedding is used and nothing leaves the system.

The resolver loads the tenant's published knowledge-base articles from the store and ranks them by cosine similarity. It writes a ticket.retrieval block to the audit chain with the article ids and scores, so a reviewer can later see exactly what the AI was shown.

Next it asks the gateway to answer using only that context, and to reply 'ESCALATE' if the context does not cover the question. If no provider is available, a deterministic template built from the top article is used.

The resolver then computes a confidence score from how relevant the top hit is and how clearly it beats the second. It saves the resolution and its citations and appends the decision to the audit chain. Only then does it act. At 0.78 or more on an ordinary ticket it posts the answer and marks the ticket auto-resolved. Between 0.55 and 0.78, or for P1, it only drafts a suggestion and sets the ticket to pending an agent. Anything lower escalates. A ticket in the bucket workflow is always only suggested.

#### Terms used here

- **tenant**: One customer organization. Almost every row carries a tenantId and every query is filtered by the caller's tenant, so two organizations share the database but never see each other.
- **DataStore port**: The small interface of collections (list, get, create, update, compare-and-set, transaction) that all services use. A Prisma and a memory adapter both implement it.
- **intake**: The fixed pipeline every new ticket passes through, whatever its channel: classify, create, SLA, acknowledge, hold for approval, route, run rules, AI triage.
- **SLA**: Response and resolution deadlines per priority. The clock pauses while a ticket is pending and escalates when 80% elapsed and again on breach.
- **bucket workflow**: An optional per-tenant flow where new tickets land in a Service Desk queue, are routed to a department queue, then picked up or offered to a person, resolved, and confirmed by the requester.
- **audit chain**: A per-tenant log where each block includes a hash of the previous one, so editing or deleting any past block breaks every later hash and can be detected.
- **outbox**: A table of messages waiting to be sent. A worker claims rows, sends them and records the result, so a crash or provider outage delays mail instead of losing it.
- **SSE**: A one-way stream from server to browser over a long-lived HTTP response, used to push live notifications without polling.
- **RAG**: Answering from a knowledge base: find the most relevant articles, give them to a language model as context, then score how well they support the answer.
- **embedding**: A list of numbers representing the meaning of a text, so similar texts sit close together. Without a model provider the app uses a simple hashed word-count vector instead.

### How a bucket workflow transition is applied

**When staff act on a ticket in the bucket workflow, what is checked, what is written, and what happens after commit?**

In the bucket workflow a ticket moves between the Service Desk and department queues and the system must never lose or double-apply a move. This is the safest-by-construction part of the codebase, and it shows the pattern the rest could follow.

The route calls transitionWorkflow, which does everything in one transaction: it checks the actor and phase, applies a compare-and-set on the ticket's workflow version, queues emails and callbacks, and appends an audit block. The live event is published only after commit.

[Open the diagram](workflow-transition.sequence.html). 9 participants.

| Component | Responsibility |
|---|---|
| **Browser UI** | Renders the portal, ticket console, triage board and admin screens, and talks to the server only through fetch calls to /api/v1 and one EventSource stream. |
| **Edge proxy** | Rejects page requests without a session and /api/v1 requests without any credential, and applies a coarse per-IP rate limit before any route runs. |
| **REST API /api/v1** | Validates each request, asks the guards who the caller is and what they may do, then calls one service and shapes the JSON reply. |
| **Bucket workflow** | Moves a ticket between the Service Desk and department buckets through guarded transitions with optimistic concurrency, and measures bucket health. |
| **DataStore port** | Defines the one collection interface every service uses, and picks the Prisma or memory adapter once per process from DATA_DRIVER. |
| **Email outbox** | Holds workflow emails as delivery rows and sends them in bounded batches, with leases and exponential backoff, so a failed send is retried rather than lost. |
| **Callbacks** | Queues and delivers signed ticket events to each API key's webhook URL, refusing private addresses and redirects, and retries failures. |
| **Audit chain** | Appends each audited action as a block hashed with its predecessor, inside the caller's transaction, and can recompute the chain to expose tampering. |
| **Event bus** | Fans notification and ticket-updated events out to every open SSE connection in the same process. |

**Deliberately not shown.** The guards call (the route performs it before the service) and the individual action rules: claim_review, route, offer, pickup, accept, decline, release and return_to_service_desk, which differ only in their phase and role checks.

In order:

*Admit*

1. **Browser UI → Edge proxy**: POST /tickets/:id/workflow. A session cookie and JSON or multipart bodies. Never a database credential or another tenant's id as authority.

*Transition*

2. **REST API /api/v1 → Bucket workflow**: transitionWorkflow(action). A workflow action (claim, route, accept, release, return) with the staff actor.

*One transaction*

3. **Bucket workflow → DataStore port**: load ticket, group, settings. Ticket rows updated by compare-and-set on workflowVersion inside one transaction.
4. **Bucket workflow → DataStore port**: updateIf(workflowVersion). Ticket rows updated by compare-and-set on workflowVersion inside one transaction.
5. **Bucket workflow → Email outbox**: queue lifecycle email. Lifecycle and misrouting notices written inside the transition's transaction.
6. **Bucket workflow → Callbacks**: queue ticket.updated callback. A callback payload queued inside the transaction.
7. **Bucket workflow → Audit chain**: append workflow.action. One block per transition naming actor, phase and group.

*After commit*

8. **Bucket workflow → Event bus**: publish ticket.updated. Published only after the transaction commits.
9. **Bucket workflow ⇢ REST API /api/v1**: updated ticket

#### The long read

The browser posts an action name, such as claim_review or route, to the ticket's workflow endpoint. After the proxy and the usual guards, the route calls transitionWorkflow.

Inside one store transaction the service loads the ticket, checks that it exists in the caller's tenant and is not finished or on hold, confirms the actor is an active staff member of that tenant, and then applies the rule for the action. For example, only a dispatcher can offer a ticket, and only the assignee or a manager can release one.

The write is a compare-and-set on the ticket's workflowVersion. If another person changed the ticket in the meantime the update returns nothing and the caller sees 'Ticket changed. Refresh and try again', rather than silently overwriting.

In the same transaction the service queues the lifecycle email in the outbox, queues a ticket.updated callback for subscribed API keys, and appends an audit block. If anything fails, none of it is kept. Only after the transaction commits does the service publish the live event, so no browser is told about a change that was rolled back.

SLA warnings and escalations for tickets in a bucket are not done here. They come from the workflow maintenance sweep (see the background-work diagram).

#### Terms used here

- **tenant**: One customer organization. Almost every row carries a tenantId and every query is filtered by the caller's tenant, so two organizations share the database but never see each other.
- **API key**: A machine credential beginning nlk_. Shown once at creation, stored only as a hash, bound to one tenant and one role.
- **demo mode**: A zero-setup mode with passwordless sign-in, an in-memory datastore and header-based impersonation. It is on by default and must be turned off for production.
- **DataStore port**: The small interface of collections (list, get, create, update, compare-and-set, transaction) that all services use. A Prisma and a memory adapter both implement it.
- **SLA**: Response and resolution deadlines per priority. The clock pauses while a ticket is pending and escalates when 80% elapsed and again on breach.
- **bucket workflow**: An optional per-tenant flow where new tickets land in a Service Desk queue, are routed to a department queue, then picked up or offered to a person, resolved, and confirmed by the requester.
- **optimistic concurrency**: Updating a row only if it still has the version you read; if someone else changed it first the update returns nothing and the caller must retry.
- **audit chain**: A per-tenant log where each block includes a hash of the previous one, so editing or deleting any past block breaks every later hash and can be detected.
- **outbox**: A table of messages waiting to be sent. A worker claims rows, sends them and records the result, so a crash or provider outage delays mail instead of losing it.
- **lease**: A time-limited claim on a job so only one process runs it at a time. If the holder dies, the claim expires and another can take over.
- **SSE**: A one-way stream from server to browser over a long-lived HTTP response, used to push live notifications without polling.
- **HMAC**: A signature made from a shared secret and the message body. The receiver recomputes it to confirm the sender knows the secret and the body was not altered.
- **SSRF**: Server-side request forgery: tricking a server into calling an internal address. Outbound callbacks block private IPs and redirects to prevent it.
- **proxy**: The Next.js file that runs before every matched request. Here it enforces sign-in for pages and a credential-present check for the API.

### How a request is identified and kept in its tenant

**How does the system know who is calling and which organization's data they may touch?**

This is a multi-tenant system with three kinds of caller: signed-in people, API keys and (in demo mode) unauthenticated headers. A mistake here shows one customer another's tickets, so it is worth seeing where each decision is made and which are skippable.

The proxy rejects credential-less traffic early. Then the guards read the Auth.js session or verify an API key hash to get the actor, role and tenant; RBAC checks the permission; and tenant mismatches answer 404. Demo mode adds header fallbacks and is on by default.

[Open the diagram](identity.architecture.html). 8 components.

| Component | Responsibility |
|---|---|
| **Browser UI** | Renders the portal, ticket console, triage board and admin screens, and talks to the server only through fetch calls to /api/v1 and one EventSource stream. |
| **API-key integrator** | A customer's own server that files and reads tickets with an nlk_ API key and receives signed callbacks about them. |
| **Microsoft Entra ID** | Optional OpenID Connect identity provider; its presence also switches demo mode off. |
| **Edge proxy** | Rejects page requests without a session and /api/v1 requests without any credential, and applies a coarse per-IP rate limit before any route runs. |
| **Auth.js sessions** | Signs people in (demo, organization password or Entra ID) and issues the JWT session carrying user id, role and tenant. |
| **REST API /api/v1** | Validates each request, asks the guards who the caller is and what they may do, then calls one service and shapes the JSON reply. |
| **Context and guards** | Resolves the acting user and tenant from session or API key, checks the RBAC permission, and answers 404 for rows in another tenant. |
| **API key service** | Mints, verifies and revokes nlk_ machine keys, storing only a SHA-256 hash and binding each key to one tenant and role. |

**Deliberately not shown.** The datastore lookups behind sign-in and key checks, webhook authentication (see the inbound diagram), the config module that decides demo mode, and the individual permissions in the RBAC matrix.

#### The long read

Two layers decide identity. The first is the Edge proxy. For pages it redirects to the sign-in screen if there is no session. For /api/v1 it only checks that a session or an nlk_ key header is present and returns a JSON 401 if not. It also applies a per-IP limit. In demo mode it admits everything.

The second layer is the Context and guards module, called by each route through requirePermission. It resolves the actor in order: the Auth.js session (signed in by demo credentials, an organization account, or Entra ID SSO); else a presented API key, verified by hashing it and looking up the hash in the store; else, only in demo mode, an x-actor header or the seeded admin. A key that is presented but invalid never falls back to anyone, and in production anything else becomes an actor with no permissions.

The tenant comes from the session or the key, never from the request body, and the role comes from the same source. Admins can impersonate lower-ranked users in their own tenant by header, but API keys cannot. The guards then check the RBAC permission, and for any record addressed by id they check it belongs to the caller's tenant, answering 404 rather than 403 if not.

The configuration module decides whether demo mode is on. It defaults to on unless Entra ID is configured or DEMO_MODE=false.

#### Terms used here

- **tenant**: One customer organization. Almost every row carries a tenantId and every query is filtered by the caller's tenant, so two organizations share the database but never see each other.
- **RBAC**: A table of which roles hold which permissions (ticket.read, ticket.write, admin and so on). Roles rise from requester to agent, manager, tenant admin and super admin.
- **API key**: A machine credential beginning nlk_. Shown once at creation, stored only as a hash, bound to one tenant and one role.
- **demo mode**: A zero-setup mode with passwordless sign-in, an in-memory datastore and header-based impersonation. It is on by default and must be turned off for production.
- **DataStore port**: The small interface of collections (list, get, create, update, compare-and-set, transaction) that all services use. A Prisma and a memory adapter both implement it.
- **SSE**: A one-way stream from server to browser over a long-lived HTTP response, used to push live notifications without polling.
- **proxy**: The Next.js file that runs before every matched request. Here it enforces sign-in for pages and a credential-present check for the API.

### What runs without a user request

**Which jobs run on their own, what triggers them, and what stops two copies colliding?**

SLAs, escalations, digests, mail polling and email delivery all need something to run on a clock. There are two separate mechanisms with different guarantees, and they behave differently on a long-running server and on serverless hosting.

Two runners exist. A legacy scheduler started at boot runs every five minutes for SLA sweeps, digests, reports, callback retries and mailbox polling. A newer workflow sweep is an authenticated endpoint run each minute by an external trigger that this repository does not define; it uses a durable database lease.

[Open the diagram](background.architecture.html). 8 components.

| Component | Responsibility |
|---|---|
| **Legacy scheduler** | On boot starts an interval that sweeps SLA breaches, auto-closes stale tickets, sends digests and reports, retries callbacks and polls the mailbox. |
| **Workflow maintenance** | Once a minute walks tickets by id cursor to raise queue warnings and escalations, drains the email outbox and retries callbacks, under a durable lease. |
| **External minute trigger** *(partial)* | An external scheduler (documented as cron-job.org) that calls POST /api/jobs/workflow with a bearer CRON_SECRET each minute on serverless hosting. |
| **Redis / BullMQ** *(planned)* | The documented next step for true job queue semantics; provisioned by compose and read by config, but no code uses it. |
| **Bucket workflow** | Moves a ticket between the Service Desk and department buckets through guarded transitions with optimistic concurrency, and measures bucket health. |
| **Email outbox** | Holds workflow emails as delivery rows and sends them in bounded batches, with leases and exponential backoff, so a failed send is retried rather than lost. |
| **Channel adapters** | Turns mailbox messages, Slack events and Teams activities into intake calls, de-duplicating mail and attaching replies to the right thread. |
| **DataStore port** | Defines the one collection interface every service uses, and picks the Prisma or memory adapter once per process from DATA_DRIVER. |

**Deliberately not shown.** SLA sweeps and notifications (the scheduler calls the SLA, Ticket, Notifier and Audit modules), the Graph mailbox the poll reads, callback retries, and the other domain modules.

#### The long read

Legacy scheduler. src/instrumentation.ts starts it once when the server boots. Every five minutes it takes a lock (an in-process mutex, plus a Postgres advisory lock when the Prisma driver is active) and runs, with bounded retries, the SLA sweep (80% warnings and breach escalation), the auto-close of stale resolved tickets, the Monday digest, the monthly PDF report, outbound callback retries and, for Graph only, the mailbox poll. A step that exhausts its retries is written to the audit chain as job.failed. It skips tickets in the bucket workflow.

Workflow maintenance. This is the sweep for the bucket workflow. It is exposed as POST /api/jobs/workflow, protected by a constant-time check of a CRON_SECRET of at least 32 bytes. Under a durable lease row it walks tickets by an ID cursor for up to about 20 seconds, writing queue warnings, manager and senior-RM escalations and the 7-day no-response closure. It then drains the email outbox (at most 20 per run) and retries one callback. On a long-running server the Legacy scheduler calls it directly every minute, with no HTTP hop; on Vercel it depends on an external minute trigger.

That trigger is the gap: vercel.json contains no cron entry. docs/SERVICE_DESK_WORKFLOW.md says to configure an external cron-job.org schedule, and docs/IMPLEMENTATION_STATUS.md records that the release did not, so whether the call is happening is not knowable from the repository. Redis and BullMQ are shown as planned: they are provisioned and named as the next step but nothing uses them.

#### Terms used here

- **tenant**: One customer organization. Almost every row carries a tenantId and every query is filtered by the caller's tenant, so two organizations share the database but never see each other.
- **DataStore port**: The small interface of collections (list, get, create, update, compare-and-set, transaction) that all services use. A Prisma and a memory adapter both implement it.
- **intake**: The fixed pipeline every new ticket passes through, whatever its channel: classify, create, SLA, acknowledge, hold for approval, route, run rules, AI triage.
- **SLA**: Response and resolution deadlines per priority. The clock pauses while a ticket is pending and escalates when 80% elapsed and again on breach.
- **bucket workflow**: An optional per-tenant flow where new tickets land in a Service Desk queue, are routed to a department queue, then picked up or offered to a person, resolved, and confirmed by the requester.
- **optimistic concurrency**: Updating a row only if it still has the version you read; if someone else changed it first the update returns nothing and the caller must retry.
- **audit chain**: A per-tenant log where each block includes a hash of the previous one, so editing or deleting any past block breaks every later hash and can be detected.
- **outbox**: A table of messages waiting to be sent. A worker claims rows, sends them and records the result, so a crash or provider outage delays mail instead of losing it.
- **lease**: A time-limited claim on a job so only one process runs it at a time. If the holder dies, the claim expires and another can take over.
- **serverless**: Hosting where code runs in short-lived function instances that may be many or frozen between requests, so in-memory state is not shared and timers are unreliable.

### How people and systems are told about changes

**When a ticket changes, who finds out, by which route, and how reliable is each?**

A change reaches four audiences: staff watching the UI, requesters by email, chat channels, and customer systems that subscribed to callbacks. Each uses a different mechanism with different reliability, and mixing them up is the commonest source of 'why did nobody get notified'.

Live UI updates use an in-process event bus pushed over SSE and are best-effort per instance. Workflow email goes through a leased, retried database outbox with at-least-once delivery. Non-workflow notifications are sent inline and recorded in-app. Customer callbacks are HMAC-signed and retried.

[Open the diagram](delivery.architecture.html). 6 components.

| Component | Responsibility |
|---|---|
| **Ticket services** | Owns ticket rows: creates them, applies every patch, appends the lifecycle event and messages, and emits the side effects of a change. |
| **Notifier** | Records an in-app notification for every message and delivers it by email, Teams or Slack when a provider is configured. |
| **Email outbox** | Holds workflow emails as delivery rows and sends them in bounded batches, with leases and exponential backoff, so a failed send is retried rather than lost. |
| **Event bus** | Fans notification and ticket-updated events out to every open SSE connection in the same process. |
| **Callbacks** | Queues and delivers signed ticket events to each API key's webhook URL, refusing private addresses and redirects, and retries failures. |
| **API-key integrator** | A customer's own server that files and reads tickets with an nlk_ API key and receives signed callbacks about them. |

**Deliberately not shown.** The SSE route and the browser at the end of the stream, the Bucket workflow, which publishes to the same bus, outbox and callback queue as Ticket services; the mail and chat providers (see the integrations diagram); and the schedulers that trigger retries.

#### The long read

Live updates. When a ticket changes, Ticket services and the Bucket workflow publish a ticket.updated event on an in-process EventEmitter, and the Notifier publishes a notification event. Each open /api/v1/events stream is subscribed to that bus and pushes matching events to its browser; requesters only receive events for their own tickets and notifications. This is single-node by design, so a user connected to a different instance will not see it.

Email. For workflow tickets, lifecycle and escalation emails are written as outbox rows inside the same transaction as the change and sent later by the sweep, which claims each row with a lease, sends it through Graph or Brevo and retries with exponential backoff up to 8 attempts. Delivery is at-least-once. Other notifications go straight through the Notifier, which always records an in-app row and also sends by email, Teams or Slack when configured; a provider failure is logged and the in-app record is kept.

Customer callbacks. A ticket created or updated queues a signed callback for each API key that subscribed. The callback carries an HMAC over timestamp and body, is refused if the URL resolves to a private address, does not follow redirects, and is retried by the schedulers.

#### Terms used here

- **API key**: A machine credential beginning nlk_. Shown once at creation, stored only as a hash, bound to one tenant and one role.
- **SLA**: Response and resolution deadlines per priority. The clock pauses while a ticket is pending and escalates when 80% elapsed and again on breach.
- **bucket workflow**: An optional per-tenant flow where new tickets land in a Service Desk queue, are routed to a department queue, then picked up or offered to a person, resolved, and confirmed by the requester.
- **outbox**: A table of messages waiting to be sent. A worker claims rows, sends them and records the result, so a crash or provider outage delays mail instead of losing it.
- **lease**: A time-limited claim on a job so only one process runs it at a time. If the holder dies, the claim expires and another can take over.
- **SSE**: A one-way stream from server to browser over a long-lived HTTP response, used to push live notifications without polling.
- **HMAC**: A signature made from a shared secret and the message body. The receiver recomputes it to confirm the sender knows the secret and the body was not altered.
- **SSRF**: Server-side request forgery: tricking a server into calling an internal address. Outbound callbacks block private IPs and redirects to prevent it.

### Which outside services are optional

**Which external services does the system depend on, and which of them can be missing?**

The whole app is designed to run with no outside services at all. Each integration is optional and switched on by configuration, and each has a fallback. Knowing the fallbacks matters because a hosted showcase may be running on the fallback without anyone noticing.

Entra ID, Graph, Brevo, Slack, Teams, the LLM providers and Azure Blob are all optional. Without them the app uses demo sign-in, in-app-only notifications, a hashed-embedding offline AI template, and database or local attachment storage.

[Open the diagram](integrations.architecture.html). 9 components.

| Component | Responsibility |
|---|---|
| **Notifier** | Records an in-app notification for every message and delivers it by email, Teams or Slack when a provider is configured. |
| **Microsoft Graph** | Optional Microsoft 365 mailbox that we poll for inbound mail and use to send outbound mail. |
| **Brevo** | Optional email provider: pushes parsed inbound mail to a webhook and delivers our outbound transactional mail. |
| **Slack** | Optional chat channel: sends events and slash commands in, receives our notifications through an incoming-webhook URL. |
| **Microsoft Teams** | Optional chat channel: a bot posts activities in, and a webhook URL receives our notifications. |
| **LLM gateway** | Picks the model provider by configuration and falls back to a deterministic offline template and hashed embeddings so triage never breaks. |
| **LLM providers** | Optional hosted models that write grounded answers and embeddings; absent, an offline template and hashed embeddings stand in. |
| **Attachment storage** | Validates attachments and stores their bytes through a blob port with local-disk (demo only), Azure Blob or database-backed adapters. |
| **Azure Blob Storage** | Optional object store for attachment bytes when a connection string is configured. |

**Deliberately not shown.** Sign-in and Entra ID, drawn in the identity diagram, and the inbound direction of each channel (see the inbound diagram).

#### The long read

Sign-in. Auth.js uses Microsoft Entra ID when all three AUTH_MICROSOFT variables are present, and that also turns demo mode off. Otherwise it offers passwordless demo or allowlisted public-demo credentials, or organization password accounts if enabled.

Notifications. The Notifier always records an in-app notification. It sends email only if a provider is configured: Brevo if its key is present, else Graph, else none. Slack and Teams are posted to their incoming webhooks when those URLs are set. If a send fails, it is logged and the in-app record remains.

AI. The LLM gateway tries the configured provider order: Azure OpenAI, Gemini, then Groq. If none is available, or a call fails, it uses an offline template built from the retrieved articles and a hashed bag-of-words embedder, so triage still runs, but with weaker answers. Note that ticket text and article text are sent to the chosen provider.

Attachments. Azure Blob is used when a connection string exists. Otherwise, with Postgres and the setting enabled, bytes go in the database (capped at 4 MB for Vercel's request limit); in demo mode local disk is used; in production without any of these, attachments are disabled.

#### Terms used here

- **tenant**: One customer organization. Almost every row carries a tenantId and every query is filtered by the caller's tenant, so two organizations share the database but never see each other.
- **demo mode**: A zero-setup mode with passwordless sign-in, an in-memory datastore and header-based impersonation. It is on by default and must be turned off for production.
- **DataStore port**: The small interface of collections (list, get, create, update, compare-and-set, transaction) that all services use. A Prisma and a memory adapter both implement it.
- **SLA**: Response and resolution deadlines per priority. The clock pauses while a ticket is pending and escalates when 80% elapsed and again on breach.
- **RAG**: Answering from a knowledge base: find the most relevant articles, give them to a language model as context, then score how well they support the answer.
- **embedding**: A list of numbers representing the meaning of a text, so similar texts sit close together. Without a model provider the app uses a simple hashed word-count vector instead.
- **serverless**: Hosting where code runs in short-lived function instances that may be many or frozen between requests, so in-memory state is not shared and timers are unreliable.

### How configuration chooses the runtime shape

**How does the same code run as a demo, in Docker and on Vercel, and what changes?**

One codebase must run with zero setup for a demo and with Postgres and real providers in production. That is done by reading the environment once and swapping adapters, not by branching code paths throughout. This diagram shows the switches and what each target supplies.

A config module reads the environment once. DATA_DRIVER picks the Prisma or memory adapter, ATTACHMENT_STORAGE and a connection string pick the blob adapter, and Docker or Vercel only supply the environment. Redis is provisioned but unused.

[Open the diagram](deployment.architecture.html). 11 components.

| Component | Responsibility |
|---|---|
| **Vercel hosting** | Builds with vercel-build (environment check, then next build) and runs the app as serverless functions. |
| **Docker and compose** | Packages the standalone build as a container and, in compose, starts local PostgreSQL with pgvector and Redis. |
| **Config + flags** | Reads environment variables once and turns each optional capability into a flag, so the app degrades to a zero-infrastructure demo when they are absent. |
| **DataStore port** | Defines the one collection interface every service uses, and picks the Prisma or memory adapter once per process from DATA_DRIVER. |
| **Prisma adapter** | Implements the DataStore port against PostgreSQL through Prisma, including compare-and-set updates and transactions. |
| **Memory adapter** | Implements the same port in process memory, seeds demo data, and flushes the whole dataset to a JSON file on every mutation. |
| **PostgreSQL** | Holds every tenant's tickets, users, knowledge base, audit blocks, outbox rows and API keys in production. |
| **.data/store.json** | Holds the whole demo dataset as one JSON file so a restart keeps demo state. |
| **Attachment storage** | Validates attachments and stores their bytes through a blob port with local-disk (demo only), Azure Blob or database-backed adapters. |
| **Azure Blob Storage** | Optional object store for attachment bytes when a connection string is configured. |
| **Redis / BullMQ** *(planned)* | The documented next step for true job queue semantics; provisioned by compose and read by config, but no code uses it. |

**Deliberately not shown.** The CI workflow (install, generate Prisma client, agent-tools check, typecheck, lint, tests, audit, build) and the production environment check scripts.

#### The long read

The Config and feature flags module reads the environment once at start and exposes flags: whether a database URL exists and the driver is prisma, whether Entra is configured, which email provider is active, what attachment storage is available, and whether demo mode is on.

The DataStore port consults it to build exactly one adapter. With DATA_DRIVER=prisma and a DATABASE_URL it loads the Prisma adapter lazily and talks to PostgreSQL. Otherwise it uses the memory adapter, which seeds demo data and flushes the whole dataset to .data/store.json after every mutation. That file is why the demo survives a restart locally; it is not suitable on serverless disk.

Attachment storage follows the same pattern through the blob port: Azure when configured, database or local disk otherwise, or disabled in production when nothing is configured.

The two hosts only supply the environment. Vercel runs the vercel-build script (an environment check, then next build) and serves serverless functions. Docker builds the standalone output and its entrypoint refuses to start if the production environment check fails; docker-compose starts local pgvector Postgres and Redis for development. The Redis container is the one component with nothing behind it.

#### Terms used here

- **tenant**: One customer organization. Almost every row carries a tenantId and every query is filtered by the caller's tenant, so two organizations share the database but never see each other.
- **API key**: A machine credential beginning nlk_. Shown once at creation, stored only as a hash, bound to one tenant and one role.
- **demo mode**: A zero-setup mode with passwordless sign-in, an in-memory datastore and header-based impersonation. It is on by default and must be turned off for production.
- **DataStore port**: The small interface of collections (list, get, create, update, compare-and-set, transaction) that all services use. A Prisma and a memory adapter both implement it.
- **optimistic concurrency**: Updating a row only if it still has the version you read; if someone else changed it first the update returns nothing and the caller must retry.
- **outbox**: A table of messages waiting to be sent. A worker claims rows, sends them and records the result, so a crash or provider outage delays mail instead of losing it.
- **RAG**: Answering from a knowledge base: find the most relevant articles, give them to a language model as context, then score how well they support the answer.
- **embedding**: A list of numbers representing the meaning of a text, so similar texts sit close together. Without a model provider the app uses a simple hashed word-count vector instead.
- **serverless**: Hosting where code runs in short-lived function instances that may be many or frozen between requests, so in-memory state is not shared and timers are unreliable.

### How a person or an API key gets authenticated

**What happens, in order, from sign-in to an authorised API call?**

Two kinds of caller reach the same API: people with a browser session and servers with an API key. Seeing both on one timeline shows which checks are shared, and which are only a first, cheap gate.

Sign-in produces a signed JWT session carrying user, role and tenant. Each request then passes the proxy's presence check, and the route's guards read the session or verify the API key hash to obtain the actor, role and tenant before any record is touched.

[Open the diagram](auth-flow.sequence.html). 8 participants.

| Component | Responsibility |
|---|---|
| **Browser UI** | Renders the portal, ticket console, triage board and admin screens, and talks to the server only through fetch calls to /api/v1 and one EventSource stream. |
| **Auth.js sessions** | Signs people in (demo, organization password or Entra ID) and issues the JWT session carrying user id, role and tenant. |
| **Microsoft Entra ID** | Optional OpenID Connect identity provider; its presence also switches demo mode off. |
| **DataStore port** | Defines the one collection interface every service uses, and picks the Prisma or memory adapter once per process from DATA_DRIVER. |
| **Edge proxy** | Rejects page requests without a session and /api/v1 requests without any credential, and applies a coarse per-IP rate limit before any route runs. |
| **REST API /api/v1** | Validates each request, asks the guards who the caller is and what they may do, then calls one service and shapes the JSON reply. |
| **Context and guards** | Resolves the acting user and tenant from session or API key, checks the RBAC permission, and answers 404 for rows in another tenant. |
| **API key service** | Mints, verifies and revokes nlk_ machine keys, storing only a SHA-256 hash and binding each key to one tenant and role. |

**Deliberately not shown.** Organization password sign-in and account setup links, and the record-level tenant check made after authorisation for any record addressed by id.

In order:

*Sign in*

1. **Browser UI → Auth.js sessions**: sign in. An email (demo) or organization code and password; back comes a signed JWT cookie.
2. **Auth.js sessions → Microsoft Entra ID**: OIDC flow (if configured). An OpenID Connect authorization flow; returns profile claims used to provision a requester.
3. **Auth.js sessions → DataStore port**: look up user, role, tenant. Email or organization code in; the active user row, role and tenant id out.

*Request*

4. **Browser UI → Edge proxy**: request with session cookie. A session cookie and JSON or multipart bodies. Never a database credential or another tenant's id as authority.
5. **Edge proxy → REST API /api/v1**: session or key present. An unchanged request, or a 401/429 JSON reply that stops it. Demo mode admits everything.

*Authorise*

6. **REST API /api/v1 → Context and guards**: requirePermission(). The Request and a permission name; back comes the actor, role and tenant, or a ready 401/403 response.
7. **Context and guards → Auth.js sessions**: read session. The Auth.js session, whose tenantId and role seed the actor.
8. **Context and guards → API key service**: verify nlk_ key. A candidate nlk_ key; back come its tenant, role and bound requester, or nothing.
9. **API key service → DataStore port**: key hash lookup. A SHA-256 hash of the presented key against the ApiKey collection. The raw key is never stored.
10. **Context and guards ⇢ REST API /api/v1**: actor, role, tenant

#### The long read

Sign in. The browser posts credentials to Auth.js. If Entra ID is configured, Auth.js runs an OpenID Connect flow with it; otherwise demo or organization credentials are checked against the user table in the store. On success Auth.js issues a signed JWT cookie containing the user id, role and tenant id. There is no server-side session table.

Every request. The proxy runs first and only asks whether a session or an nlk_ key header is present, returning a JSON 401 otherwise. It does not verify the key and does not decide what the caller may do; in demo mode it admits everything.

Authorise. The route handler calls requirePermission. The guards read the Auth.js session if there is one. If the request carries an API key instead, they hash it and look the hash up in the store; a valid key yields the key's tenant, role and bound requester. A key that is presented but invalid never falls back to anyone, and in production anything unrecognised becomes an actor with no permissions. The route receives the actor, role and tenant, and the tenant comes only from here. Records addressed by id are then checked against that tenant, answering 404 on a mismatch.

#### Terms used here

- **tenant**: One customer organization. Almost every row carries a tenantId and every query is filtered by the caller's tenant, so two organizations share the database but never see each other.
- **RBAC**: A table of which roles hold which permissions (ticket.read, ticket.write, admin and so on). Roles rise from requester to agent, manager, tenant admin and super admin.
- **API key**: A machine credential beginning nlk_. Shown once at creation, stored only as a hash, bound to one tenant and one role.
- **demo mode**: A zero-setup mode with passwordless sign-in, an in-memory datastore and header-based impersonation. It is on by default and must be turned off for production.
- **DataStore port**: The small interface of collections (list, get, create, update, compare-and-set, transaction) that all services use. A Prisma and a memory adapter both implement it.
- **SSE**: A one-way stream from server to browser over a long-lived HTTP response, used to push live notifications without polling.
- **proxy**: The Next.js file that runs before every matched request. Here it enforces sign-in for pages and a credential-present check for the API.

## Boundaries

A boundary is a claim about everything inside it.

### User's browser

*trust boundary.* Runs on a machine we do not control, so nothing here is trusted for authorization and nothing here can reach the datastore except through /api/v1.

Contains: Browser UI.

Crossed by:

- **Browser UI → Edge proxy** over https. A session cookie and JSON or multipart bodies. Never a database credential or another tenant's id as authority.
- **Browser UI → Auth.js sessions** over https. An email (demo) or organization code and password; back comes a signed JWT cookie.
- **REST API /api/v1 → Browser UI** over https. Server-sent events: notification and ticket.updated records filtered to what that user may see, plus a 25 s heartbeat.

### Next.js server process

*process boundary.* Shares one set of process-level singletons: the DataStore, the event bus, the in-memory rate limiter and the job locks. They are consistent inside one instance and invisible to every other instance.

Contains: Edge proxy, Auth.js sessions, REST API /api/v1, Context and guards, API key service, Inbound webhook routes, Channel adapters, Unified intake, Ticket services, Bucket workflow, SLA and routing, AI resolver, LLM gateway, Other domain services, Audit chain, Notifier, Email outbox, Event bus, Legacy scheduler, Workflow maintenance, Callbacks, DataStore port, Prisma adapter, Memory adapter, Attachment storage, Config + flags.

### Durable state

*ownership boundary.* The only places data survives a restart. Everything else in the system is recomputed or lost.

Contains: PostgreSQL, .data/store.json, Azure Blob Storage.

Crossed by:

- **Attachment storage → Azure Blob Storage** over https. Attachment bytes under opaque keys.
- **Prisma adapter → PostgreSQL** over database. SQL via Prisma, with row-level tenantId filters applied by the services and transactions retried on conflict.
- **Memory adapter → .data/store.json** over file. The whole dataset serialised after each mutation.

## Components

### Browser and edge

**Browser UI**: Renders the portal, ticket console, triage board and admin screens, and talks to the server only through fetch calls to /api/v1 and one EventSource stream.

- Source: `src/lib/api.ts`, `src/components/AppShell.tsx`, `src/components/TopBar.tsx:215`, `src/app/tickets/[id]/page.tsx`

**API-key integrator**: A customer's own server that files and reads tickets with an nlk_ API key and receives signed callbacks about them.

- Source: `docs/EXTERNAL_API_GUIDE.md`

**Webhook senders**: Other systems that push JSON events at us (Zendesk, Freshdesk, internal scripts) signed with a shared secret.

- Outside the repository; the code that talks to it is cited on the relations.

**Brevo**: Optional email provider: pushes parsed inbound mail to a webhook and delivers our outbound transactional mail.

- Outside the repository; the code that talks to it is cited on the relations.

**Microsoft Graph**: Optional Microsoft 365 mailbox that we poll for inbound mail and use to send outbound mail.

- Outside the repository; the code that talks to it is cited on the relations.

**Slack**: Optional chat channel: sends events and slash commands in, receives our notifications through an incoming-webhook URL.

- Outside the repository; the code that talks to it is cited on the relations.

**Microsoft Teams**: Optional chat channel: a bot posts activities in, and a webhook URL receives our notifications.

- Outside the repository; the code that talks to it is cited on the relations.

**Microsoft Entra ID**: Optional OpenID Connect identity provider; its presence also switches demo mode off.

- Outside the repository; the code that talks to it is cited on the relations.

**LLM providers**: Optional hosted models that write grounded answers and embeddings; absent, an offline template and hashed embeddings stand in.

- Outside the repository; the code that talks to it is cited on the relations.

**External minute trigger** *(partial)*: An external scheduler (documented as cron-job.org) that calls POST /api/jobs/workflow with a bearer CRON_SECRET each minute on serverless hosting.

- Source: `docs/SERVICE_DESK_WORKFLOW.md:108`, `vercel.json`
- The route and its secret check exist; docs/SERVICE_DESK_WORKFLOW.md says to create the schedule in cron-job.org, and docs/IMPLEMENTATION_STATUS.md says the release did not configure it. Whether it exists today is not knowable from the repository.

**Edge proxy**: Rejects page requests without a session and /api/v1 requests without any credential, and applies a coarse per-IP rate limit before any route runs.

- Source: `src/proxy.ts`, `src/server/auth/apiGateway.ts`

**Vercel hosting**: Builds with vercel-build (environment check, then next build) and runs the app as serverless functions.

- Source: `vercel.json`, `package.json`, `next.config.mjs`

**Docker and compose**: Packages the standalone build as a container and, in compose, starts local PostgreSQL with pgvector and Redis.

- Source: `Dockerfile`, `docker-compose.yml`

### Route handlers

**Auth.js sessions**: Signs people in (demo, organization password or Entra ID) and issues the JWT session carrying user id, role and tenant.

- Source: `src/auth.ts`, `src/auth.config.ts`

**REST API /api/v1**: Validates each request, asks the guards who the caller is and what they may do, then calls one service and shapes the JSON reply.

- Source: `src/app/api/v1/tickets/route.ts`, `src/app/api/v1/intake/route.ts`, `src/app/api/v1/events/route.ts`, `src/app/api/v1/tickets/[id]/workflow/route.ts`

**Context and guards**: Resolves the acting user and tenant from session or API key, checks the RBAC permission, and answers 404 for rows in another tenant.

- Source: `src/server/context.ts`, `src/server/guards.ts`, `src/server/auth/rbac.ts`

**Inbound webhook routes**: Verifies each sender's signature or secret against the raw body, rate-limits by IP, and normalises the payload into a ticket request.

- Source: `src/app/api/webhooks/generic/route.ts`, `src/server/channels/webhookSecurity.ts`, `src/server/channels/webhookAdapters.ts`, `src/app/api/webhooks/slack/route.ts`

### Domain services

**API key service**: Mints, verifies and revokes nlk_ machine keys, storing only a SHA-256 hash and binding each key to one tenant and role.

- Source: `src/server/auth/apiKeys.ts`

**Channel adapters**: Turns mailbox messages, Slack events and Teams activities into intake calls, de-duplicating mail and attaching replies to the right thread.

- Source: `src/server/channels/emailIngest.ts`, `src/server/channels/graphEmail.ts`, `src/server/channels/slack.ts`, `src/server/channels/teams.ts`

**Unified intake**: Runs every new ticket, whatever its channel, through classification, creation, SLA, acknowledgement, approval hold, routing, automation and AI triage in a fixed order.

- Source: `src/server/services/intake.ts:27`, `src/server/services/intake.ts:125`

**Ticket services**: Owns ticket rows: creates them, applies every patch, appends the lifecycle event and messages, and emits the side effects of a change.

- Source: `src/server/services/ticketService.ts:196`, `src/server/services/agentActions.ts`, `src/server/services/idempotencyService.ts`

**Bucket workflow**: Moves a ticket between the Service Desk and department buckets through guarded transitions with optimistic concurrency, and measures bucket health.

- Source: `src/server/services/workflowService.ts`, `src/server/services/workflowMonitoring.ts`, `src/server/services/workflowBoard.ts`, `src/shared/workflow.ts`

**SLA and routing**: Computes SLA clocks and pauses, routes tickets to assignment groups, fires automation rules and holds tickets for approval.

- Source: `src/server/services/slaService.ts`, `src/server/services/groupService.ts`, `src/server/services/automationService.ts`, `src/server/services/approvalService.ts`

**AI resolver**: Classifies tickets and runs retrieve-generate-score-decide against the knowledge base, choosing auto-resolve, suggest or escalate.

- Source: `src/server/ai/resolver.ts:99`, `src/server/ai/aiService.ts`, `src/server/ai/vectorSearch.ts`

**LLM gateway**: Picks the model provider by configuration and falls back to a deterministic offline template and hashed embeddings so triage never breaks.

- Source: `src/server/ai/llm.ts`, `src/server/ai/embeddings.ts`

**Other domain services**: Everything else a service desk manages: knowledge base, problems, changes, assets, users, organizations, metrics and PDF reports.

- Source: `src/server/services/kbService.ts`, `src/server/services/changeService.ts`, `src/server/services/organizationService.ts`, `src/server/services/reportPdfService.ts`

**Audit chain**: Appends each audited action as a block hashed with its predecessor, inside the caller's transaction, and can recompute the chain to expose tampering.

- Source: `src/server/audit/auditChain.ts:54`

**Notifier**: Records an in-app notification for every message and delivers it by email, Teams or Slack when a provider is configured.

- Source: `src/server/notify/notifier.ts:52`, `src/server/notify/templates.ts`

**Email outbox**: Holds workflow emails as delivery rows and sends them in bounded batches, with leases and exponential backoff, so a failed send is retried rather than lost.

- Source: `src/server/notify/workflowOutbox.ts`

**Event bus**: Fans notification and ticket-updated events out to every open SSE connection in the same process.

- Source: `src/server/events/bus.ts`

**Legacy scheduler**: On boot starts an interval that sweeps SLA breaches, auto-closes stale tickets, sends digests and reports, retries callbacks and polls the mailbox.

- Source: `src/instrumentation.ts`, `src/server/jobs/scheduler.ts:259`, `src/server/jobs/lock.ts`

**Workflow maintenance**: Once a minute walks tickets by id cursor to raise queue warnings and escalations, drains the email outbox and retries callbacks, under a durable lease.

- Source: `src/server/jobs/workflowMaintenance.ts`, `src/server/jobs/durableLease.ts`, `src/app/api/jobs/workflow/route.ts`

**Callbacks**: Queues and delivers signed ticket events to each API key's webhook URL, refusing private addresses and redirects, and retries failures.

- Source: `src/server/services/integrationWebhookService.ts`

### Data port and adapters

**DataStore port**: Defines the one collection interface every service uses, and picks the Prisma or memory adapter once per process from DATA_DRIVER.

- Source: `src/server/data/store.ts`, `src/server/data/index.ts:13`

**Prisma adapter**: Implements the DataStore port against PostgreSQL through Prisma, including compare-and-set updates and transactions.

- Source: `src/server/data/prismaStore.ts`

**Memory adapter**: Implements the same port in process memory, seeds demo data, and flushes the whole dataset to a JSON file on every mutation.

- Source: `src/server/data/memoryStore.ts`

**Attachment storage**: Validates attachments and stores their bytes through a blob port with local-disk (demo only), Azure Blob or database-backed adapters.

- Source: `src/server/services/attachmentService.ts`, `src/server/storage/blobStore.ts`, `src/server/storage/databaseBlob.ts`

**Config + flags**: Reads environment variables once and turns each optional capability into a flag, so the app degrades to a zero-infrastructure demo when they are absent.

- Source: `src/server/config.ts`
- In the diagrams an arrow from config means 'configures'. In the code the imports point the other way: each module imports config to read its flags.

### Durable stores

**Azure Blob Storage**: Optional object store for attachment bytes when a connection string is configured.

- Source: `src/server/storage/azureBlob.ts`

**PostgreSQL**: Holds every tenant's tickets, users, knowledge base, audit blocks, outbox rows and API keys in production.

- Source: `prisma/schema.prisma`, `prisma/sql/001_pgvector.sql`

**.data/store.json**: Holds the whole demo dataset as one JSON file so a restart keeps demo state.

- Source: `src/server/data/memoryStore.ts`

**Redis / BullMQ** *(planned)*: The documented next step for true job queue semantics; provisioned by compose and read by config, but no code uses it.

- Source: `docker-compose.yml`, `src/server/jobs/lock.ts`, `src/server/config.ts`

## What moves between them

| From | To | Mechanism | What crosses |
|---|---|---|---|
| Browser UI | Edge proxy | https | A session cookie and JSON or multipart bodies. Never a database credential or another tenant's id as authority. *(crosses User's browser)* |
| Browser UI | Auth.js sessions | https | An email (demo) or organization code and password; back comes a signed JWT cookie. *(crosses User's browser)* |
| REST API /api/v1 | Browser UI | https | Server-sent events: notification and ticket.updated records filtered to what that user may see, plus a 25 s heartbeat. *(crosses User's browser)* |
| API-key integrator | Edge proxy | https | A key header and JSON. The proxy only checks that a credential is present; the key is verified later. |
| Webhook senders | Inbound webhook routes | https | A JSON body with an HMAC over timestamp and raw body in x-webhook-signature. |
| Brevo | Inbound webhook routes | https | Parsed email JSON plus a shared secret in ?token= or x-brevo-secret. Brevo cannot sign. |
| Slack | Inbound webhook routes | https | Slack Events API envelopes and slash-command forms signed with Slack's v0 scheme. |
| Microsoft Teams | REST API /api/v1 | https | A Teams activity object inside a normal authenticated /api/v1/intake call. |
| Edge proxy | Auth.js sessions | in-process call | The request's session cookie; back comes whether a user is signed in. |
| Edge proxy | REST API /api/v1 | in-process call | An unchanged request, or a 401/429 JSON reply that stops it. Demo mode admits everything. |
| Auth.js sessions | Microsoft Entra ID | https | An OpenID Connect authorization flow; returns profile claims used to provision a requester. |
| Auth.js sessions | DataStore port | in-process call | Email or organization code in; the active user row, role and tenant id out. |
| REST API /api/v1 | Context and guards | in-process call | The Request and a permission name; back comes the actor, role and tenant, or a ready 401/403 response. |
| Context and guards | Auth.js sessions | in-process call | The Auth.js session, whose tenantId and role seed the actor. |
| Context and guards | API key service | in-process call | A candidate nlk_ key; back come its tenant, role and bound requester, or nothing. |
| Context and guards | DataStore port | database | Tenant lookups and the row being addressed, compared with the caller's tenant. |
| Context and guards | Ticket services | in-process call | A ticket id and tenant id; back comes the row or a 404. |
| API key service | DataStore port | database | A SHA-256 hash of the presented key against the ApiKey collection. The raw key is never stored. |
| API key service | Audit chain | in-process call | Key created, rotated and deleted events with the actor. |
| REST API /api/v1 | Unified intake | in-process call | A validated ticket request and the tenant id taken from the guard, never from the body. |
| REST API /api/v1 | Ticket services | in-process call | Ticket ids, filters, patches and messages scoped by tenant. |
| REST API /api/v1 | Bucket workflow | in-process call | A workflow action (claim, route, accept, release, return) with the staff actor. |
| REST API /api/v1 | AI resolver | in-process call | Ticket text for classification and summary; ticket id for re-running the resolver. |
| REST API /api/v1 | Other domain services | in-process call | Tenant-scoped reads and writes for the non-ticket records. |
| REST API /api/v1 | Audit chain | in-process call | A tenant id; back comes blocks or a verification verdict. |
| REST API /api/v1 | Attachment storage | in-process call | Uploaded file bytes in, downloaded bytes out, with size and type checks. |
| REST API /api/v1 | DataStore port | database | Collection reads made straight from 16 route files, skipping the service layer. |
| REST API /api/v1 | Channel adapters | in-process call | The Teams activity object from /api/v1/intake. |
| Event bus | REST API /api/v1 | event | AppEvent records. Each open stream filters by tenant, and requesters see only their own. |
| Inbound webhook routes | Unified intake | in-process call | A ticket request mapped from a Zendesk, Freshdesk or generic payload, tenant from currentTenantId. |
| Inbound webhook routes | Channel adapters | in-process call | The verified payload for Slack events or parsed Brevo mail. |
| Channel adapters | Unified intake | in-process call | Sender, subject and trimmed body; a default tenant because no request context exists. |
| Channel adapters | Ticket services | in-process call | A requester reply appended to the ticket the thread matched. |
| Channel adapters | Attachment storage | in-process call | Base64 attachment bytes from the message. |
| Channel adapters | Microsoft Graph | https | OAuth client-credentials token, then inbox listing, attachment fetch and a mark-as-read patch. |
| Channel adapters | DataStore port | database | A ledger row per Message-ID written before processing, so a crash cannot double-ingest. |
| Legacy scheduler | Channel adapters | in-process call | A poll request; only when the active email provider is Graph. |
| Unified intake | AI resolver | in-process call | Subject and body in; category, impact, urgency and tags out; later a ticket id for resolution. |
| Unified intake | Ticket services | in-process call | A fully classified ticket request; the stored ticket row comes back. |
| Unified intake | SLA and routing | in-process call | The new ticket, to stamp due dates, hold for approval, pick an assignment group and fire rules. |
| Unified intake | Notifier | in-process call | Template key and variables for the requester; skipped for workflow tickets, which use the outbox. |
| Unified intake | Audit chain | in-process call | ticket.priority_assessed and VIP-prioritised blocks with the factors used. |
| Unified intake | DataStore port | database | The requester's user row (VIP, location) and the catalog item for approval rules. |
| AI resolver | LLM gateway | in-process call | Text to embed or a prompt of ticket plus knowledge-base context. |
| LLM gateway | LLM providers | https | Ticket text and retrieved article text leave the system; vectors and answers come back. Keys stay server-side. |
| AI resolver | DataStore port | database | Published articles in; one resolution and its citations out, replacing any earlier run. |
| AI resolver | Audit chain | in-process call | ticket.retrieval with hit scores, then ticket.decision.* with confidence and reasoning. |
| AI resolver | Ticket services | in-process call | An assistant message and a status change, but only when the decision is auto-resolve or suggest. |
| Ticket services | DataStore port | database | Ticket, event and delivery rows written in one store transaction. |
| Ticket services | Audit chain | in-process call | An audit block appended in the same transaction as the insert. |
| Ticket services | Event bus | event | Ticket id, reference and requester email so streams can filter per user. |
| Ticket services | Email outbox | in-process call | A notification and delivery row for workflow tickets; sent later by the sweep. |
| Ticket services | Callbacks | in-process call | A ticket.created or ticket.updated payload queued for each subscribed API key. |
| Ticket services | Bucket workflow | in-process call | Every patch to a workflow ticket, rejected if it tries to reroute or skip acceptance. |
| Ticket services | SLA and routing | in-process call | Status changes that pause or resume the clock and shift due dates. |
| Bucket workflow | DataStore port | database | Ticket rows updated by compare-and-set on workflowVersion inside one transaction. |
| Bucket workflow | Audit chain | in-process call | One block per transition naming actor, phase and group. |
| Bucket workflow | Email outbox | in-process call | Lifecycle and misrouting notices written inside the transition's transaction. |
| Bucket workflow | Callbacks | in-process call | A callback payload queued inside the transaction. |
| Bucket workflow | Event bus | event | Published only after the transaction commits. |
| Bucket workflow | SLA and routing | in-process call | Working-minute calculations against the tenant's business calendar. |
| SLA and routing | Ticket services | in-process call | Ticket patches for group assignment, escalation and automation actions. |
| SLA and routing | Notifier | in-process call | Notification requests raised by automation rules. |
| SLA and routing | DataStore port | database | SLA policies, calendars, groups, rules and approvals. |
| SLA and routing | Audit chain | in-process call | Routing, approval and rule-execution blocks. |
| Notifier | DataStore port | database | A Notification row per message, whether or not delivery succeeded. |
| Notifier | Event bus | event | Recipient address only, so the bell updates without polling. |
| Notifier | Microsoft Graph | https | Recipient, subject, plain-text body and optional PDF attachment. |
| Notifier | Brevo | https | Recipient, subject, body and optional attachment. |
| Notifier | Slack | https | A subject and body line, with no per-recipient routing. |
| Notifier | Microsoft Teams | https | A bold subject and body to one configured channel URL. |
| Email outbox | DataStore port | database | Delivery rows claimed by compare-and-set with a two-minute lease, then marked sent, pending or failed. |
| Email outbox | Notifier | in-process call | The prepared message when Graph is the provider. |
| Email outbox | Brevo | https | The prepared message and the delivery id as a key. |
| Callbacks | DataStore port | database | WebhookDelivery rows with attempts and status. |
| Callbacks | API-key integrator | https | A JSON event with X-Netlink-Signature, an HMAC of timestamp and body. Private addresses and redirects are refused. |
| Callbacks | Audit chain | in-process call | Delivery outcomes and configuration changes. |
| Other domain services | DataStore port | database | Articles, problems, changes, assets, users, organizations. |
| Other domain services | Audit chain | in-process call | Blocks for knowledge-base, change and organization writes. |
| Attachment storage | DataStore port | database | Attachment metadata rows. In database mode the bytes do not go through here (see blobs to prisma). |
| Attachment storage | Prisma adapter | in-process call | In database mode the AttachmentBlob table is read and written through the Prisma client exported by prismaStore.ts, bypassing the DataStore port. |
| Attachment storage | Azure Blob Storage | https | Attachment bytes under opaque keys. *(crosses Durable state)* |
| Attachment storage | Ticket services | in-process call | A ticket id, to check the ticket exists in the caller's tenant before storing. |
| Attachment storage | Audit chain | in-process call | Upload, download and delete blocks. |
| Legacy scheduler | Ticket services | in-process call | Open tickets read per tenant; escalation and auto-close patches written back. |
| Legacy scheduler | SLA and routing | in-process call | slaStatus per ticket, then sla.at_risk and sla.breached automation triggers. |
| Legacy scheduler | Notifier | in-process call | SLA warning and breach mail, the Monday digest and the monthly PDF report. |
| Legacy scheduler | Audit chain | in-process call | sla.* blocks, and job.failed when retries are exhausted. |
| Legacy scheduler | Callbacks | in-process call | A request to redeliver pending integration callbacks. |
| Legacy scheduler | Other domain services | in-process call | A tenant id; back comes a PDF buffer. |
| Legacy scheduler | DataStore port | database | Tenant and user lists, plus a pg advisory lock on the Prisma driver. |
| Legacy scheduler | Redis / BullMQ | queue | Nothing today. The lock module names this as the next step. |
| External minute trigger | Workflow maintenance | https | A bearer secret of at least 32 bytes compared in constant time; back comes sweep counters. |
| Workflow maintenance | Bucket workflow | in-process call | One ticket id at a time; warning, manager and senior-RM escalation markers and 7-day no-response closure written back. |
| Workflow maintenance | Email outbox | in-process call | A deadline; up to 20 deliveries are sent per sweep. |
| Workflow maintenance | Callbacks | in-process call | A request to redeliver one pending callback. |
| Workflow maintenance | DataStore port | database | A JobLease row with an owner, expiry and ID cursor, so overlapping sweeps skip rather than collide. |
| DataStore port | Prisma adapter | in-process call | Every collection call, when a DATABASE_URL is configured. Loaded by dynamic import only then. |
| DataStore port | Memory adapter | in-process call | Every collection call, when no database is configured. |
| Prisma adapter | PostgreSQL | database | SQL via Prisma, with row-level tenantId filters applied by the services and transactions retried on conflict. *(crosses Durable state)* |
| Memory adapter | .data/store.json | file | The whole dataset serialised after each mutation. *(crosses Durable state)* |
| Config + flags | DataStore port | in-process call | DATA_DRIVER and DATABASE_URL decide which adapter is built. |
| Config + flags | Attachment storage | in-process call | Azure when a connection string exists, database if requested with Postgres, local in demo, otherwise disabled. |
| Config + flags | Notifier | in-process call | Brevo, Graph or none, which also flips inbound between webhook push and polling. |
| Config + flags | LLM gateway | in-process call | LLM_PROVIDER and which API keys exist. |
| Config + flags | Auth.js sessions | in-process call | Demo mode on unless Entra is configured or DEMO_MODE=false, and which sign-in providers are registered. |
| Vercel hosting | Config + flags | manual | Project environment variables set by an operator; nothing in the repo supplies them. |
| Docker and compose | Config + flags | manual | Container environment; the entrypoint refuses to start on a bad production setup. |
| Docker and compose | PostgreSQL | spawn | Starts a local pgvector/pgvector:pg16 container for development. |
| Docker and compose | Redis / BullMQ | spawn | Starts a Redis container nothing reads from. |
| Notifier | Channel adapters | in-process call | Calls sendBrevoMail and sendSlackMessage, loaded on demand, for the chosen provider. |
| Ticket services | Notifier | in-process call | Template notices for assignment, reply and status changes made through agent actions. |
| Ticket services | Context and guards | in-process call | Role and dispatch-role checks reused inside agent actions. |
| SLA and routing | Unified intake | in-process call | processTicketPipeline, imported lazily, when an approval is granted and the held request resumes. |
| SLA and routing | AI resolver | in-process call | resolveTicket, imported lazily, when an automation rule asks for AI triage. |
| Other domain services | LLM gateway | in-process call | Article text embedded when an article is written, so it can be searched. |
| Other domain services | AI resolver | in-process call | assessChangeRisk for the change-management screens. |
| Other domain services | Attachment storage | in-process call | Blob deletion when an organization is deleted. |
| AI resolver | Other domain services | in-process call | articleEmbeddingText, so search and the knowledge base agree on what is embedded. |
| Legacy scheduler | Workflow maintenance | in-process call | On non-Vercel hosts the scheduler also calls runWorkflowMaintenance every 60 s with no HTTP hop. |
| Callbacks | API key service | in-process call | Loads the key's webhook URL and derives its signing secret. |
| Audit chain | DataStore port | database | AuditRecord rows, appended inside the caller's transaction when one is passed. |
| Channel adapters | Audit chain | in-process call | Email ingestion blocks, including loop and spam drops. |

## Doctrines, guarantees and trade-offs

### Doctrines

- **A row in another tenant answers 404, never 403** confirming that an id exists elsewhere is itself a disclosure
- **A ticket inside the bucket workflow is never auto-resolved by AI and is skipped by the legacy SLA sweep** the workflow requires human resolution and has its own monitor; the AI only drafts a suggestion
- **AI confidence of 0.78 or more auto-resolves, 0.55 or more drafts for an agent, anything lower escalates; critical (P1) tickets never auto-resolve** thresholds are environment-tunable and the P1 guardrail keeps a person in the loop

### Guarantees

- **In production an unauthenticated request resolves to an actor with no permissions, and an invalid API key never falls back to a privileged identity** the proxy rejects credential-less /api/v1 traffic first, and context.ts returns the inert anonymous actor otherwise
- **Each audit block hashes its predecessor and is written in the same transaction as the change it records** a verify call can recompute the chain and point to the first altered block
- **Workflow transitions are compare-and-set on workflowVersion, so two staff acting at once cannot both win** the loser gets 'Ticket changed. Refresh and try again.'
- **Outbound callbacks refuse private addresses and redirects, and resolve DNS before connecting** an API key owner chooses the callback URL, so the server must not be steerable at internal hosts

### Constraints

- **Only the DataStore port and the database blob store reach the Prisma adapter** services depend on the port so persistence swaps with one environment variable; the one recorded exception is databaseBlob.ts, which imports the Prisma client directly
- **The browser never reaches durable state except through the API** authorization, tenant scoping and audit all live server-side

### Trade-offs

- **The event bus, the proxy and route rate limiters, and the in-process job lock are per-instance** they are plain memory on globalThis; on several instances a user may miss a live update and a rate limit is enforced per instance, while Postgres advisory locks and leases do stop duplicate sweeps
- **Workflow email is delivered at least once, so a timeout after the provider accepted a message can send a duplicate** a lease plus backoff is used instead of a transactional hand-off to the provider
- **Client components import types from server modules** they use import type, which TypeScript erases, so no server code is bundled, but it couples UI files to service files; the layout and sign-in page do import server code, and both are server components
- **The Content-Security-Policy allows unsafe-inline and unsafe-eval scripts** Next.js inline bootstrap scripts need it without a nonce setup; connect-src is limited to 'self' so a script cannot post data to a third party
- **About half of the API routes check permissions inline with can() instead of requirePermission()** the inline form answers 403 for an invalid API key where requirePermission answers 401, so status codes differ by route
- **The App Router has no error.tsx, loading.tsx, not-found.tsx or global-error.tsx** unexpected render errors fall back to Next.js defaults; pages are client components that handle API errors themselves

### Risks

- **Demo mode is the default and only switches off when Entra ID is configured or DEMO_MODE=false is set** a deployment that sets neither keeps header impersonation (x-actor, x-tenant), passwordless sign-in and open webhooks; the production environment check exists to catch this
- **The workflow maintenance endpoint has no caller inside this repository, and the legacy scheduler has no HTTP trigger at all** the docs name an external cron-job.org schedule and record that it was not configured at the 2026-09-30 release; vercel.json declares no crons; the legacy sweeps run from a setInterval that only advances while a serverless instance is warm (an inference from the files)
- **Redis is provisioned and configured but nothing reads it** config reads REDIS_URL, compose starts a container and next.config lists bullmq and ioredis as external, yet neither package is a dependency and no source file imports them
- **The Brevo inbound secret is compared with === and may travel in the query string** Brevo cannot sign requests, so a shared secret is the fallback, but the comparison is not constant-time and URLs are commonly logged; other webhook routes use timingSafeEqual
- **Sixteen route files read the datastore directly instead of going through a service** each is another place where a tenant filter must be remembered; guards.ts exists to centralise the common case
- **README.md names src/middleware.ts but the code has src/proxy.ts** Next.js 16 renamed the file convention; the README tree was not updated
- **Database-backed attachment bytes bypass the DataStore port** databaseBlob.ts imports prismaClient from prismaStore.ts, so it works only with the Prisma driver, skips the port's transactions and is invisible to the memory adapter; config only allows database mode when Postgres is active, which contains the problem
- **Sixteen server files form one runtime import cycle that exists only because of lazy import() calls** a static-import analysis of src finds no cycle, but nine of the ten await import() calls in src/server (for example ticketService to automationService and approvalService to intake) close the loop; the lazy imports hide it from the bundler and from readers
- **Sentry error reporting is declared but never active** the logger calls globalThis.__sentryCapture when SENTRY_DSN is set, but nothing in the repository assigns it, instrumentation.ts only starts the scheduler, and @sentry/nextjs is not a dependency
- **The pgvector index is provisioned but never queried** embeddings are stored as Float[] and every search loads all of a tenant's published articles and ranks them by cosine similarity in process; no raw SQL touches the vector column
- **The hand-written OpenAPI document omits five route files** /changes/{id}, /departments/{id}, /users/{id}, /tickets/{id}/summary and /tickets/{id}/typing exist as routes but not as OpenAPI paths
- **The legacy scheduler loads every ticket of every tenant into memory on each tick** listTickets(tenant.id) takes no page size and the store filters by shallow equality only, so cost grows with total tickets every five minutes
- **The Microsoft Graph client-credentials token request is implemented three times** graphEmail.ts, notifier.ts and teamsPresence.ts each fetch a token, so a change to timeouts or caching must be made in three places


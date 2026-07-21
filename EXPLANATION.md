# Netlink Support — The App, Explained Simply

A plain-English tour of the whole application: what it is, every tab, and every
workflow — kept short. For the deep version see `instruction.md`; for hands-on
testing see `workflow-guide.html`.

---

## What it is (in one line)

An **AI-first help desk (ITSM)**: people raise support requests ("tickets"), an
**AI answers or routes them automatically**, and agents handle whatever the AI
can't — with SLAs, approvals, and a tamper-proof activity log.

## The big idea

> Tickets come in from anywhere → the AI classifies and tries to solve them →
> anything it can't solve goes to the right team with a deadline running →
> everything that happens is recorded and auditable.

## Who uses it (roles)

| Role | What they do |
|---|---|
| **Requester** | An employee/customer who raises requests and tracks them. |
| **Agent** | Support staff who work tickets. |
| **Manager** | An agent who also approves requests/changes and dispatches work. |
| **Tenant admin** | Configures the workspace (Settings). |
| **Super admin** | Full access to everything. |

Each role sees more than the one below it.

---

## Every tab, in brief

| Tab (URL) | Who sees it | What it's for |
|---|---|---|
| **Sign in** (`/signin`) | everyone | Log in. In demo mode you pick a person with one click (no password). |
| **Home / Dashboard** (`/`) | agents+ | The workspace pulse: key numbers (open, resolved, SLA health, AI deflection) and recent tickets. |
| **Tickets** (`/tickets`) | everyone | Agents get the **queue** (saved views, search, table). Requesters get **My Requests** (their own tickets as cards). |
| **Ticket detail** (`/tickets/[id]`) | everyone | The full ticket: conversation, properties, SLA, approvals, attachments, AI analysis, activity. |
| **Triage** (`/triage`) | manager/admin | A dispatch board of unassigned tickets — assign each to the best-fit, least-busy agent. |
| **Problems** (`/problems`) | agents+ | Group repeat incidents into a root-cause investigation and record fixes. |
| **Changes** (`/changes`) | agents+ | Plan and approve changes (with an AI risk score) through a CAB workflow. |
| **Assets & CMDB** (`/assets`) | agents+ | Hardware inventory + a map of systems and what depends on what. |
| **Knowledge Base / Help Center** (`/knowledge-base`) | everyone | Agents write help articles; requesters read them. The AI searches these to answer tickets. |
| **Insights / Analytics** (`/analytics`) | agents+ | Charts and KPIs (response/resolve times, SLA compliance, CSAT); export CSV/PDF. |
| **Audit** (`/audit`) | agents+ | A tamper-evident log of every action; a button verifies nothing was altered. |
| **Help Center / Raise a Request** (`/portal`) | requesters | Where employees search for answers and submit a request or a catalog item. |
| **Profile** (`/profile`) | everyone | Your details, availability (Available/Away), and notification preferences. |
| **Settings** (`/settings`) | admins | Configure SLAs, calendars, groups/routing, automations, macros, custom fields, departments, and API keys. |
| **Top bar** (everywhere) | everyone | Global search, the notifications bell (live), a "New" button, and the user menu. |

---

## Every workflow, in brief

**Raising a ticket** — Requests arrive from the portal, an agent, email
(Microsoft 365 or Brevo), Teams/Slack, other help desks (webhooks), the API, or
a monitoring alert. They all go through the same steps below.

**AI triage** — On arrival the AI sets the category, works out the priority
(from *impact × urgency*), adds tags, and starts the SLA clock.

**AI resolution** — The AI searches the knowledge base and:
- very confident → **answers and closes** the ticket automatically;
- fairly confident → **drafts a reply** for an agent to approve;
- unsure (or it's a critical P1) → **sends it to a human**.

**Routing & assignment** — The ticket is sent to the team that owns its category.
Teams can auto-assign (round-robin or least-busy) or leave it for a dispatcher in
**Triage**. VIP requesters jump the priority.

**Working a ticket** — Agents reply (public) or add internal notes, insert
**macros** (canned replies), edit properties, attach files, and link/merge
duplicates. The conversation updates live.

**SLA & escalation** — Each ticket has a response and resolution deadline. At 80%
of the time it warns the team; if it breaches it escalates automatically. Putting
a ticket "on hold" pauses the clock.

**Approvals** — Catalog requests that need sign-off pause until a manager
approves (fulfilment resumes) or rejects (it's cancelled).

**Closing the loop** — Agents resolve tickets; requesters rate them (CSAT). A
reply to a resolved ticket reopens it; untouched resolved tickets auto-close
after 7 days.

**Automations** — Admin-defined "when → if → then" rules that run on ticket
events (created, updated, SLA at-risk/breached) to assign, tag, set fields, or
notify automatically.

**ITIL modules** — **Problems** (find root causes of repeat incidents),
**Changes** (approve and track changes), **CMDB** (systems and their
dependencies), **Knowledge** (articles the AI learns from).

**Notifications** — Everyone gets an in-app feed (updates live); email/Teams/Slack
delivery happens when configured, per each user's preferences.

**Audit** — Every step — AI decisions, assignments, replies, approvals, sign-ins
— is written to a hash-linked chain that can be verified for tampering.

---

## A few concepts (one line each)

- **Priority = Impact × Urgency** — e.g. High impact × High urgency = *critical (P1)*.
- **Statuses** — open → in progress → pending (on hold) / resolved → closed;
  `escalated`, `reopened`, `cancelled` along the way.
- **Groups** — teams that own categories (e.g. Network Operations owns "Network").
- **Reference** — every ticket has an id like `INC-8F3K2A` (INC/REQ/PRB/CHG).

---

## Run it (30 seconds)

```bash
npm install
npm run dev
# open http://localhost:3000, then pick a demo person to sign in
```

Demo logins (no password): **Dana** (requester), **Arjun** (agent), **Meera**
(manager), **Priya** (admin).

## Free vs paid (in three lines)

- **Free / demo**: runs with zero setup — a local file store, offline AI, and
  passwordless demo login.
- **Paid / production**: add real services and it "lights up" — a database, a real
  AI key, single sign-on, email, chat, and cloud storage. No code changes.
- **What you flip**: environment settings (see `.env.example`) plus in-app
  **Settings** (SLAs, routing, automations, API keys). Details in `instruction.md`.

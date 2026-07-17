import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// =============================================================================
// ITIL integration tests against the in-memory store (spec test cases).
//   TC1 — type-prefixed references (INC-/REQ-)
//   TC3 — impact x urgency recalculation + audited manual override
//   TC4 — staged SLA escalation (at-risk warning, breach escalate)
//   TC5 — category -> assignment-group routing
//   TC7 — service-request approval flow (hold -> approve/reject)
//   TC9 — RBAC permission matrix
// =============================================================================

import { getStore } from "@/server/data";
import { createTicket, getTicket, mutateTicket } from "@/server/services/ticketService";
import { updateTicketFields } from "@/server/services/agentActions";
import { intakeTicket } from "@/server/services/intake";
import { decideTicketApproval } from "@/server/services/approvalService";
import { routeTicketToGroup } from "@/server/services/groupService";
import { applySla } from "@/server/services/slaService";
import { slaSweep } from "@/server/jobs/scheduler";
import { can } from "@/server/auth/rbac";

const TENANT = "tenant_netlink";
const MIN = 60_000;

beforeAll(async () => {
  // Fresh seed for every suite run.
  const file = path.join(process.cwd(), ".data-test", "store.json");
  fs.rmSync(file, { force: true });
  await getStore();
});

describe("TC1 — ticket references", () => {
  it("prefixes incidents INC- and service requests REQ-", async () => {
    const inc = await createTicket(TENANT, {
      subject: "Broken monitor",
      body: "Screen flickers.",
      requesterEmail: "dana.lee@netlink.com",
      type: "incident",
    });
    const req = await createTicket(TENANT, {
      subject: "Need a second monitor",
      body: "For the new desk setup.",
      requesterEmail: "dana.lee@netlink.com",
      type: "service_request",
    });
    expect(inc.reference).toMatch(/^INC-/);
    expect(req.reference).toMatch(/^REQ-/);
  });
});

describe("TC3 — priority from impact x urgency", () => {
  it("derives priority on create and recalculates on impact/urgency edits", async () => {
    const t = await createTicket(TENANT, {
      subject: "Email service degraded",
      body: "Slow for everyone.",
      requesterEmail: "dana.lee@netlink.com",
      impact: "high",
      urgency: "high",
    });
    expect(t.priority).toBe("critical");

    const updated = await updateTicketFields(t.id, { impact: "low" }, { name: "Tester" });
    expect(updated?.priority).toBe("medium"); // low impact x high urgency
  });

  it("records an audited manual override with justification", async () => {
    const t = await createTicket(TENANT, {
      subject: "Printer jam on floor 3",
      body: "Paper stuck again.",
      requesterEmail: "dana.lee@netlink.com",
      impact: "low",
      urgency: "low",
    });
    expect(t.priority).toBe("very_low");

    const updated = await updateTicketFields(
      t.id,
      { priority: "high", priorityJustification: "VIP visitor demo this afternoon" },
      { name: "Tester" }
    );
    expect(updated?.priority).toBe("high");

    const store = await getStore();
    const audit = await store.audit.list({ tenantId: TENANT });
    const override = audit.find(
      (a) => a.action === "ticket.priority.overridden" && a.ticketId === t.id
    );
    expect(override).toBeTruthy();
    expect(override?.payload.justification).toBe("VIP visitor demo this afternoon");
    expect(override?.payload.derived).toBe("very_low");
  });
});

describe("TC5 — category routing to assignment groups", () => {
  it("routes Network tickets to the Network Operations group", async () => {
    const t = await createTicket(TENANT, {
      subject: "Switch port flapping",
      body: "Port 12 on the core switch keeps going down.",
      requesterEmail: "dana.lee@netlink.com",
      category: "Network",
      impact: "medium",
      urgency: "medium",
    });
    await routeTicketToGroup(t);

    const store = await getStore();
    const routed = await store.tickets.get(t.id);
    const groups = await store.groups.list({ tenantId: TENANT });
    const network = groups.find((g) => g.name === "Network Operations");
    expect(network).toBeTruthy();
    expect(routed?.assignmentGroupId).toBe(network!.id);
  });
});

describe("TC4 — staged SLA escalation", () => {
  it("warns at 80% of the window and escalates on breach", async () => {
    const store = await getStore();
    const now = Date.now();

    // At-risk: 90% of the resolution window consumed.
    const atRisk = await createTicket(TENANT, {
      subject: "Shared drive slow",
      body: "Files take minutes to open.",
      requesterEmail: "dana.lee@netlink.com",
      impact: "medium",
      urgency: "medium",
    });
    await store.tickets.update(atRisk.id, {
      createdAt: new Date(now - 90 * MIN).toISOString(),
      firstRespondedAt: new Date(now - 89 * MIN).toISOString(),
      dueResponseAt: new Date(now - 88 * MIN).toISOString(),
      dueResolveAt: new Date(now + 10 * MIN).toISOString(),
    });

    // Breached: resolution deadline already passed.
    const breached = await createTicket(TENANT, {
      subject: "CRM completely down",
      body: "Nobody can log in.",
      requesterEmail: "dana.lee@netlink.com",
      impact: "high",
      urgency: "high",
    });
    await store.tickets.update(breached.id, {
      createdAt: new Date(now - 300 * MIN).toISOString(),
      dueResponseAt: new Date(now - 280 * MIN).toISOString(),
      dueResolveAt: new Date(now - 60 * MIN).toISOString(),
    });

    await slaSweep();

    const warned = await store.tickets.get(atRisk.id);
    expect(warned?.tags).toContain("sla_at_risk");
    expect(warned?.status).not.toBe("escalated"); // warning only

    const esc = await store.tickets.get(breached.id);
    expect(esc?.tags).toContain("sla_breached");
    expect(esc?.status).toBe("escalated");

    // Both stages notified (manager and/or assignee) and were audited.
    const audit = await store.audit.list({ tenantId: TENANT });
    expect(audit.some((a) => a.action === "sla.at_risk" && a.ticketId === atRisk.id)).toBe(true);
    expect(audit.some((a) => a.action === "sla.breached" && a.ticketId === breached.id)).toBe(true);
  });

  it("skips tickets whose clock is paused", async () => {
    const store = await getStore();
    const now = Date.now();
    const paused = await createTicket(TENANT, {
      subject: "Waiting on vendor",
      body: "Third-party dependency.",
      requesterEmail: "dana.lee@netlink.com",
    });
    await store.tickets.update(paused.id, {
      status: "pending",
      slaPausedAt: new Date(now - 5 * MIN).toISOString(),
      dueResponseAt: new Date(now - 60 * MIN).toISOString(),
      dueResolveAt: new Date(now - 30 * MIN).toISOString(),
    });

    await slaSweep();
    const after = await store.tickets.get(paused.id);
    expect(after?.tags).not.toContain("sla_breached");
    expect(after?.status).toBe("pending");
  });
});

describe("SLA pause integration (mutateTicket)", () => {
  it("pauses on pending and shifts deadlines on resume", async () => {
    const store = await getStore();
    const t = await createTicket(TENANT, {
      subject: "Need info from requester",
      body: "Awaiting screenshots.",
      requesterEmail: "dana.lee@netlink.com",
      impact: "medium",
      urgency: "medium",
    });
    await applySla(t);
    const before = await store.tickets.get(t.id);

    await mutateTicket(t.id, { status: "pending" });
    const pausedTicket = await store.tickets.get(t.id);
    expect(pausedTicket?.slaPausedAt).toBeTruthy();

    // Simulate the pause having started 45 minutes ago, then resume.
    await store.tickets.update(t.id, {
      slaPausedAt: new Date(Date.now() - 45 * MIN).toISOString(),
    });
    await mutateTicket(t.id, { status: "in_progress" });

    const resumed = await store.tickets.get(t.id);
    expect(resumed?.slaPausedAt).toBeNull();
    expect(resumed?.slaPausedMins).toBeGreaterThanOrEqual(44);
    const shift =
      new Date(resumed!.dueResolveAt!).getTime() - new Date(before!.dueResolveAt!).getTime();
    expect(shift).toBeGreaterThanOrEqual(44 * MIN);
  });
});

describe("TC7 — service-request approvals", () => {
  async function approvalCatalogItemId(): Promise<string> {
    const store = await getStore();
    const items = await store.catalogItems.list({ tenantId: TENANT });
    const item = items.find((i) => i.requiresApproval);
    expect(item).toBeTruthy();
    return item!.id;
  }

  it("holds the request pending with a pending approval", async () => {
    const catalogItemId = await approvalCatalogItemId();
    const t = await intakeTicket(TENANT, {
      subject: "New laptop for contractor",
      body: "Standard build please.",
      requesterEmail: "dana.lee@netlink.com",
      type: "service_request",
      catalogItemId,
      autoResolve: false,
    });
    expect(t.status).toBe("pending");
    expect(t.slaPausedAt).toBeTruthy(); // clock paused while waiting

    const store = await getStore();
    const approvals = await store.approvals.list({ ticketId: t.id });
    expect(approvals.some((a) => a.state === "pending")).toBe(true);
  });

  it("rejecting cancels the ticket", async () => {
    const catalogItemId = await approvalCatalogItemId();
    const t = await intakeTicket(TENANT, {
      subject: "Software install: video editor",
      body: "Need it for a side project.",
      requesterEmail: "dana.lee@netlink.com",
      type: "service_request",
      catalogItemId,
      autoResolve: false,
    });
    const rejected = await decideTicketApproval(t.id, {
      decision: "rejected",
      approverName: "Meera Nair",
      comment: "Not business justified",
    });
    expect(rejected?.status).toBe("cancelled");
  });

  it("approving resumes fulfilment", async () => {
    const catalogItemId = await approvalCatalogItemId();
    const t = await intakeTicket(TENANT, {
      subject: "Application access: finance system",
      body: "Joining the finance team on Monday.",
      requesterEmail: "dana.lee@netlink.com",
      type: "service_request",
      catalogItemId,
      autoResolve: false,
    });
    await decideTicketApproval(t.id, { decision: "approved", approverName: "Meera Nair" });

    const after = await getTicket(t.id);
    expect(after?.status).not.toBe("pending");
    expect(after?.status).not.toBe("cancelled");

    const store = await getStore();
    const approvals = await store.approvals.list({ ticketId: t.id });
    expect(approvals.some((a) => a.state === "approved")).toBe(true);
    expect(after?.slaPausedMins).toBeGreaterThanOrEqual(0);
    expect(after?.slaPausedAt).toBeNull(); // clock resumed
  });
});

describe("TC9 — RBAC matrix", () => {
  it("keeps requesters read-only and reserves approvals for managers+", () => {
    expect(can("requester", "ticket.read")).toBe(true);
    expect(can("requester", "ticket.write")).toBe(false);
    expect(can("requester", "audit.read")).toBe(false);
    expect(can("agent", "ticket.write")).toBe(true);
    expect(can("agent", "change.approve")).toBe(false);
    expect(can("manager", "change.approve")).toBe(true);
    expect(can("tenant_admin", "admin")).toBe(true);
    expect(can(undefined, "ticket.read")).toBe(false);
  });
});

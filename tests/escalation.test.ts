import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getStore } from "@/server/data";
import { DISPATCH_ROLES } from "@/server/auth/rbac";
import { assignTicket, escalateTicket } from "@/server/services/agentActions";
import { intakeTicket } from "@/server/services/intake";
import { getTriageBoard } from "@/server/services/triageService";
import type { TicketRow, UserRow } from "@/server/domain/models";

const TENANT = "tenant_netlink";

beforeAll(async () => {
  const file = path.join(process.cwd(), ".data-test", "store.json");
  fs.rmSync(file, { force: true });
  await getStore();
});

async function anAgent(): Promise<UserRow> {
  const store = await getStore();
  const users = await store.users.list({ tenantId: TENANT });
  return users.find((u) => u.role === "agent" && u.active)!;
}

async function aTicket(subject: string): Promise<TicketRow> {
  return intakeTicket(TENANT, {
    subject,
    body: `${subject} — details from the requester.`,
    requesterEmail: "sam.patel@netlink.com",
    channel: "portal",
    category: "Network",
    autoResolve: false,
  });
}

describe("escalateTicket", () => {
  it("stores the reason, keeps the assignee, and notifies every dispatcher", async () => {
    const store = await getStore();
    const agent = await anAgent();
    const created = await aTicket("Core switch drops packets under load");
    await store.tickets.update(created.id, { assigneeId: agent.id, status: "in_progress" });

    const before = (await store.notifications.list({ tenantId: TENANT })).length;
    const reason = "Needs vendor RMA — I have no console access to the chassis.";
    const escalated = await escalateTicket(created.id, reason, { id: agent.id, name: agent.name });

    expect(escalated).toBeTruthy();
    expect(escalated!.status).toBe("escalated");
    expect(escalated!.escalationReason).toBe(reason);
    expect(escalated!.escalatedById).toBe(agent.id);
    expect(escalated!.escalatedAt).toBeTruthy();
    // Accountability: the person who could not resolve it still owns it until a
    // dispatcher moves it on.
    expect(escalated!.assigneeId).toBe(agent.id);

    const users = await store.users.list({ tenantId: TENANT });
    const dispatchers = users.filter((u) => u.active && DISPATCH_ROLES.includes(u.role));
    expect(dispatchers.length).toBeGreaterThan(0);

    const after = await store.notifications.list({ tenantId: TENANT });
    const fresh = after.slice(before);
    for (const dispatcher of dispatchers) {
      const mine = fresh.find((n) => n.toAddress === dispatcher.email);
      expect(mine, `no notification for ${dispatcher.email}`).toBeTruthy();
      expect(mine!.body).toContain(reason);
    }

    const events = await store.events.list({ ticketId: created.id });
    expect(events.some((e) => e.type === "escalated" && e.message.includes(reason))).toBe(true);

    const audit = await store.audit.list({ tenantId: TENANT });
    expect(audit.some((a) => a.action === "ticket.escalated.manual" && a.ticketId === created.id)).toBe(true);
  });

  it("refuses a blank reason", async () => {
    const agent = await anAgent();
    const created = await aTicket("Wi-Fi drops in the east wing");
    expect(await escalateTicket(created.id, "   ", { id: agent.id, name: agent.name })).toBeNull();
    const store = await getStore();
    expect((await store.tickets.get(created.id))!.status).not.toBe("escalated");
  });

  it("surfaces on the triage board even though it is still assigned", async () => {
    const store = await getStore();
    const agent = await anAgent();
    const created = await aTicket("VPN concentrator rejects certificates");
    await store.tickets.update(created.id, { assigneeId: agent.id, status: "in_progress" });
    await escalateTicket(created.id, "Certificate authority is managed by security.", {
      id: agent.id,
      name: agent.name,
    });

    const board = await getTriageBoard(TENANT);
    expect(board.escalations.some((t) => t.id === created.id)).toBe(true);
    // It has an owner, so it must not double up in the unassigned queue.
    expect(board.queue.some((t) => t.id === created.id)).toBe(false);
  });

  it("leaves the escalation lane once a dispatcher reassigns it", async () => {
    const store = await getStore();
    const users = await store.users.list({ tenantId: TENANT });
    const agents = users.filter((u) => u.role === "agent" && u.active);
    const [owner, next] = agents;
    const created = await aTicket("Firewall rule change breaks the print server");
    await store.tickets.update(created.id, { assigneeId: owner.id, status: "in_progress" });
    await escalateTicket(created.id, "Change was made by the security team.", {
      id: owner.id,
      name: owner.name,
    });

    const reassigned = await assignTicket(created.id, next.id, { name: "Meera Nair", role: "manager" });
    expect(reassigned!.assigneeId).toBe(next.id);
    expect(reassigned!.status).toBe("in_progress");
    // The context survives the handoff.
    expect(reassigned!.escalationReason).toBe("Change was made by the security team.");

    const board = await getTriageBoard(TENANT);
    expect(board.escalations.some((t) => t.id === created.id)).toBe(false);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getStore } from "@/server/data";
import { can } from "@/server/auth/rbac";
import { escalateTicket } from "@/server/services/agentActions";
import { intakeTicket } from "@/server/services/intake";
import { bulkAssignTickets, getTriageBoard } from "@/server/services/triageService";
import type { TicketRow, UserRow } from "@/server/domain/models";

const TENANT = "tenant_netlink";
const DISPATCHER: UserRow["role"] = "manager";

beforeAll(async () => {
  const file = path.join(process.cwd(), ".data-test", "store.json");
  fs.rmSync(file, { force: true });
  await getStore();
});

async function userWithRole(role: string): Promise<UserRow> {
  const store = await getStore();
  const users = await store.users.list({ tenantId: TENANT });
  return users.find((u) => u.role === role && u.active)!;
}

async function aTicket(subject: string): Promise<TicketRow> {
  return intakeTicket(TENANT, {
    subject,
    body: `${subject} — reported by the requester.`,
    requesterEmail: "sam.patel@netlink.com",
    channel: "portal",
    category: "Network",
    autoResolve: false,
  });
}

describe("dispatch permission", () => {
  it("is held by manager and above only", () => {
    expect(can("requester", "ticket.dispatch")).toBe(false);
    expect(can("agent", "ticket.dispatch")).toBe(false);
    expect(can("manager", "ticket.dispatch")).toBe(true);
    expect(can("tenant_admin", "ticket.dispatch")).toBe(true);
    expect(can("super_admin", "ticket.dispatch")).toBe(true);
  });
});

describe("bulkAssignTickets", () => {
  it("sends a batch to one person", async () => {
    const store = await getStore();
    const by = await userWithRole(DISPATCHER);
    const target = await userWithRole("agent");
    const tickets = await Promise.all([
      aTicket("DNS resolution intermittent on subnet A"),
      aTicket("DNS resolution intermittent on subnet B"),
    ]);

    const res = await bulkAssignTickets(TENANT, tickets.map((t) => t.id), by, target.id);
    expect(res.skipped).toHaveLength(0);
    expect(res.assigned).toHaveLength(2);
    expect(res.assigned.every((a) => a.assigneeId === target.id)).toBe(true);
    for (const t of tickets) {
      expect((await store.tickets.get(t.id))!.assigneeId).toBe(target.id);
    }
  });

  it("picks a best fit per ticket when no assignee is given", async () => {
    const by = await userWithRole(DISPATCHER);
    const ticket = await aTicket("Branch router flapping its BGP session");

    const res = await bulkAssignTickets(TENANT, [ticket.id], by);
    expect(res.assigned).toHaveLength(1);
    expect(res.assigned[0].assigneeId).toBeTruthy();
  });

  it("clears an escalation and returns it to the active queue", async () => {
    const store = await getStore();
    const by = await userWithRole(DISPATCHER);
    const owner = await userWithRole("agent");
    const ticket = await aTicket("Load balancer health checks fail after patch");
    await store.tickets.update(ticket.id, { assigneeId: owner.id, status: "in_progress" });
    await escalateTicket(ticket.id, "Vendor patch — needs their support engineer.", {
      id: owner.id,
      name: owner.name,
    });

    const res = await bulkAssignTickets(TENANT, [ticket.id], by);
    expect(res.assigned).toHaveLength(1);

    const after = (await store.tickets.get(ticket.id))!;
    expect(after.assigneeId).not.toBe(owner.id);
    expect(after.status).toBe("in_progress");
    const board = await getTriageBoard(TENANT);
    expect(board.escalations.some((t) => t.id === ticket.id)).toBe(false);
  });

  it("skips unknown ids instead of failing the whole batch", async () => {
    const by = await userWithRole(DISPATCHER);
    const ticket = await aTicket("Guest Wi-Fi captive portal loops");

    const res = await bulkAssignTickets(TENANT, [ticket.id, "tkt_does_not_exist"], by);
    expect(res.assigned.map((a) => a.ticketId)).toEqual([ticket.id]);
    expect(res.skipped).toEqual([{ ticketId: "tkt_does_not_exist", reason: "Not found." }]);
  });

  it("never reaches into another tenant", async () => {
    const by = await userWithRole(DISPATCHER);
    const ticket = await aTicket("Printer queue stuck in the Pune office");
    const res = await bulkAssignTickets("tenant_someone_else", [ticket.id], by);
    expect(res.assigned).toHaveLength(0);
    expect(res.skipped[0]).toEqual({ ticketId: ticket.id, reason: "Not found." });
  });
});

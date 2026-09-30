import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/server/data/memoryStore";
import { configureWorkflow, enterWorkflow, transitionWorkflow } from "@/server/services/workflowService";
import { defaultWorkflowSettings } from "@/shared/workflow";
import type { TicketRow, UserRow } from "@/server/domain/models";

async function fixture() {
  const store = new MemoryStore(false);
  const stamp = "2026-09-30T09:00:00.000Z";
  await store.tenants.create({ id: "org", name: "Org", slug: "org", isInternal: false, createdAt: stamp, updatedAt: stamp });
  const users: UserRow[] = ["admin", "manager", "rm", "desk", "agent", "other"].map((id) => ({ id, tenantId: "org", name: id, email: `${id}@example.test`, role: id === "admin" ? "tenant_admin" : ["manager", "rm"].includes(id) ? "manager" : "agent", active: true, createdAt: stamp, updatedAt: stamp }));
  for (const user of users) await store.users.create(user);
  await store.departments.create({ id: "it", tenantId: "org", name: "IT", createdAt: stamp, updatedAt: stamp });
  for (const [id, memberIds] of [["desk-group", ["desk"]], ["it-group", ["agent", "other"]]] as const) await store.groups.create({ id, tenantId: "org", name: id, memberIds: [...memberIds], categories: [], createdAt: stamp, updatedAt: stamp });
  const settings = { ...defaultWorkflowSettings(), enabled: true, serviceDeskGroupId: "desk-group", buckets: [
    { groupId: "desk-group", kind: "service_desk" as const, managerId: "manager", seniorRmId: "rm" },
    { groupId: "it-group", kind: "department" as const, departmentId: "it", managerId: "manager", seniorRmId: "rm" },
  ] };
  await configureWorkflow("org", settings, users[0], store);
  const ticket = { id: "ticket", tenantId: "org", type: "incident", subject: "VPN failure", body: "Cannot connect", requesterEmail: "requester@example.test", reference: "TKT-1", status: "open", priority: "medium", category: "Network", channel: "portal", tags: [], ciIds: [], linkedTicketIds: [], slaPausedMins: 0, createdAt: stamp, updatedAt: stamp, deletedAt: null, workflowVersion: 0 } satisfies TicketRow;
  await store.tickets.create(ticket);
  await enterWorkflow(ticket, store);
  return { store, users, settings };
}

describe("tenant bucket workflow", () => {
  it("requires service desk review before department pickup", async () => {
    const { store, users } = await fixture();
    await expect(transitionWorkflow("org", "ticket", users[4], { action: "pickup" }, store)).rejects.toThrow();
    await transitionWorkflow("org", "ticket", users[3], { action: "claim_review" }, store);
    const routed = await transitionWorkflow("org", "ticket", users[3], { action: "route", groupId: "it-group" }, store);
    expect(routed.assigneeId).toBeNull();
    expect(routed.workflow?.phase).toBe("department");
    const picked = await transitionWorkflow("org", "ticket", users[4], { action: "pickup" }, store);
    expect(picked.assigneeId).toBe("agent");
    expect(picked.workflow?.acceptedById).toBe("agent");
    expect(picked.status).toBe("in_progress");
  });

  it("has one winner under concurrent pickup and keeps audit history", async () => {
    const { store, users } = await fixture();
    await transitionWorkflow("org", "ticket", users[0], { action: "route", groupId: "it-group" }, store);
    const results = await Promise.allSettled(users.slice(4).map((actor) => transitionWorkflow("org", "ticket", actor, { action: "pickup" }, store)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await store.events.list({ ticketId: "ticket" })).filter((event) => event.type === "workflow.pickup")).toHaveLength(1);
  });

  it("assignment is an offer, only its recipient can accept, and declining keeps the original queue clock", async () => {
    const { store, users } = await fixture();
    await transitionWorkflow("org", "ticket", users[0], { action: "route", groupId: "it-group" }, store);
    const offered = await transitionWorkflow("org", "ticket", users[1], { action: "offer", userId: "agent" }, store);
    expect(offered.workflow?.phase).toBe("awaiting_acceptance");
    await expect(transitionWorkflow("org", "ticket", users[5], { action: "accept" }, store)).rejects.toThrow();
    const declined = await transitionWorkflow("org", "ticket", users[4], { action: "decline", reason: "Unavailable" }, store);
    expect(declined.workflow?.queuedAt).toBe(offered.workflow?.queuedAt);
    expect(declined.assigneeId).toBeNull();
  });

  it("rejects cross-tenant users, requesters, invalid bucket owners and pending approvals", async () => {
    const { store, users, settings } = await fixture();
    await expect(transitionWorkflow("other-org", "ticket", users[0], { action: "route", groupId: "it-group" }, store)).rejects.toThrow("Ticket not found");
    await expect(transitionWorkflow("org", "ticket", { ...users[4], role: "requester" }, { action: "claim_review" }, store)).rejects.toThrow();
    await expect(configureWorkflow("org", { ...settings, buckets: settings.buckets.map((b) => ({ ...b, managerId: "missing" })) }, users[0], store)).rejects.toThrow();
    await store.tickets.update("ticket", { status: "pending", slaPausedAt: new Date().toISOString() });
    await expect(transitionWorkflow("org", "ticket", users[0], { action: "route", groupId: "it-group" }, store)).rejects.toThrow("on hold");
  });
});

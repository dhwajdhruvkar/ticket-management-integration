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

  it("returns a misrouted department ticket to the service desk and restarts its clocks", async () => {
    const { store, users } = await fixture();
    await transitionWorkflow("org", "ticket", users[3], { action: "claim_review" }, store);
    const routed = await transitionWorkflow("org", "ticket", users[3], { action: "route", groupId: "it-group" }, store);
    await store.tickets.update("ticket", { workflow: { ...routed.workflow!, queuedAt: "2026-09-30T08:00:00.000Z", warningAt: "2026-09-30T08:30:00.000Z", managerEscalatedAt: "2026-09-30T08:40:00.000Z", rmEscalatedAt: "2026-09-30T08:50:00.000Z" } });
    const returned = await transitionWorkflow("org", "ticket", users[4], { action: "return_to_service_desk", reason: "Needs the network team" }, store);
    expect(returned).toMatchObject({ assignmentGroupId: "desk-group", assigneeId: null, status: "open" });
    expect(returned.workflow).toMatchObject({ phase: "service_desk", returns: [{ byId: "agent", fromGroupId: "it-group", reason: "Needs the network team" }] });
    expect(returned.workflow?.reviewerId).toBeUndefined();
    expect(returned.workflow?.visitId).not.toBe(routed.workflow?.visitId);
    expect(Date.parse(returned.workflow!.queuedAt)).toBeGreaterThan(Date.parse("2026-09-30T08:00:00.000Z"));
    expect(returned.workflow?.warningAt).toBeUndefined();
    expect(returned.workflow?.managerEscalatedAt).toBeUndefined();
    expect(returned.workflow?.rmEscalatedAt).toBeUndefined();
  });

  it("lets an accepting agent return work and clears the acceptance", async () => {
    const { store, users } = await fixture();
    await transitionWorkflow("org", "ticket", users[0], { action: "route", groupId: "it-group" }, store);
    await transitionWorkflow("org", "ticket", users[4], { action: "pickup" }, store);
    const returned = await transitionWorkflow("org", "ticket", users[4], { action: "return_to_service_desk", reason: "Belongs to facilities" }, store);
    expect(returned).toMatchObject({ assignmentGroupId: "desk-group", assigneeId: null, status: "open" });
    expect(returned.workflow?.phase).toBe("service_desk");
    expect(returned.workflow?.acceptedAt).toBeUndefined();
    expect(returned.workflow?.acceptedById).toBeUndefined();
  });

  it("rejects blank reasons, non-members and staff from another organization", async () => {
    const { store, users } = await fixture();
    await transitionWorkflow("org", "ticket", users[0], { action: "route", groupId: "it-group" }, store);
    await expect(transitionWorkflow("org", "ticket", users[4], { action: "return_to_service_desk", reason: "   " }, store)).rejects.toMatchObject({ status: 400 });
    await expect(transitionWorkflow("org", "ticket", users[3], { action: "return_to_service_desk", reason: "Wrong team" }, store)).rejects.toMatchObject({ status: 403 });
    await store.users.create({ ...users[4], id: "foreign", tenantId: "other-org", email: "foreign@example.test" });
    await expect(transitionWorkflow("org", "ticket", { id: "foreign", name: "foreign", role: "agent" }, { action: "return_to_service_desk", reason: "Wrong team" }, store)).rejects.toMatchObject({ status: 403 });
  });

  it("limits routing back to a returned group and after repeated returns to managers with a reason", async () => {
    const { store, users } = await fixture();
    await transitionWorkflow("org", "ticket", users[3], { action: "claim_review" }, store);
    await transitionWorkflow("org", "ticket", users[3], { action: "route", groupId: "it-group" }, store);
    await transitionWorkflow("org", "ticket", users[5], { action: "return_to_service_desk", reason: "Wrong team" }, store);
    await transitionWorkflow("org", "ticket", users[3], { action: "claim_review" }, store);
    await expect(transitionWorkflow("org", "ticket", users[3], { action: "route", groupId: "it-group", reason: "Trying again" }, store)).rejects.toMatchObject({ status: 403 });
    await expect(transitionWorkflow("org", "ticket", users[0], { action: "route", groupId: "it-group" }, store)).rejects.toMatchObject({ status: 400 });
    await transitionWorkflow("org", "ticket", users[0], { action: "route", groupId: "it-group", reason: "Confirmed with the requester" }, store);
    await transitionWorkflow("org", "ticket", users[5], { action: "return_to_service_desk", reason: "Still wrong" }, store);
    await transitionWorkflow("org", "ticket", users[3], { action: "claim_review" }, store);
    await expect(transitionWorkflow("org", "ticket", users[3], { action: "route", groupId: "it-group", reason: "Third try" }, store)).rejects.toMatchObject({ status: 403 });
    const managerRouted = await transitionWorkflow("org", "ticket", users[0], { action: "route", groupId: "it-group", reason: "Manager decision" }, store);
    expect(managerRouted.workflow).toMatchObject({ phase: "department", returns: [expect.anything(), expect.anything()] });
  });

  it("notifies the service desk manager once a ticket has been returned twice", async () => {
    const { store, users } = await fixture();
    await transitionWorkflow("org", "ticket", users[0], { action: "route", groupId: "it-group" }, store);
    await transitionWorkflow("org", "ticket", users[5], { action: "return_to_service_desk", reason: "Wrong team" }, store);
    const deskMail = async () => (await store.notifications.list({ tenantId: "org" })).filter((row) => row.toAddress === "manager@example.test");
    expect(await deskMail()).toHaveLength(0);
    await transitionWorkflow("org", "ticket", users[0], { action: "route", groupId: "it-group", reason: "Reconfirmed" }, store);
    await transitionWorkflow("org", "ticket", users[5], { action: "return_to_service_desk", reason: "Still wrong" }, store);
    const mail = await deskMail();
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toContain("returned to the Service Desk 2 times");
  });
});

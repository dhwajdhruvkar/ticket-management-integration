/** Run only against an explicitly selected disposable Neon branch; never production. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getStore } from "../src/server/data";
import { defaultWorkflowSettings } from "../src/shared/workflow";
import { configureWorkflow, transitionWorkflow } from "../src/server/services/workflowService";
import { createTicket, getTicket } from "../src/server/services/ticketService";
import { agentResolve, updateTicketFields, reopenTicket } from "../src/server/services/agentActions";
import { acknowledgeTicket } from "../src/server/services/ticketAcknowledgement";
import { acknowledgementToken } from "../src/server/notify/acknowledgementTokens";
import { getAgentPerformance } from "../src/server/services/agentPerformance";
import { appendAudit, verifyChain } from "../src/server/audit/auditChain";
import { acquireLease } from "../src/server/jobs/durableLease";

async function main() {
  const endpoint = process.env.WORKFLOW_TEST_ENDPOINT;
  assert(endpoint && new URL(process.env.DIRECT_URL!).hostname === endpoint, "Select a disposable test endpoint explicitly.");
  assert(process.env.EMAIL_PROVIDER === "none", "Disable external email during verification.");
  assert(process.env.DATA_DRIVER === "prisma");
  const store = await getStore();
  const suffix = randomUUID().slice(0, 8), tenantId = `workflow-test-${suffix}`, ts = new Date().toISOString();
  await store.tenants.create({ id: tenantId, slug: tenantId, name: "Workflow verification", isInternal: false, createdAt: ts, updatedAt: ts });
  const users = await Promise.all(["admin", "manager", "rm", "desk", "agent", "agent2"].map((name) => store.users.create({ id: `${tenantId}-${name}`, tenantId, name, email: `${name}.${suffix}@example.test`, role: name === "admin" ? "tenant_admin" : ["manager", "rm"].includes(name) ? "manager" : "agent", active: true, createdAt: ts, updatedAt: ts })));
  const [admin, manager, rm, desk, agent, agent2] = users;
  const departmentId = `${tenantId}-it`, deskGroup = `${tenantId}-desk`, groupId = `${tenantId}-it-group`;
  await store.departments.create({ id: departmentId, tenantId, name: "IT", createdAt: ts, updatedAt: ts });
  for (const [id, members] of [[deskGroup, [desk.id]], [groupId, [agent.id, agent2.id]]] as const) await store.groups.create({ id, tenantId, name: id === deskGroup ? "Service desk" : "IT bucket", memberIds: [...members], categories: [], createdAt: ts, updatedAt: ts });
  await configureWorkflow(tenantId, { ...defaultWorkflowSettings(), enabled: true, serviceDeskGroupId: deskGroup, buckets: [
    { groupId: deskGroup, kind: "service_desk", managerId: manager.id, seniorRmId: rm.id },
    { groupId, kind: "department", departmentId, managerId: manager.id, seniorRmId: rm.id },
  ] }, admin);
  assert.equal(await store.tickets.count({ tenantId }), 0);
  const ticket = await createTicket(tenantId, { subject: "VPN connection failure", body: "Cannot reach VPN", requesterEmail: "external@example.test" }, admin.name);
  assert.equal(ticket.workflow?.phase, "service_desk");
  assert.equal(await getTicket(ticket.id, "another-tenant"), null);
  await assert.rejects(transitionWorkflow("another-tenant", ticket.id, agent, { action: "pickup" }));
  await assert.rejects(agentResolve(ticket.id, agent), /Accept/);
  await transitionWorkflow(tenantId, ticket.id, desk, { action: "claim_review" });
  await transitionWorkflow(tenantId, ticket.id, desk, { action: "route", groupId });
  const picks = await Promise.allSettled([agent, agent2].map((actor) => transitionWorkflow(tenantId, ticket.id, actor, { action: "pickup" })));
  assert.equal(picks.filter((result) => result.status === "fulfilled").length, 1);
  const accepted = (await getTicket(ticket.id))!;
  const resolver = users.find((user) => user.id === accepted.assigneeId)!;
  await agentResolve(ticket.id, resolver, "VPN access restored.");
  const ack = (await store.acknowledgements.list({ tenantId, ticketId: ticket.id }))[0];
  assert(ack);
  const answers = await Promise.allSettled(["confirm", "reopen"].map((action) => acknowledgeTicket(acknowledgementToken(ack.id), action as "confirm" | "reopen")));
  assert.equal(answers.filter((result) => result.status === "fulfilled").length, 1);
  const report = await getAgentPerformance(tenantId, "month");
  assert.equal(report.rows.find((row) => row.id === resolver.id)?.resolutions, 1);
  const held = await createTicket(tenantId, { subject: "Approval hold", body: "Approval test", requesterEmail: "external@example.test" });
  await updateTicketFields(held.id, { status: "pending" }, admin);
  await assert.rejects(reopenTicket(held.id, admin), /Only a resolved/);
  assert.equal((await getTicket(held.id))?.status, "pending");
  await store.users.update(agent.id, { availabilitySettings: { capacity: 5 }, presenceSnapshot: null });
  await Promise.all([1, 2].map((n) => appendAudit({ tenantId, actor: "test", action: `concurrent.${n}` })));
  assert((await verifyChain(tenantId)).valid);
  await assert.rejects(store.transaction(async (tx) => { await tx.tenants.update(tenantId, { name: "must rollback" }); throw Error("rollback"); }), /rollback/);
  assert.equal((await store.tenants.get(tenantId))?.name, "Workflow verification");
  const leases = await Promise.all([1, 2].map(() => acquireLease(store, `verify-${suffix}`)));
  assert.equal(leases.filter(Boolean).length, 1);
  console.log(JSON.stringify({ passed: true, tenantId, adminEmail: admin.email, checks: ["fresh tenant", "tenant isolation", "human review", "concurrent pickup", "atomic resolution", "one-use acknowledgement", "actual-resolver performance", "approval hold", "nullable JSON", "concurrent audit", "transaction rollback", "lease race"] }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]") : "Verification failed"); process.exitCode = 1; }).finally(async () => {
  const global = globalThis as unknown as { __netlinkPrisma?: { $disconnect(): Promise<void> } };
  await global.__netlinkPrisma?.$disconnect();
});

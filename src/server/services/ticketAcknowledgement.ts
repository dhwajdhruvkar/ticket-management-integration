import { getStore } from "../data";
import type { DataStore } from "../data/store";
import { newId } from "../domain/ids";
import { appendAudit } from "../audit/auditChain";
import { digest, validAcknowledgementToken } from "../notify/acknowledgementTokens";
import { queueLifecycle } from "../notify/workflowOutbox";
import { WorkflowError } from "./workflowService";
import { publishEvent } from "../events/bus";
import { queueTicketWebhookEvent } from "./integrationWebhookService";

export async function acknowledgeTicket(token: string, action: "confirm" | "reopen", storeOverride?: DataStore, at = Date.now()) {
  const invalid = () => new WorkflowError("This confirmation link is no longer valid. Ask your service desk for help.", 400);
  const id = validAcknowledgementToken(token);
  if (!id) throw invalid();
  const store = storeOverride ?? await getStore();
  const stamp = new Date(at).toISOString();
  const result = await store.transaction(async (tx) => {
    const ack = await tx.acknowledgements.get(id);
    if (!ack || ack.tokenHash !== digest(token) || ack.usedAt || Date.parse(ack.expiresAt) <= at) throw invalid();
    const ticket = await tx.tickets.get(ack.ticketId);
    if (!ticket || ticket.tenantId !== ack.tenantId || ticket.deletedAt || !ticket.workflow || ticket.status !== "resolved" || ticket.resolvedAt !== ack.resolvedAt) throw invalid();
    if (!await tx.acknowledgements.updateIf(ack.id, { usedAt: null }, { usedAt: stamp })) throw invalid();
    const workflow = { ...ticket.workflow };
    if (action === "confirm") { workflow.phase = "closed"; workflow.confirmedAt = stamp; workflow.closureReason = "requester_confirmed"; }
    else {
      workflow.phase = "department"; workflow.queuedAt = stamp; workflow.queuedPauseMins = ticket.slaPausedMins ?? 0; workflow.queueWorkingPauseMins = 0; workflow.visitId = newId("visit");
      delete workflow.acceptedAt; delete workflow.acceptedById; delete workflow.resolvedById; delete workflow.confirmedAt; delete workflow.closureReason;
      delete workflow.warningAt; delete workflow.managerEscalatedAt; delete workflow.rmEscalatedAt; delete workflow.resolutionEscalatedAt; delete workflow.reminderAt;
      delete workflow.resolutionRmEscalatedAt;
    }
    const updated = await tx.tickets.updateIf(ticket.id, { tenantId: ack.tenantId, workflowVersion: ticket.workflowVersion }, {
      status: action === "confirm" ? "closed" : "reopened", workflow, workflowVersion: (ticket.workflowVersion ?? 0) + 1, updatedAt: stamp,
      ...(action === "confirm" ? { closedAt: stamp } : { closedAt: null, resolvedAt: null, resolvedById: null, assigneeId: null }) });
    if (!updated) throw invalid();
    const event = await tx.events.create({ id: newId("evt"), ticketId: ticket.id, type: action === "confirm" ? "closed" : "reopened",
      message: action === "confirm" ? "Requester confirmed that the issue is resolved." : "Requester reported that the issue is not resolved; returned to the department bucket.", createdAt: stamp });
    await queueLifecycle(tx, { ...updated, assigneeId: ticket.assigneeId }, event.id, event.type, undefined, at);
    await queueTicketWebhookEvent(updated, action === "confirm" ? "ticket.closed" : "ticket.reopened", tx);
    await queueTicketWebhookEvent(updated, "ticket.updated", tx);
    await appendAudit({ tenantId: ticket.tenantId, ticketId: ticket.id, actor: "requester:confirmation-link", action: `ticket.acknowledgement.${action}` }, tx);
    return updated;
  });
  publishEvent({ type: "ticket.updated", tenantId: result.tenantId, ticketId: result.id, ticketReference: result.reference, requesterEmail: result.requesterEmail });
  return { status: result.status, message: action === "confirm" ? "Thank you. Your confirmation has been recorded." : "The ticket has been reopened for the department team." };
}

// =============================================================================
// Service-request approvals.
//
// Catalog items flagged `requiresApproval` hold the ticket in `pending` (which
// pauses the SLA clock) with a pending Approval for the tenant manager. An
// approval resumes the normal intake pipeline (routing -> automations -> AI);
// a rejection cancels the ticket. Every decision is notified and audited.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { newId, now } from "../domain/ids";
import { notifyTemplate } from "../notify/templates";
import { getTicket, mutateTicket } from "./ticketService";
import type { ApprovalRow, CatalogItemRow, TicketRow, UserRow } from "../domain/models";

async function tenantApprover(tenantId: string): Promise<UserRow | null> {
  const store = await getStore();
  const users = await store.users.list({ tenantId });
  return users.find((u) => u.role === "manager") ?? users.find((u) => u.role === "tenant_admin") ?? null;
}

export async function listTicketApprovals(ticketId: string): Promise<ApprovalRow[]> {
  const store = await getStore();
  const rows = await store.approvals.list({ ticketId });
  return rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/** Hold the ticket pending approval and notify the approver + requester. */
export async function requestTicketApproval(
  ticket: TicketRow,
  catalogItem: CatalogItemRow
): Promise<ApprovalRow> {
  const store = await getStore();
  const approver = await tenantApprover(ticket.tenantId);

  const approval: ApprovalRow = {
    id: newId("apr"),
    changeId: null,
    ticketId: ticket.id,
    approverId: approver?.id ?? null,
    approverName: approver?.name ?? "Manager",
    state: "pending",
    comment: null,
    decidedAt: null,
    createdAt: now(),
  };
  await store.approvals.create(approval);

  await mutateTicket(
    ticket.id,
    { status: "pending" },
    {
      type: "approval_requested",
      message: `"${catalogItem.name}" requires approval — waiting on ${approval.approverName}.`,
    }
  );
  await appendAudit({
    tenantId: ticket.tenantId,
    actor: "system",
    action: "ticket.approval.requested",
    ticketId: ticket.id,
    payload: { catalogItem: catalogItem.name, approver: approval.approverName },
  });

  if (approver) {
    await notifyTemplate({
      tenantId: ticket.tenantId,
      to: approver.email,
      key: "approval_requested",
      link: `/tickets/${ticket.id}`,
      vars: {
        reference: ticket.reference,
        subject: ticket.subject,
        approver_name: approver.name,
        requester_name: ticket.requesterEmail,
      },
    });
  }
  return approval;
}

export interface ApprovalDecisionInput {
  decision: "approved" | "rejected";
  approverName: string;
  comment?: string;
}

/** Decide a pending ticket approval: approve resumes the pipeline, reject cancels. */
export async function decideTicketApproval(
  ticketId: string,
  input: ApprovalDecisionInput
): Promise<TicketRow | null> {
  const store = await getStore();
  const ticket = await getTicket(ticketId);
  if (!ticket) return null;
  const pending = (await store.approvals.list({ ticketId })).find((a) => a.state === "pending");
  if (!pending) return null;

  await store.approvals.update(pending.id, {
    state: input.decision,
    comment: input.comment ?? null,
    approverName: input.approverName,
    decidedAt: now(),
  });
  await appendAudit({
    tenantId: ticket.tenantId,
    actor: `approver:${input.approverName}`,
    action: `ticket.approval.${input.decision}`,
    ticketId,
    payload: { comment: input.comment ?? null },
  });

  const commentClause = input.comment ? ` with the comment: "${input.comment}"` : "";
  await notifyTemplate({
    tenantId: ticket.tenantId,
    to: ticket.requesterEmail,
    key: input.decision === "approved" ? "approval_approved" : "approval_rejected",
    link: `/tickets/${ticket.id}`,
    vars: {
      reference: ticket.reference,
      subject: ticket.subject,
      requester_name: ticket.requesterEmail,
      approver_name: input.approverName,
      comment_clause: commentClause,
    },
  });

  if (input.decision === "rejected") {
    return mutateTicket(
      ticketId,
      { status: "cancelled" },
      { type: "approval_rejected", message: `${input.approverName} rejected the request. Ticket cancelled.` }
    );
  }

  const reopened = await mutateTicket(
    ticketId,
    { status: "open" },
    { type: "approval_granted", message: `${input.approverName} approved the request. Fulfilment resumed.` }
  );
  // Resume the intake pipeline (routing -> automations -> AI). Dynamic import
  // avoids a static intake <-> approvals cycle.
  const { processTicketPipeline } = await import("./intake");
  await processTicketPipeline(ticketId).catch((err) => console.error("[approval] pipeline failed:", err));
  return (await getTicket(ticketId)) ?? reopened;
}

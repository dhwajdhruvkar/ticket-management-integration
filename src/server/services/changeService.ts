// =============================================================================
// Change Management.
//
// Change records carry a type (standard/normal/emergency), an AI risk score, a
// planned window, and a CAB approval workflow modeled as a state machine:
//   draft -> awaiting_approval -> (approved | rejected) -> scheduled ->
//   implementing -> review -> closed.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { assessChangeRisk } from "../ai/aiService";
import { getStore } from "../data";
import { newId, now, reference } from "../domain/ids";
import type {
  ApprovalRow,
  ApprovalState,
  ChangeRow,
  ChangeStatus,
  ChangeType,
} from "../domain/models";

export interface NewChangeInput {
  title: string;
  description: string;
  type?: ChangeType;
  plannedStart?: string;
  plannedEnd?: string;
  implementer?: string;
}

export interface ChangeView extends ChangeRow {
  approvals: ApprovalRow[];
}

export async function listChanges(tenantId: string): Promise<ChangeRow[]> {
  const store = await getStore();
  return (await store.changes.list({ tenantId })).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getChangeView(id: string): Promise<ChangeView | null> {
  const store = await getStore();
  const change = await store.changes.get(id);
  if (!change) return null;
  const approvals = await store.approvals.list({ changeId: id });
  return { ...change, approvals };
}

export async function createChange(tenantId: string, input: NewChangeInput): Promise<ChangeRow> {
  const store = await getStore();
  const type = input.type ?? "normal";
  const risk = await assessChangeRisk({ title: input.title, description: input.description, type });
  const change: ChangeRow = {
    id: newId("chg"),
    reference: reference("CHG"),
    tenantId,
    title: input.title.trim(),
    description: input.description.trim(),
    type,
    status: "draft",
    riskScore: risk.score,
    riskRationale: risk.rationale,
    plannedStart: input.plannedStart ?? null,
    plannedEnd: input.plannedEnd ?? null,
    implementer: input.implementer ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.changes.create(change);
  await appendAudit({
    tenantId,
    actor: "system",
    action: "change.created",
    payload: { reference: change.reference, type, riskScore: risk.score },
  });
  return change;
}

export async function updateChange(
  id: string,
  patch: Partial<ChangeRow>
): Promise<ChangeRow | null> {
  const store = await getStore();
  const existing = await store.changes.get(id);
  if (!existing) return null;
  return store.changes.update(id, { ...patch, updatedAt: now() });
}

/** Move to awaiting_approval and create approval requests for the approvers. */
export async function submitForApproval(
  id: string,
  approvers: { id?: string; name: string }[]
): Promise<ChangeView | null> {
  const store = await getStore();
  const change = await store.changes.get(id);
  if (!change) return null;

  for (const a of approvers) {
    const approval: ApprovalRow = {
      id: newId("apr"),
      changeId: id,
      ticketId: null,
      approverId: a.id ?? null,
      approverName: a.name,
      state: "pending",
      comment: null,
      decidedAt: null,
      createdAt: now(),
    };
    await store.approvals.create(approval);
  }
  await store.changes.update(id, { status: "awaiting_approval", updatedAt: now() });
  await appendAudit({
    tenantId: change.tenantId,
    actor: "system",
    action: "change.submitted",
    payload: { id, approvers: approvers.map((a) => a.name) },
  });
  return getChangeView(id);
}

/** Record a CAB decision; advance the change when all approvals resolve. */
export async function decideApproval(
  approvalId: string,
  state: Extract<ApprovalState, "approved" | "rejected">,
  approver: { name: string },
  comment?: string
): Promise<ChangeView | null> {
  const store = await getStore();
  const approval = await store.approvals.get(approvalId);
  if (!approval || !approval.changeId) return null;

  await store.approvals.update(approvalId, { state, comment: comment ?? null, decidedAt: now() });
  const change = await store.changes.get(approval.changeId);
  if (!change) return null;

  const all = await store.approvals.list({ changeId: approval.changeId });
  let nextStatus: ChangeStatus = change.status;
  if (all.some((a) => a.state === "rejected")) nextStatus = "rejected";
  else if (all.every((a) => a.state === "approved")) nextStatus = "approved";

  if (nextStatus !== change.status) {
    await store.changes.update(change.id, { status: nextStatus, updatedAt: now() });
  }
  await appendAudit({
    tenantId: change.tenantId,
    actor: `approver:${approver.name}`,
    action: `change.approval.${state}`,
    payload: { changeId: change.id, approvalId, nextStatus },
  });
  return getChangeView(change.id);
}

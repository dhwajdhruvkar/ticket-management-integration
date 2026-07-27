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

export async function getChangeView(id: string, tenantId?: string): Promise<ChangeView | null> {
  const store = await getStore();
  const change = await store.changes.get(id);
  if (!change) return null;
  if (tenantId && change.tenantId !== tenantId) return null;
  const approvals = await store.approvals.list({ changeId: id });
  return { ...change, approvals };
}

/**
 * Legal next states for a change, per the CAB workflow. Anything not listed is
 * rejected: without this the API happily moved a rejected change straight to
 * `closed`, skipping the whole approval story the audit trail is meant to tell.
 */
const CHANGE_TRANSITIONS: Record<ChangeStatus, ChangeStatus[]> = {
  draft: ["assessing", "awaiting_approval", "cancelled"],
  assessing: ["awaiting_approval", "draft", "cancelled"],
  awaiting_approval: ["approved", "rejected", "cancelled"],
  approved: ["scheduled", "cancelled"],
  rejected: ["draft", "cancelled"],
  scheduled: ["implementing", "cancelled"],
  implementing: ["review", "cancelled"],
  review: ["closed"],
  closed: [],
  cancelled: [],
};

export class ChangeStateError extends Error {}

export function canTransitionChange(from: ChangeStatus, to: ChangeStatus): boolean {
  return from === to || CHANGE_TRANSITIONS[from].includes(to);
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
  patch: Partial<ChangeRow>,
  options: { tenantId?: string; actor?: string } = {}
): Promise<ChangeRow | null> {
  const store = await getStore();
  const existing = await store.changes.get(id);
  if (!existing) return null;
  if (options.tenantId && existing.tenantId !== options.tenantId) return null;

  // Identity and tenancy are never patchable from the API surface.
  const { id: _id, tenantId: _tenantId, reference: _ref, createdAt: _created, ...safe } = patch;

  if (safe.status && safe.status !== existing.status) {
    if (!canTransitionChange(existing.status, safe.status)) {
      throw new ChangeStateError(
        `A change cannot move from ${existing.status.replace(/_/g, " ")} to ${safe.status.replace(/_/g, " ")}.`
      );
    }
    await appendAudit({
      tenantId: existing.tenantId,
      actor: options.actor ?? "system",
      action: `change.${safe.status}`,
      payload: { id, from: existing.status, to: safe.status },
    });
  }

  return store.changes.update(id, { ...safe, updatedAt: now() });
}

/** Move to awaiting_approval and create approval requests for the approvers. */
export async function submitForApproval(
  id: string,
  approvers: { id?: string; name: string }[],
  options: { tenantId?: string } = {}
): Promise<ChangeView | null> {
  const store = await getStore();
  const change = await store.changes.get(id);
  if (!change) return null;
  if (options.tenantId && change.tenantId !== options.tenantId) return null;
  if (!canTransitionChange(change.status, "awaiting_approval")) {
    throw new ChangeStateError(
      change.status === "awaiting_approval"
        ? "This change is already with the CAB."
        : `A ${change.status.replace(/_/g, " ")} change cannot be submitted for approval.`
    );
  }

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
  comment?: string,
  options: { tenantId?: string } = {}
): Promise<ChangeView | null> {
  const store = await getStore();
  const approval = await store.approvals.get(approvalId);
  if (!approval || !approval.changeId) return null;

  const change = await store.changes.get(approval.changeId);
  if (!change) return null;
  if (options.tenantId && change.tenantId !== options.tenantId) return null;
  // A decision is final. Re-deciding would silently rewrite a CAB outcome and,
  // worse, could flip an already-scheduled change back to rejected.
  if (approval.state !== "pending") {
    throw new ChangeStateError(
      `This approval was already ${approval.state} and cannot be changed.`
    );
  }

  await store.approvals.update(approvalId, { state, comment: comment ?? null, decidedAt: now() });

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

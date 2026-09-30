import { z } from "zod";
import { getStore } from "../data";
import type { DataStore } from "../data/store";
import type { TicketRow, UserRow } from "../domain/models";
import { newId, now } from "../domain/ids";
import { appendAudit } from "../audit/auditChain";
import { defaultWorkflowSettings, type TicketWorkflow, type WorkflowSettings } from "@/shared/workflow";
import { publishEvent } from "../events/bus";
import { queueLifecycle } from "../notify/workflowOutbox";
import { calendarMinutesBetween, type CalendarSpec } from "./slaService";
import { queueTicketWebhookEvent } from "./integrationWebhookService";

export class WorkflowError extends Error {
  constructor(message: string, readonly status = 409) { super(message); this.name = "WorkflowError"; }
}
const staffRoles = new Set(["agent", "manager", "tenant_admin", "super_admin"]);
const managers = new Set(["manager", "tenant_admin", "super_admin"]);
export interface WorkflowActor { id?: string; name: string; role?: string }
const Stage = z.object({ pickupMins: z.number().int().min(1).max(43200), managerMins: z.number().int().min(1).max(43200) });
export const WorkflowSettingsSchema = z.object({
  enabled: z.boolean(), serviceDeskGroupId: z.string().max(100),
  timezone: z.string().max(100).refine((zone) => { try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; } }, "Invalid timezone"),
  availabilityMode: z.enum(["automatic", "in_app"]),
  stages: z.object({ critical: Stage, high: Stage, medium: Stage, low: Stage, very_low: Stage }),
  buckets: z.array(z.object({ groupId: z.string().min(1).max(100), kind: z.enum(["service_desk", "department"]),
    departmentId: z.string().max(100).optional(), managerId: z.string().min(1).max(100), seniorRmId: z.string().min(1).max(100) })).max(100),
});
export const WorkflowActionSchema = z.object({
  action: z.enum(["claim_review", "route", "pickup", "offer", "accept", "decline", "release"]),
  groupId: z.string().max(100).optional(), userId: z.string().max(100).optional(), reason: z.string().trim().max(500).optional(),
});
export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;

/** Shared guard for legacy PATCH, automation and AI mutation paths. */
export async function workflowMutationPatch(ticket: TicketRow, patch: Partial<TicketRow>, meta?: Record<string, unknown>): Promise<Partial<TicketRow>> {
  if (!ticket.workflow) return patch;
  if (patch.workflow !== undefined || patch.workflowVersion !== undefined ||
      (patch.assigneeId !== undefined && patch.assigneeId !== ticket.assigneeId) ||
      (patch.assignmentGroupId !== undefined && patch.assignmentGroupId !== ticket.assignmentGroupId)) throw new WorkflowError("Use the bucket workflow to route or accept this ticket.");
  const workflow = { ...ticket.workflow };
  const result = { ...patch };
  if (ticket.slaPausedAt && patch.slaPausedAt === null) {
    const store = await getStore();
    const policy = (await store.slaPolicies.list({ tenantId: ticket.tenantId, priority: ticket.priority }))[0];
    const named = policy?.calendarId ? await store.calendars.get(policy.calendarId) : null;
    const settings = (await store.tenants.get(ticket.tenantId))?.workflowSettings;
    const calendar: CalendarSpec | null = named?.tenantId === ticket.tenantId ? named : policy?.businessHoursOnly
      ? { timezone: settings?.timezone ?? "UTC", workDays: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, holidays: [] } : null;
    if (calendar) workflow.queueWorkingPauseMins = (workflow.queueWorkingPauseMins ?? 0) + calendarMinutesBetween(new Date(Math.max(Date.parse(ticket.slaPausedAt), Date.parse(workflow.queuedAt))), new Date(), calendar);
  }
  if (patch.status === "auto_resolved") throw new WorkflowError("This workflow requires human resolution.");
  if (patch.status === "in_progress" && !workflow.acceptedAt) throw new WorkflowError("Accept the ticket from its department bucket first.");
  if (patch.status === "resolved") {
    if (["resolved", "closed", "cancelled"].includes(ticket.status)) throw new WorkflowError("This ticket is already finished. Reopen it before resolving again.");
    if (!workflow.acceptedAt) throw new WorkflowError("Accept the ticket before resolving it.");
    const store = await getStore();
    const resolver = typeof meta?.actorId === "string" ? await store.users.get(meta.actorId) : null;
    if (!resolver?.active || resolver.tenantId !== ticket.tenantId || !staffRoles.has(resolver.role) || (resolver.id !== ticket.assigneeId && !managers.has(resolver.role))) throw new WorkflowError("The accepted agent or an organization manager must resolve this ticket.", 403);
    workflow.phase = "resolved"; workflow.resolvedById = resolver.id;
    delete workflow.confirmedAt; delete workflow.closureReason; delete workflow.reminderAt;
    result.resolvedById = resolver.id;
  }
  if (patch.status === "closed") {
    if (ticket.status !== "resolved" || !["requester_confirmed", "no_response"].includes(String(meta?.closureReason))) throw new WorkflowError("Await requester confirmation or the seven-day no-response closure.");
    workflow.phase = "closed";
    workflow.closureReason = meta!.closureReason as "requester_confirmed" | "no_response";
    if (workflow.closureReason === "requester_confirmed") workflow.confirmedAt = now();
  }
  if (patch.status === "reopened") {
    if (!["resolved", "closed", "auto_resolved"].includes(ticket.status)) throw new WorkflowError("Only a resolved or closed ticket can be reopened.");
    workflow.phase = workflow.reviewedAt ? "department" : "service_desk";
    workflow.queuedAt = now(); workflow.queuedPauseMins = patch.slaPausedMins ?? ticket.slaPausedMins ?? 0; workflow.queueWorkingPauseMins = 0; workflow.visitId = newId("visit");
    delete workflow.acceptedAt; delete workflow.acceptedById; delete workflow.confirmedAt; delete workflow.closureReason;
    delete workflow.warningAt; delete workflow.managerEscalatedAt; delete workflow.rmEscalatedAt; delete workflow.resolutionEscalatedAt;
    delete workflow.resolutionRmEscalatedAt; delete workflow.resolvedById; delete workflow.reminderAt;
    result.assigneeId = null; result.resolvedById = null;
  }
  return { ...result, workflow, workflowVersion: (ticket.workflowVersion ?? 0) + 1 };
}

async function requireStaff(store: DataStore, tenantId: string, actor: WorkflowActor): Promise<UserRow> {
  const user = actor.id ? await store.users.get(actor.id) : null;
  if (!staffRoles.has(actor.role ?? "") || !user?.active || user.tenantId !== tenantId || !staffRoles.has(user.role)) throw new WorkflowError("An active organization staff account is required.", 403);
  return user;
}

export async function configureWorkflow(tenantId: string, input: WorkflowSettings, actor: WorkflowActor, storeOverride?: DataStore) {
  const store = storeOverride ?? await getStore();
  const settings = WorkflowSettingsSchema.parse(input);
  return store.transaction(async (tx) => {
    const admin = await requireStaff(tx, tenantId, actor);
    if (!["tenant_admin", "super_admin"].includes(admin.role)) throw new WorkflowError("Only organization administrators can configure the workflow.", 403);
    if (!await tx.tenants.get(tenantId)) throw new WorkflowError("Organization not found.", 404);
    const groups = await tx.groups.list({ tenantId });
    const users = await tx.users.list({ tenantId, active: true });
    if (new Set(settings.buckets.map((bucket) => bucket.groupId)).size !== settings.buckets.length) throw new WorkflowError("Each group can have only one bucket configuration.", 400);
    for (const bucket of settings.buckets) {
      const group = groups.find((row) => row.id === bucket.groupId);
      if (!group) throw new WorkflowError("Bucket group not found in this organization.", 400);
      if (bucket.managerId === bucket.seniorRmId) throw new WorkflowError("Choose different manager and senior RM accounts.", 400);
      for (const id of [bucket.managerId, bucket.seniorRmId]) if (!users.some((user) => user.id === id && managers.has(user.role))) throw new WorkflowError("Bucket owners must be active managers or administrators in this organization.", 400);
      if (bucket.kind === "department") {
        const dept = bucket.departmentId ? await tx.departments.get(bucket.departmentId) : null;
        if (!dept || dept.tenantId !== tenantId) throw new WorkflowError("Choose a department in this organization.", 400);
      }
      if (settings.enabled && !users.some((user) => group.memberIds.includes(user.id) && staffRoles.has(user.role))) throw new WorkflowError("Each enabled bucket needs an active staff member.", 400);
    }
    const desks = settings.buckets.filter((bucket) => bucket.kind === "service_desk");
    if (settings.enabled && (desks.length !== 1 || desks[0].groupId !== settings.serviceDeskGroupId || !settings.buckets.some((bucket) => bucket.kind === "department"))) throw new WorkflowError("Configure one service-desk bucket and at least one department bucket before enabling.", 400);
    const active = await tx.tickets.list({ tenantId, deletedAt: null });
    if (active.some((ticket) => ticket.workflow && !["closed", "cancelled"].includes(ticket.status) && !settings.buckets.some((bucket) => bucket.groupId === ticket.assignmentGroupId))) throw new WorkflowError("A bucket with active workflow tickets cannot be removed.");
    await tx.tenants.update(tenantId, { workflowSettings: settings, updatedAt: now() });
    await appendAudit({ tenantId, actor: admin.name, action: "workflow.configured", payload: { enabled: settings.enabled, buckets: settings.buckets.length } }, tx);
    return settings;
  });
}

export async function enterWorkflow(ticket: TicketRow, storeOverride?: DataStore): Promise<TicketRow> {
  const store = storeOverride ?? await getStore();
  const settings = (await store.tenants.get(ticket.tenantId))?.workflowSettings;
  if (!settings?.enabled || ticket.workflow || !["incident", "service_request"].includes(ticket.type)) return ticket;
  const stamp = now();
  return store.transaction(async (tx) => {
    const current = await tx.tickets.get(ticket.id);
    if (!current || current.workflow) return current ?? ticket;
    const workflow: TicketWorkflow = { phase: "service_desk", queuedAt: stamp, queuedPauseMins: ticket.slaPausedMins ?? 0, visitId: newId("visit") };
    const updated = await tx.tickets.updateIf(ticket.id, { tenantId: ticket.tenantId, workflowVersion: current.workflowVersion }, {
      workflow, workflowVersion: (current.workflowVersion ?? 0) + 1, assignmentGroupId: settings.serviceDeskGroupId, assigneeId: null,
    });
    if (!updated) throw new WorkflowError("Ticket changed. Refresh and try again.");
    await tx.events.create({ id: newId("evt"), ticketId: ticket.id, type: "workflow.received", message: "Entered the service-desk review bucket.", createdAt: stamp });
    await appendAudit({ tenantId: ticket.tenantId, actor: "intake", action: "workflow.received", ticketId: ticket.id }, tx);
    return updated;
  });
}

export async function transitionWorkflow(tenantId: string, ticketId: string, actor: WorkflowActor, input: WorkflowAction, storeOverride?: DataStore): Promise<TicketRow> {
  const store = storeOverride ?? await getStore();
  const updated = await store.transaction(async (tx) => {
    const ticket = await tx.tickets.get(ticketId);
    if (!ticket || ticket.tenantId !== tenantId || ticket.deletedAt) throw new WorkflowError("Ticket not found.", 404);
    const user = await requireStaff(tx, tenantId, actor);
    if (!ticket.workflow) throw new WorkflowError("This ticket uses the legacy workflow.");
    if (["resolved", "auto_resolved", "closed", "cancelled"].includes(ticket.status)) throw new WorkflowError("This ticket is no longer awaiting work.");
    if (ticket.slaPausedAt || ticket.status === "pending") throw new WorkflowError("This ticket is on hold; complete the approval or waiting step first.");
    const settings = (await tx.tenants.get(tenantId))?.workflowSettings ?? defaultWorkflowSettings();
    const group = ticket.assignmentGroupId ? await tx.groups.get(ticket.assignmentGroupId) : null;
    const manager = managers.has(user.role);
    const member = !!group && group.tenantId === tenantId && group.memberIds.includes(user.id);
    const workflow = { ...ticket.workflow };
    const stamp = now();
    const patch: Partial<TicketRow> = {};
    switch (input.action) {
      case "claim_review":
        if (workflow.phase !== "service_desk" || (!member && !manager) || workflow.reviewerId) throw new WorkflowError("Review is unavailable or already claimed.");
        workflow.reviewerId = user.id;
        break;
      case "route": {
        if (workflow.phase !== "service_desk" || (!manager && workflow.reviewerId !== user.id)) throw new WorkflowError("Claim the service-desk review before routing.", 403);
        const target = settings.buckets.find((bucket) => bucket.groupId === input.groupId && bucket.kind === "department");
        if (!target) throw new WorkflowError("Choose a configured department bucket.", 400);
        Object.assign(workflow, { phase: "department", reviewerId: workflow.reviewerId ?? user.id, reviewedAt: stamp, queuedAt: stamp, queuedPauseMins: ticket.slaPausedMins ?? 0, queueWorkingPauseMins: 0, visitId: newId("visit") });
        delete workflow.warningAt; delete workflow.managerEscalatedAt; delete workflow.rmEscalatedAt;
        patch.assignmentGroupId = target.groupId; patch.assigneeId = null; patch.status = "open";
        break;
      }
      case "offer": {
        if (!manager || !["department", "awaiting_acceptance"].includes(workflow.phase)) throw new WorkflowError("Only a dispatcher can offer a department-queue ticket.", 403);
        const target = input.userId ? await tx.users.get(input.userId) : null;
        if (!target?.active || target.tenantId !== tenantId || !staffRoles.has(target.role) || !group?.memberIds.includes(target.id)) throw new WorkflowError("Choose an active staff member of this department bucket.", 400);
        patch.assigneeId = target.id; workflow.phase = "awaiting_acceptance";
        break;
      }
      case "pickup":
      case "accept":
        if (input.action === "pickup" ? workflow.phase !== "department" || !member : workflow.phase !== "awaiting_acceptance" || ticket.assigneeId !== user.id || !member) throw new WorkflowError("This ticket cannot be accepted by you or was already picked up.");
        Object.assign(workflow, { phase: "in_progress", acceptedAt: stamp, acceptedById: user.id });
        patch.assigneeId = user.id; patch.status = "in_progress";
        break;
      case "decline":
      case "release":
        if (!input.reason?.trim()) throw new WorkflowError("A reason is required.", 400);
        if ((input.action === "decline" && workflow.phase !== "awaiting_acceptance") || (input.action === "release" && workflow.phase !== "in_progress") || (!manager && ticket.assigneeId !== user.id)) throw new WorkflowError("Only the assigned agent or a dispatcher can return this ticket.", 403);
        workflow.phase = "department";
        if (input.action === "release") { workflow.queuedAt = stamp; workflow.queuedPauseMins = ticket.slaPausedMins ?? 0; workflow.queueWorkingPauseMins = 0; workflow.visitId = newId("visit"); delete workflow.warningAt; delete workflow.managerEscalatedAt; delete workflow.rmEscalatedAt; }
        delete workflow.acceptedAt; delete workflow.acceptedById;
        patch.assigneeId = null; patch.status = "open";
        break;
    }
    const result = await tx.tickets.updateIf(ticket.id, { tenantId, workflowVersion: ticket.workflowVersion }, { ...patch, workflow, workflowVersion: (ticket.workflowVersion ?? 0) + 1, updatedAt: stamp });
    if (!result) throw new WorkflowError("Ticket changed. Refresh and try again.");
    const event = await tx.events.create({ id: newId("evt"), ticketId, type: `workflow.${input.action}`, message: `${user.name}: ${input.action.replaceAll("_", " ")}${input.reason ? ` — ${input.reason}` : ""}.`, meta: { actorId: user.id, phase: workflow.phase, groupId: result.assignmentGroupId }, createdAt: stamp });
    await queueLifecycle(tx, { ...result, assigneeId: result.assigneeId ?? ticket.assigneeId }, event.id, event.type);
    await queueTicketWebhookEvent(result, "ticket.updated", tx);
    await appendAudit({ tenantId, ticketId, actor: user.name, action: `workflow.${input.action}`, payload: { phase: workflow.phase, groupId: result.assignmentGroupId } }, tx);
    return result;
  });
  publishEvent({ type: "ticket.updated", tenantId, ticketId, ticketReference: updated.reference, requesterEmail: updated.requesterEmail });
  return updated;
}

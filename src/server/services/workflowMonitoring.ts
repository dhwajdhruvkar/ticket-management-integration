import type { BusinessCalendarRow, SlaPolicyRow, TicketRow } from "../domain/models";
import type { WorkflowSettings } from "@/shared/workflow";
import { addCalendarMinutes, type CalendarSpec } from "./slaService";
import type { DataStore } from "../data/store";
import { defaultWorkflowSettings } from "@/shared/workflow";
import { queueLifecycle, queueWorkflowNotice } from "../notify/workflowOutbox";
import { newId } from "../domain/ids";
import { appendAudit } from "../audit/auditChain";
import { WorkflowError } from "./workflowService";
import { queueTicketWebhookEvent } from "./integrationWebhookService";

export interface BucketHealth {
  level: "on_track" | "warning" | "manager" | "senior_rm" | "paused" | "accepted" | "finished";
  warningDueAt?: string;
  managerDueAt?: string;
  rmDueAt?: string;
}

function workflowCalendar(tenantId: string, settings: WorkflowSettings, policy: SlaPolicyRow | null, calendar: BusinessCalendarRow | null): CalendarSpec | null {
  return calendar?.tenantId === tenantId ? calendar : policy?.businessHoursOnly
    ? { timezone: settings.timezone, workDays: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, holidays: [] } : null;
}

export function bucketHealth(ticket: TicketRow, settings: WorkflowSettings, policy: SlaPolicyRow | null, calendar: BusinessCalendarRow | null, at = Date.now()): BucketHealth {
  const workflow = ticket.workflow;
  if (!workflow || ticket.deletedAt || ["resolved", "auto_resolved", "closed", "cancelled"].includes(ticket.status)) return { level: "finished" };
  if (workflow.phase === "in_progress") return { level: "accepted" };
  const stage = settings.stages[ticket.priority];
  const effectiveCalendar = workflowCalendar(ticket.tenantId, settings, policy, calendar);
  const queued = new Date(workflow.queuedAt);
  const shift = Math.max(0, (ticket.slaPausedMins ?? 0) - (workflow.queuedPauseMins ?? 0)) * 60_000;
  const deadline = (minutes: number) => effectiveCalendar ? addCalendarMinutes(queued, minutes + (workflow.queueWorkingPauseMins ?? 0), effectiveCalendar).getTime() : queued.getTime() + minutes * 60_000 + shift;
  const warning = deadline(stage.pickupMins * 0.8);
  const manager = deadline(stage.pickupMins);
  const rm = deadline(stage.pickupMins + stage.managerMins);
  return { level: ticket.slaPausedAt || ticket.status === "pending" ? "paused" : at >= rm ? "senior_rm" : at >= manager ? "manager" : at >= warning ? "warning" : "on_track",
    warningDueAt: new Date(warning).toISOString(), managerDueAt: new Date(manager).toISOString(), rmDueAt: new Date(rm).toISOString() };
}

/** Each ticket's markers, in-app notices and email jobs commit together. */
export async function monitorWorkflowTicket(store: DataStore, ticketId: string, at = Date.now()): Promise<boolean> {
  return store.transaction(async (tx) => {
    const ticket = await tx.tickets.get(ticketId);
    if (!ticket?.workflow || ticket.deletedAt || ["closed", "cancelled"].includes(ticket.status)) return false;
    const settings = (await tx.tenants.get(ticket.tenantId))?.workflowSettings ?? defaultWorkflowSettings();
    const policy = (await tx.slaPolicies.list({ tenantId: ticket.tenantId, priority: ticket.priority }))[0] ?? null;
    const calendar = policy?.calendarId ? await tx.calendars.get(policy.calendarId) : null;
    const health = bucketHealth(ticket, settings, policy, calendar, at);
    const workflow = { ...ticket.workflow };
    const stamp = new Date(at).toISOString();
    const users = await tx.users.list({ tenantId: ticket.tenantId, active: true });
    const group = ticket.assignmentGroupId ? await tx.groups.get(ticket.assignmentGroupId) : null;
    const bucket = settings.buckets.find((row) => row.groupId === ticket.assignmentGroupId);
    const owner = (id?: string) => users.find((user) => user.id === id && ["manager", "tenant_admin", "super_admin"].includes(user.role))
      ?? users.find((user) => ["tenant_admin", "super_admin"].includes(user.role));
    const manager = owner(bucket?.managerId), rm = owner(bucket?.seniorRmId);
    let changed = false;
    const alert = async (kind: string, label: string, targets: string[]) => {
      const event = await tx.events.create({ id: newId("evt"), ticketId, type: `workflow.${kind}`, message: label, createdAt: stamp });
      for (const email of new Set(targets)) await queueWorkflowNotice(tx, ticket, event.id, email, `[${ticket.reference}] ${label}`, `${ticket.reference}: ${ticket.subject}\n${label}\nOpen the bucket board to review or assign this work.`, null, at);
      await appendAudit({ tenantId: ticket.tenantId, actor: "workflow-monitor", action: `workflow.${kind}`, ticketId,
        payload: { visitId: workflow.visitId, ownerFallback: !bucket || !users.some((user) => user.id === bucket.managerId) || !users.some((user) => user.id === bucket.seniorRmId) } }, tx);
      changed = true;
    };
    const managerEmails = manager ? [manager.email] : [];
    const rmEmails = [...managerEmails, ...(rm ? [rm.email] : [])];
    if (!["paused", "accepted", "finished"].includes(health.level)) {
      if (at >= Date.parse(health.warningDueAt!) && !workflow.warningAt) {
        workflow.warningAt = stamp;
        const members = users.filter((user) => group?.memberIds.includes(user.id) && ["agent", "manager", "tenant_admin", "super_admin"].includes(user.role));
        await alert("queue_warning", "Unattended bucket ticket — 80% of review/pickup window elapsed", [...managerEmails, ...members.map((user) => user.email)]);
      }
      if (at >= Date.parse(health.managerDueAt!) && !workflow.managerEscalatedAt) {
        workflow.managerEscalatedAt = stamp;
        await alert("manager_escalation", "Manager action needed — ticket has not been reviewed or accepted", managerEmails);
      }
      if (at >= Date.parse(health.rmDueAt!) && !workflow.rmEscalatedAt) {
        workflow.rmEscalatedAt = stamp;
        await alert("rm_escalation", "Senior RM action needed — bucket ticket remains unattended", rmEmails);
      }
    }
    if (health.level === "accepted" && !ticket.slaPausedAt && ticket.status !== "pending" && ticket.dueResolveAt && at >= Date.parse(ticket.dueResolveAt)) {
      if (!workflow.resolutionEscalatedAt) {
        workflow.resolutionEscalatedAt = stamp;
        const agent = users.find((user) => user.id === ticket.assigneeId);
        await alert("resolution_escalation", "Resolution SLA breached — accepted ticket still unresolved", [...managerEmails, ...(agent ? [agent.email] : [])]);
      }
      const extra = settings.stages[ticket.priority].managerMins;
      const effectiveCalendar = workflowCalendar(ticket.tenantId, settings, policy, calendar);
      const rmDue = effectiveCalendar ? addCalendarMinutes(new Date(ticket.dueResolveAt), extra, effectiveCalendar).getTime() : Date.parse(ticket.dueResolveAt) + extra * 60_000;
      if (at >= rmDue && !workflow.resolutionRmEscalatedAt) {
        workflow.resolutionRmEscalatedAt = stamp;
        await alert("resolution_rm_escalation", "Senior RM action needed — resolution SLA remains breached", rmEmails);
      }
    }
    let status = ticket.status;
    if (ticket.status === "resolved" && ticket.resolvedAt) {
      const age = at - Date.parse(ticket.resolvedAt);
      if (age >= 7 * 86_400_000) {
        status = "closed"; workflow.phase = "closed"; workflow.closureReason = "no_response"; delete workflow.confirmedAt;
        const event = await tx.events.create({ id: newId("evt"), ticketId, type: "closed", message: "Auto-closed after seven days without requester response; resolution was not confirmed.", createdAt: stamp });
        await queueLifecycle(tx, { ...ticket, status, workflow }, event.id, "closed", undefined, at);
        await appendAudit({ tenantId: ticket.tenantId, ticketId, actor: "workflow-monitor", action: "ticket.closed.no_response" }, tx);
        changed = true;
      } else if (age >= 3 * 86_400_000 && !workflow.reminderAt) {
        workflow.reminderAt = stamp;
        const ack = (await tx.acknowledgements.list({ tenantId: ticket.tenantId, ticketId, resolvedAt: ticket.resolvedAt, usedAt: null }))[0];
        await queueWorkflowNotice(tx, ticket, `reminder:${ticket.id}:${ticket.resolvedAt}`, ticket.requesterEmail,
          `[${ticket.reference}] Please confirm the resolution`, `${ticket.reference}: ${ticket.subject}\nPlease confirm the fix or reopen the ticket. Without a response it will close seven days after resolution, marked as unconfirmed.`, ack?.id ?? null, at);
        changed = true;
      }
    }
    if (!changed) return false;
    const updated = await tx.tickets.updateIf(ticket.id, { workflowVersion: ticket.workflowVersion, tenantId: ticket.tenantId }, {
      workflow, workflowVersion: (ticket.workflowVersion ?? 0) + 1, status, updatedAt: stamp, ...(status === "closed" ? { closedAt: stamp } : {}) });
    if (!updated) throw new WorkflowError("Ticket changed while monitoring; retry next sweep.");
    if (status === "closed") {
      await queueTicketWebhookEvent(updated, "ticket.closed", tx);
      await queueTicketWebhookEvent(updated, "ticket.updated", tx);
    }
    return true;
  });
}

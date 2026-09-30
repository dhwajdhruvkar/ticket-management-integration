import { getStore } from "../data";
import type { AssignmentGroupRow, TicketRow } from "../domain/models";
import { defaultWorkflowSettings, type WorkflowSettings } from "@/shared/workflow";
import { WorkflowError, type WorkflowActor } from "./workflowService";
import { activeWorkload, calculateAvailability, rankExperiencedAgents, type AgentAvailability, type AgentSuggestion } from "./availabilityService";
import { refreshTeamsPresence, teamsPresenceConfigured } from "../integrations/teamsPresence";
import { bucketHealth, type BucketHealth } from "./workflowMonitoring";
import { outboundEmailConfigured, publicAppOrigin } from "../notify/workflowOutbox";

export interface WorkflowAlerts {
  enabled: boolean;
  canRetryEmails: boolean;
  alerts: { ticketId: string; reference: string; subject: string; level: string; dueAt?: string }[];
  health: { monitorFresh: boolean; lastSuccessAt: string | null; lastError: string | null; emailConfigured: boolean; confirmationConfigured: boolean; pendingEmails: number; failedEmails: number };
}

export interface WorkflowBoard {
  settings: WorkflowSettings;
  tickets: TicketRow[];
  groups: AssignmentGroupRow[];
  staff: { id: string; name: string; role: string; availability: AgentAvailability }[];
  suggestions: Record<string, AgentSuggestion[]>;
  teamsConfigured: boolean;
  canDispatch: boolean;
  hasWorkflowTickets: boolean;
  queueHealth: Record<string, BucketHealth>;
  monitoring: WorkflowAlerts;
}
export async function getWorkflowBoard(tenantId: string, actor: WorkflowActor, lightweight = false): Promise<WorkflowBoard> {
  const store = await getStore();
  const user = actor.id ? await store.users.get(actor.id) : null;
  if (!user?.active || user.tenantId !== tenantId || !["agent", "manager", "tenant_admin", "super_admin"].includes(user.role)) throw new WorkflowError("Staff access required.", 403);
  const [tenant, groups, allTickets, users] = await Promise.all([store.tenants.get(tenantId), store.groups.list({ tenantId }), store.tickets.list({ tenantId, deletedAt: null }), store.users.list({ tenantId, active: true })]);
  const canDispatch = user.role !== "agent";
  const settings = tenant?.workflowSettings ?? defaultWorkflowSettings();
  const work = allTickets.filter((ticket) => ticket.workflow && !["closed", "cancelled"].includes(ticket.status));
  const allowed = new Set(groups.filter((group) => canDispatch || group.memberIds.includes(user.id)).map((group) => group.id));
  const staff = users.filter((row) => ["agent", "manager", "tenant_admin", "super_admin"].includes(row.role));
  const presenceUsers = !lightweight && settings.availabilityMode === "automatic" ? await refreshTeamsPresence(store, tenantId, staff) : staff;
  const calendars = await store.calendars.list({ tenantId });
  const availability = Object.fromEntries(presenceUsers.map((row) => [row.id, calculateAvailability(row, activeWorkload(allTickets, row.id), calendars.find((calendar) => calendar.id === row.availabilitySettings?.calendarId), settings.availabilityMode)]));
  const tickets = work.filter((ticket) => canDispatch || (ticket.assignmentGroupId && allowed.has(ticket.assignmentGroupId)) || ticket.assigneeId === user.id);
  // ponytail: local matching against the 500 most recent resolutions; add a tenant-scoped index when volumes warrant it.
  const history = allTickets.filter((row) => row.resolvedAt).sort((a, b) => b.resolvedAt!.localeCompare(a.resolvedAt!)).slice(0, 500);
  const suggestions = Object.fromEntries((lightweight ? [] : tickets).filter((ticket) => ["department", "awaiting_acceptance"].includes(ticket.workflow!.phase)).map((ticket) => {
    const group = groups.find((row) => row.id === ticket.assignmentGroupId);
    return [ticket.id, rankExperiencedAgents(ticket, presenceUsers.filter((row) => group?.memberIds.includes(row.id)), history, availability)];
  }));
  const policies = await store.slaPolicies.list({ tenantId });
  const queueHealth = Object.fromEntries(tickets.map((ticket) => {
    const policy = policies.find((row) => row.priority === ticket.priority) ?? null;
    return [ticket.id, bucketHealth(ticket, settings, policy, calendars.find((row) => row.id === policy?.calendarId) ?? null)];
  }));
  const monitor = await store.jobLeases.get("workflow-monitor");
  const monitoring: WorkflowAlerts = { enabled: settings.enabled || work.length > 0, canRetryEmails: ["tenant_admin", "super_admin"].includes(user.role),
    alerts: tickets.flatMap((ticket): WorkflowAlerts["alerts"] => {
      const health = queueHealth[ticket.id];
      if (["warning", "manager", "senior_rm"].includes(health.level)) return [{ ticketId: ticket.id, reference: ticket.reference, subject: ticket.subject, level: health.level, dueAt: health.managerDueAt }];
      if (health.level === "accepted" && !ticket.slaPausedAt && ticket.dueResolveAt && Date.parse(ticket.dueResolveAt) <= Date.now()) return [{ ticketId: ticket.id, reference: ticket.reference, subject: ticket.subject, level: "resolution_breach", dueAt: ticket.dueResolveAt }];
      return [];
    }),
    health: { monitorFresh: !!monitor?.lastSuccessAt && Date.now() - Date.parse(monitor.lastSuccessAt) < 3 * 60_000 && !monitor.lastError,
      lastSuccessAt: monitor?.lastSuccessAt ?? null, lastError: monitor?.lastError ?? null, emailConfigured: outboundEmailConfigured() && !!publicAppOrigin(),
      confirmationConfigured: (process.env.AUTH_SECRET?.length ?? 0) >= 32 && !!publicAppOrigin(),
      pendingEmails: await store.notificationDeliveries.count({ tenantId, status: "pending" }), failedEmails: await store.notificationDeliveries.count({ tenantId, status: "failed" }) } };
  return { settings, groups, canDispatch, hasWorkflowTickets: work.length > 0, tickets, suggestions, queueHealth, monitoring, teamsConfigured: teamsPresenceConfigured(tenantId),
    staff: presenceUsers.map(({ id, name, role }) => ({ id, name, role, availability: availability[id] })),
  };
}

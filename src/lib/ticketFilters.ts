// Client-safe ticket filtering shared by the explorer, bucket board and tests.
// Imports only types from the server models; no server modules at runtime.
import type { TicketRow } from "@/server/domain/models";
import { PRIORITY_ORDER } from "@/shared/priority";
import { WORKFLOW_LABELS } from "@/shared/workflow";

export type SlaState = "on_track" | "at_risk" | "breached" | "paused" | "met";
export interface TicketFilters {
  priority?: string; groupId?: string; assigneeId?: string; category?: string; slaState?: SlaState;
  phase?: string; overdue?: boolean; escalated?: boolean; assigned?: boolean;
}

export const SLA_STATE_LABELS: Record<SlaState, string> = {
  on_track: "On track", at_risk: "At risk", breached: "Breached", paused: "Paused", met: "Met",
};
export const TICKET_CATEGORIES = ["IT", "HR", "Access", "Software", "Hardware", "Network", "Billing", "Other"] as const;

const SOLVED = ["auto_resolved", "resolved", "closed"];
const SLA_STATES = Object.keys(SLA_STATE_LABELS) as SlaState[];

function isResolved(t: TicketRow): boolean {
  return SOLVED.includes(t.status) || !!t.resolvedAt;
}

function isEscalated(t: TicketRow): boolean {
  return t.status === "escalated" || !!(t.workflow?.managerEscalatedAt || t.workflow?.rmEscalatedAt || t.workflow?.resolutionEscalatedAt);
}

/** Mirrors the SlaLevelCell rules in TicketsExplorer; paused wins for unresolved tickets. */
export function slaStateOf(t: TicketRow, nowMs = Date.now()): SlaState {
  if (isResolved(t)) {
    const over = t.dueResolveAt && t.resolvedAt ? Date.parse(t.resolvedAt) > Date.parse(t.dueResolveAt) : false;
    return over ? "breached" : "met";
  }
  if (t.slaPausedAt) return "paused";
  const nextDue = t.firstRespondedAt ? t.dueResolveAt : t.dueResponseAt;
  if (!nextDue) return "on_track";
  const due = Date.parse(nextDue);
  const created = Date.parse(t.createdAt);
  if (nowMs > due) return "breached";
  if (due - created > 0 && (nowMs - created) / (due - created) >= 0.8) return "at_risk";
  return "on_track";
}

export function applyTicketFilters(tickets: TicketRow[], f: TicketFilters, nowMs = Date.now()): TicketRow[] {
  return tickets.filter((t) => {
    if (f.priority && t.priority !== f.priority) return false;
    if (f.groupId && t.assignmentGroupId !== f.groupId) return false;
    if (f.assigneeId === "unassigned") { if (t.assigneeId) return false; }
    else if (f.assigneeId && t.assigneeId !== f.assigneeId) return false;
    if (f.category && t.category !== f.category) return false;
    if (f.slaState && slaStateOf(t, nowMs) !== f.slaState) return false;
    if (f.phase && t.workflow?.phase !== f.phase) return false;
    if (f.assigned && !t.assigneeId) return false;
    if (f.overdue && (isResolved(t) || slaStateOf(t, nowMs) !== "breached")) return false;
    if (f.escalated && !isEscalated(t)) return false;
    return true;
  });
}

/** Reads shareable URL filters. Unknown or invalid values are ignored. */
export function filtersFromParams(p: URLSearchParams): TicketFilters {
  const f: TicketFilters = {};
  const priority = p.get("priority");
  if (priority && (PRIORITY_ORDER as readonly string[]).includes(priority)) f.priority = priority;
  const group = p.get("group");
  if (group) f.groupId = group;
  const assignee = p.get("assignee");
  if (assignee) f.assigneeId = assignee;
  const category = p.get("category");
  if (category && (TICKET_CATEGORIES as readonly string[]).includes(category)) f.category = category;
  const sla = p.get("sla");
  if (sla && (SLA_STATES as string[]).includes(sla)) f.slaState = sla as SlaState;
  const phase = p.get("phase");
  if (phase && Object.keys(WORKFLOW_LABELS).includes(phase)) f.phase = phase;
  if (p.get("overdue") === "1") f.overdue = true;
  if (p.get("escalated") === "1") f.escalated = true;
  if (p.get("assigned") === "1") f.assigned = true;
  return f;
}

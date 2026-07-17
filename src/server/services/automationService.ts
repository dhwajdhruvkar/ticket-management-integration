// =============================================================================
// Automation / rules engine.
//
// Rules are stored as JSON: a trigger ("ticket.created", "ticket.updated"), a
// set of AND conditions, and a list of actions. runAutomations evaluates every
// enabled rule for a trigger and applies matching actions; dryRun reports what
// WOULD happen without mutating anything.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { newId, now } from "../domain/ids";
import { getTicket, mutateTicket, recordEvent } from "./ticketService";
import { notify } from "../notify/notifier";
import type { AutomationRow, TicketRow } from "../domain/models";

export interface Condition {
  field: string;
  op: "eq" | "neq" | "contains" | "in";
  value: unknown;
}

/**
 * Rule conditions: either a flat AND list (legacy shape) or explicit groups —
 * ALL of `all` must match and, when `any` is non-empty, at least one of it.
 */
export interface ConditionGroups {
  all?: Condition[];
  any?: Condition[];
}
export type RuleConditions = Condition[] | ConditionGroups;

export interface Action {
  type: "assign" | "set_priority" | "set_status" | "set_category" | "add_tag" | "notify" | "run_ai";
  assigneeId?: string;
  priority?: TicketRow["priority"];
  status?: TicketRow["status"];
  category?: TicketRow["category"];
  tag?: string;
  target?: "manager" | "assignee" | "requester";
  message?: string;
}

export async function listAutomations(tenantId: string): Promise<AutomationRow[]> {
  const store = await getStore();
  return (await store.automations.list({ tenantId })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createAutomation(
  tenantId: string,
  input: { name: string; trigger: string; conditions: RuleConditions; actions: Action[]; enabled?: boolean }
): Promise<AutomationRow> {
  const store = await getStore();
  const rule: AutomationRow = {
    id: newId("auto"),
    tenantId,
    name: input.name.trim(),
    enabled: input.enabled ?? true,
    trigger: input.trigger,
    conditions: input.conditions,
    actions: input.actions,
    runCount: 0,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.automations.create(rule);
  await appendAudit({ tenantId, actor: "system", action: "automation.created", payload: { name: rule.name } });
  return rule;
}

export async function toggleAutomation(id: string, enabled: boolean): Promise<AutomationRow | null> {
  const store = await getStore();
  return store.automations.update(id, { enabled, updatedAt: now() });
}

function matchOne(ticket: TicketRow, c: Condition): boolean {
  const actual = (ticket as unknown as Record<string, unknown>)[c.field];
  switch (c.op) {
    case "eq":
      return actual === c.value;
    case "neq":
      return actual !== c.value;
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(c.value).toLowerCase());
    case "in":
      return Array.isArray(c.value) && (c.value as unknown[]).includes(actual);
    default:
      return false;
  }
}

/** Evaluate legacy AND-lists or {all, any} groups. Exported for tests. */
export function evaluate(ticket: TicketRow, conditions: RuleConditions | null | undefined): boolean {
  if (!conditions) return true;
  if (Array.isArray(conditions)) return conditions.every((c) => matchOne(ticket, c));
  const allOk = (conditions.all ?? []).every((c) => matchOne(ticket, c));
  const anyList = conditions.any ?? [];
  const anyOk = anyList.length === 0 || anyList.some((c) => matchOne(ticket, c));
  return allOk && anyOk;
}

/** Run all enabled rules for a trigger against a ticket. */
export async function runAutomations(
  tenantId: string,
  trigger: string,
  ticketId: string
): Promise<{ applied: string[] }> {
  const store = await getStore();
  const ticket = await getTicket(ticketId);
  if (!ticket) return { applied: [] };

  const rules = (await store.automations.list({ tenantId, enabled: true })).filter(
    (r) => r.trigger === trigger
  );

  const applied: string[] = [];
  for (const rule of rules) {
    if (!evaluate(ticket, rule.conditions as RuleConditions)) continue;

    const actions = (rule.actions as Action[]) ?? [];
    for (const action of actions) {
      await applyAction(tenantId, ticketId, action);
    }
    await store.automations.update(rule.id, { runCount: rule.runCount + 1, updatedAt: now() });
    await recordEvent(ticketId, "agent_action", `Automation "${rule.name}" ran.`);
    await appendAudit({
      tenantId,
      actor: "automation",
      action: "automation.executed",
      ticketId,
      payload: { rule: rule.name, trigger, actions: actions.map((a) => a.type) },
    });
    applied.push(rule.name);
  }
  return { applied };
}

// Tickets currently inside an automation run: actions that mutate the ticket
// (set_status etc.) re-enter mutateTicket, which fires ticket.updated — the
// guard stops that from cascading into infinite rule loops.
const inFlight = new Set<string>();

/** Reentrancy-safe wrapper used by event-driven triggers (ticket.updated, sla.*). */
export async function runAutomationsSafe(
  tenantId: string,
  trigger: string,
  ticketId: string
): Promise<{ applied: string[] }> {
  if (inFlight.has(ticketId)) return { applied: [] };
  inFlight.add(ticketId);
  try {
    return await runAutomations(tenantId, trigger, ticketId);
  } catch (err) {
    console.error(`[automation] ${trigger} failed:`, err);
    return { applied: [] };
  } finally {
    inFlight.delete(ticketId);
  }
}

/** Evaluate rules without applying — returns which rules would run. */
export async function dryRun(tenantId: string, ticketId: string, trigger: string): Promise<string[]> {
  const store = await getStore();
  const ticket = await getTicket(ticketId);
  if (!ticket) return [];
  const rules = (await store.automations.list({ tenantId, enabled: true })).filter(
    (r) => r.trigger === trigger
  );
  return rules.filter((r) => evaluate(ticket, r.conditions as RuleConditions)).map((r) => r.name);
}

async function applyAction(tenantId: string, ticketId: string, action: Action): Promise<void> {
  const ticket = await getTicket(ticketId);
  if (!ticket) return;

  switch (action.type) {
    case "assign":
      if (action.assigneeId) await mutateTicket(ticketId, { assigneeId: action.assigneeId });
      break;
    case "set_priority":
      if (action.priority) await mutateTicket(ticketId, { priority: action.priority });
      break;
    case "set_status":
      if (action.status) await mutateTicket(ticketId, { status: action.status });
      break;
    case "set_category":
      if (action.category) await mutateTicket(ticketId, { category: action.category });
      break;
    case "add_tag":
      if (action.tag) await mutateTicket(ticketId, { tags: [...new Set([...ticket.tags, action.tag])] });
      break;
    case "notify": {
      const to = await resolveTarget(tenantId, ticket, action.target);
      if (to) {
        await notify({
          tenantId,
          channel: "in_app",
          to,
          subject: `Ticket ${ticket.reference}: ${ticket.subject}`,
          body: action.message ?? `Automation notification for ticket ${ticket.reference}.`,
          link: `/tickets/${ticket.id}`,
        });
      }
      break;
    }
    case "run_ai": {
      const { resolveTicket } = await import("../ai/resolver");
      await resolveTicket(ticketId);
      break;
    }
  }
}

async function resolveTarget(
  tenantId: string,
  ticket: TicketRow,
  target?: Action["target"]
): Promise<string | null> {
  if (target === "requester") return ticket.requesterEmail;
  const store = await getStore();
  if (target === "assignee" && ticket.assigneeId) {
    const u = await store.users.get(ticket.assigneeId);
    return u?.email ?? null;
  }
  if (target === "manager") {
    const manager = (await store.users.list({ tenantId })).find((u) => u.role === "manager");
    return manager?.email ?? null;
  }
  return null;
}

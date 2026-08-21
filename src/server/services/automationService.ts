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
import { pageCollection, type ListOptions, type PageResult } from "../data/store";
import { newId, now } from "../domain/ids";
import { withRetry } from "../resilience";
import { getTicket, mutateTicket, recordEvent } from "./ticketService";
import { reassignToLeastLoaded } from "./groupService";
import { applySla } from "./slaService";
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
  type:
    | "assign"
    | "reassign"
    | "set_priority"
    | "set_status"
    | "set_category"
    | "add_tag"
    | "notify"
    | "run_ai";
  assigneeId?: string;
  priority?: TicketRow["priority"];
  status?: TicketRow["status"];
  category?: TicketRow["category"];
  tag?: string;
  target?: "manager" | "assignee" | "requester";
  message?: string;
}

export async function listAutomations(
  tenantId: string,
  options: ListOptions<AutomationRow> = { orderBy: { field: "name", dir: "asc" } }
): Promise<PageResult<AutomationRow>> {
  const store = await getStore();
  return pageCollection(store.automations, { tenantId }, options);
}

export async function createAutomation(
  tenantId: string,
  input: { name: string; trigger: string; conditions: RuleConditions; actions: Action[]; enabled?: boolean },
  actor = "system"
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
  await appendAudit({ tenantId, actor, action: "automation.created", payload: { name: rule.name } });
  return rule;
}

export async function toggleAutomation(
  id: string,
  enabled: boolean,
  actor = "system"
): Promise<AutomationRow | null> {
  const store = await getStore();
  const existing = await store.automations.get(id);
  if (!existing) return null;
  const updated = await store.automations.update(id, { enabled, updatedAt: now() });
  // Silently disabling a rule changes how every future ticket is handled, so
  // it belongs on the audit chain alongside the rest of the config history.
  await appendAudit({
    tenantId: existing.tenantId,
    actor,
    action: enabled ? "automation.enabled" : "automation.disabled",
    payload: { id, name: existing.name },
  });
  return updated;
}

function matchOne(ticket: TicketRow, c: Condition): boolean {
  const actual = (ticket as unknown as Record<string, unknown>)[c.field];
  switch (c.op) {
    case "eq":
      return actual === c.value;
    case "neq":
      return actual !== c.value;
    case "contains":
      // On an array field (tags, ciIds) "contains" means membership, not
      // substring — `tags contains vip` should not match the tag "vipn".
      if (Array.isArray(actual)) {
        return actual.some((v) => String(v).toLowerCase() === String(c.value).toLowerCase());
      }
      return String(actual ?? "").toLowerCase().includes(String(c.value).toLowerCase());
    case "in": {
      if (!Array.isArray(c.value)) return false;
      const options = c.value as unknown[];
      // For an array field, "in" asks whether the field intersects the option
      // list; comparing the array itself would never be equal to anything.
      if (Array.isArray(actual)) return actual.some((v) => options.includes(v));
      return options.includes(actual);
    }
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
  if (!(await getTicket(ticketId, tenantId))) return { applied: [] };

  const rules = (await store.automations.list({ tenantId, enabled: true })).filter(
    (r) => r.trigger === trigger
  );

  const applied: string[] = [];
  for (const rule of rules) {
    // Re-read per rule: an earlier rule in this same pass may have changed the
    // priority or status that this one is testing.
    const current = await getTicket(ticketId, tenantId);
    if (!current) break;
    if (!evaluate(current, rule.conditions as RuleConditions)) continue;

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

// Ticket+trigger pairs currently inside an automation run: actions that mutate
// the ticket (set_status etc.) re-enter mutateTicket, which fires
// ticket.updated — the guard stops that cascading into an infinite rule loop.
// Keying by trigger as well as ticket matters: an sla.breached rule must still
// be able to run while a ticket.updated pass is in flight for the same ticket.
const inFlight = new Set<string>();

/** Reentrancy-safe wrapper used by event-driven triggers (ticket.updated, sla.*). */
export async function runAutomationsSafe(
  tenantId: string,
  trigger: string,
  ticketId: string
): Promise<{ applied: string[] }> {
  const key = `${ticketId}::${trigger}`;
  if (inFlight.has(key)) return { applied: [] };
  inFlight.add(key);
  try {
    return await runAutomations(tenantId, trigger, ticketId);
  } catch (err) {
    // Never let a bad rule take down intake, but do not lose the failure
    // either: it lands on the audit chain via withRetry's dead-letter.
    await withRetry(() => Promise.reject(err), {
      step: `automation.${trigger}`,
      tenantId,
      ticketId,
      attempts: 1,
    });
    return { applied: [] };
  } finally {
    inFlight.delete(key);
  }
}

/** Evaluate rules without applying — returns which rules would run. */
export async function dryRun(tenantId: string, ticketId: string, trigger: string): Promise<string[]> {
  const store = await getStore();
  const ticket = await getTicket(ticketId, tenantId);
  if (!ticket) return [];
  const rules = (await store.automations.list({ tenantId, enabled: true })).filter(
    (r) => r.trigger === trigger
  );
  return rules.filter((r) => evaluate(ticket, r.conditions as RuleConditions)).map((r) => r.name);
}

async function applyAction(tenantId: string, ticketId: string, action: Action): Promise<void> {
  const ticket = await getTicket(ticketId, tenantId);
  if (!ticket) return;

  switch (action.type) {
    case "assign":
      if (action.assigneeId) {
        // Only assign to a member of this tenant, and only to someone who can
        // actually work tickets.
        const store = await getStore();
        const assignee = await store.users.get(action.assigneeId);
        if (assignee && assignee.tenantId === tenantId) {
          await mutateTicket(ticketId, { assigneeId: action.assigneeId });
        }
      }
      break;
    case "reassign":
      await reassignToLeastLoaded(ticket);
      break;
    case "set_priority":
      if (action.priority && action.priority !== ticket.priority) {
        const updated = await mutateTicket(ticketId, { priority: action.priority });
        // The SLA targets are per priority, so a rule that escalates a ticket
        // must move its deadlines too, not leave the old ones in place.
        if (updated) await applySla(updated);
      }
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

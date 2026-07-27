// =============================================================================
// Unified ticket intake pipeline.
//
// Single entry point for every channel (portal, email, Teams, webhook, alert):
//   AI classification (category + impact x urgency -> priority)
//   -> create -> SLA due dates -> acknowledgement notification
//   -> approval hold (catalog items that require it)
//   -> group routing -> automation rules -> AI triage (if still open).
// Used by the REST API and the omnichannel adapters so every source behaves
// identically.
// =============================================================================

import { classifyTicket, suggestTags } from "../ai/aiService";
import { resolveTicket } from "../ai/resolver";
import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { notifyTemplate } from "../notify/templates";
import { withRetry } from "../resilience";
import { applySla } from "./slaService";
import { requestTicketApproval } from "./approvalService";
import { routeTicketToGroup } from "./groupService";
import { runAutomationsSafe } from "./automationService";
import { createTicket, getTicket, type NewTicketInput } from "./ticketService";
import { derivePriority, priorityCode } from "../domain/priority";
import type { TicketRow } from "../domain/models";

export async function intakeTicket(
  tenantId: string,
  input: NewTicketInput & { autoResolve?: boolean }
): Promise<TicketRow> {
  if (!input.category || !(input.priority || (input.impact && input.urgency))) {
    const cls = await classifyTicket(input.subject, input.body);
    input.category = input.category ?? cls.category;
    input.impact = input.impact ?? cls.impact;
    input.urgency = input.urgency ?? cls.urgency;
    input.priority = input.priority ?? cls.priority;
  }

  // VIP requesters get an urgency floor (=> priority bump via the ITIL matrix)
  // and a "vip" tag so queues and automations can single them out.
  const store0 = await getStore();
  const requesterUser = (await store0.users.list({ tenantId })).find(
    (u) => u.email.toLowerCase() === input.requesterEmail.toLowerCase()
  );
  if (requesterUser?.vip) {
    input.urgency = "high";
    input.priority = derivePriority(input.impact ?? "medium", "high");
    input.tags = [...new Set([...(input.tags ?? []), "vip"])];
  }

  // AI auto-tagging: merge suggested topical tags (kept alongside vip/monitoring
  // and any inbound webhook tags via the same dedupe idiom).
  const suggested = await suggestTags(input.subject, input.body);
  if (suggested.length) {
    input.tags = [...new Set([...(input.tags ?? []), ...suggested])];
  }

  const created = await createTicket(tenantId, input, input.source ?? "system");
  if (requesterUser?.vip) {
    await appendAudit({
      tenantId,
      actor: "router",
      action: "ticket.vip_prioritized",
      ticketId: created.id,
      payload: { requester: created.requesterEmail, priority: created.priority },
    });
  }
  await applySla(created);

  await notifyTemplate({
    tenantId,
    to: created.requesterEmail,
    key: "ticket_created",
    link: `/tickets/${created.id}`,
    vars: {
      reference: created.reference,
      subject: created.subject,
      requester_name: created.requesterEmail,
      priority: priorityCode(created.priority),
    },
  });

  // Catalog items flagged requiresApproval hold the ticket before fulfilment.
  if (created.catalogItemId) {
    const store = await getStore();
    const item = await store.catalogItems.get(created.catalogItemId);
    // A catalog id from another tenant must not drive this tenant's workflow.
    if (item && item.tenantId === tenantId && item.requiresApproval) {
      await requestTicketApproval(created, item);
      return (await getTicket(created.id)) ?? created;
    }
  }

  await processTicketPipeline(created.id, { autoResolve: input.autoResolve });
  return (await getTicket(created.id)) ?? created;
}

/**
 * Post-create pipeline: group routing -> automation rules -> AI triage. Also
 * invoked when an approval is granted and a held request resumes.
 */
export async function processTicketPipeline(
  ticketId: string,
  opts: { autoResolve?: boolean } = {}
): Promise<void> {
  const ticket = await getTicket(ticketId);
  if (!ticket) return;

  await withRetry(() => routeTicketToGroup(ticket), {
    step: "routing",
    tenantId: ticket.tenantId,
    ticketId,
  });
  await runAutomationsSafe(ticket.tenantId, "ticket.created", ticketId);

  const afterRules = await getTicket(ticketId);
  if (
    afterRules &&
    afterRules.status === "open" &&
    (afterRules.type === "incident" || afterRules.type === "service_request") &&
    opts.autoResolve !== false
  ) {
    await withRetry(() => resolveTicket(ticketId), {
      step: "ai_triage",
      tenantId: ticket.tenantId,
      ticketId,
    });
  }
}

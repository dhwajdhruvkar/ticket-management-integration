// =============================================================================
// Notification templates.
//
// Typed registry of lifecycle notifications with {{placeholder}} substitution,
// so every channel (Graph email, Teams, in-app feed) sends consistent copy.
// notifyTemplate() renders and dispatches through the notifier in one call.
// =============================================================================

import { notify } from "./notifier";
import type { NotificationChannel, NotificationRow } from "../domain/models";

export type TemplateKey =
  | "ticket_created"
  | "ticket_assigned"
  | "ticket_pending"
  | "ticket_resolved"
  | "ticket_closed"
  | "ticket_reopened"
  | "approval_requested"
  | "approval_approved"
  | "approval_rejected"
  | "sla_warning"
  | "sla_breached";

interface TemplateDef {
  subject: string;
  body: string;
}

const TEMPLATES: Record<TemplateKey, TemplateDef> = {
  ticket_created: {
    subject: "[{{reference}}] We received your request: {{subject}}",
    body:
      "Hello {{requester_name}},\n\n" +
      "Your request \"{{subject}}\" has been logged as {{reference}} (priority {{priority}}).\n" +
      "We will keep you updated here and by email as it progresses.\n\n" +
      "— {{brand}}",
  },
  ticket_assigned: {
    subject: "[{{reference}}] Assigned to you: {{subject}}",
    body:
      "Hello {{assignee_name}},\n\n" +
      "Ticket {{reference}} \"{{subject}}\" (priority {{priority}}) has been assigned to you" +
      "{{group_clause}}.\n\n— {{brand}}",
  },
  ticket_pending: {
    subject: "[{{reference}}] We need more information: {{subject}}",
    body:
      "Hello {{requester_name}},\n\n" +
      "Ticket {{reference}} is on hold waiting for your input. Please reply so we can continue" +
      " — the SLA clock is paused until we hear back.\n\n— {{brand}}",
  },
  ticket_resolved: {
    subject: "[{{reference}}] Resolved: {{subject}}",
    body:
      "Hello {{requester_name}},\n\n" +
      "Ticket {{reference}} \"{{subject}}\" has been resolved.\n{{resolution_clause}}\n" +
      "If this did not fix your issue, just reply and the ticket will reopen automatically.\n\n— {{brand}}",
  },
  ticket_closed: {
    subject: "[{{reference}}] Closed: {{subject}}",
    body:
      "Hello {{requester_name}},\n\n" +
      "Ticket {{reference}} \"{{subject}}\" is now closed. Thanks for confirming the fix.\n" +
      "You can raise a new request any time from the portal.\n\n— {{brand}}",
  },
  ticket_reopened: {
    subject: "[{{reference}}] Reopened: {{subject}}",
    body:
      "Ticket {{reference}} \"{{subject}}\" was reopened by {{actor_name}} and needs attention.\n\n— {{brand}}",
  },
  approval_requested: {
    subject: "[{{reference}}] Approval required: {{subject}}",
    body:
      "Hello {{approver_name}},\n\n" +
      "{{requester_name}} requested \"{{subject}}\" ({{reference}}), which requires your approval" +
      " before fulfilment starts.\nPlease approve or reject it from the tickets queue.\n\n— {{brand}}",
  },
  approval_approved: {
    subject: "[{{reference}}] Approved: {{subject}}",
    body:
      "Hello {{requester_name}},\n\n" +
      "Your request {{reference}} \"{{subject}}\" was approved by {{approver_name}}" +
      "{{comment_clause}}. Fulfilment is now underway.\n\n— {{brand}}",
  },
  approval_rejected: {
    subject: "[{{reference}}] Not approved: {{subject}}",
    body:
      "Hello {{requester_name}},\n\n" +
      "Your request {{reference}} \"{{subject}}\" was rejected by {{approver_name}}" +
      "{{comment_clause}}. The ticket has been cancelled — please contact your manager for details.\n\n— {{brand}}",
  },
  sla_warning: {
    subject: "[{{reference}}] SLA at risk ({{elapsed_pct}}% elapsed): {{subject}}",
    body:
      "Ticket {{reference}} \"{{subject}}\" (priority {{priority}}) has used {{elapsed_pct}}% of its" +
      " SLA window and is due {{due_at}}. Please action it before it breaches.\n\n— {{brand}}",
  },
  sla_breached: {
    subject: "[{{reference}}] SLA breached: {{subject}}",
    body:
      "Ticket {{reference}} \"{{subject}}\" (priority {{priority}}) has breached its SLA and was" +
      " escalated automatically. Immediate attention required.\n\n— {{brand}}",
  },
};

export const DEFAULT_BRAND = "Netlink Support";

/** Render a template with {{placeholder}} substitution (missing vars -> ""). */
export function renderTemplate(
  key: TemplateKey,
  vars: Record<string, string | number | null | undefined>
): { subject: string; body: string } {
  const all = { brand: DEFAULT_BRAND, ...vars };
  const sub = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
      const v = all[name as keyof typeof all];
      return v === null || v === undefined ? "" : String(v);
    });
  const def = TEMPLATES[key];
  return { subject: sub(def.subject), body: sub(def.body) };
}

/** Render + dispatch in one call. Never throws — notifications must not break the pipeline. */
export async function notifyTemplate(input: {
  tenantId: string;
  to: string;
  key: TemplateKey;
  vars: Record<string, string | number | null | undefined>;
  channel?: NotificationChannel;
  /** App-relative destination for the in-app feed (e.g. "/tickets/tkt_1"). */
  link?: string;
}): Promise<NotificationRow | null> {
  try {
    const { subject, body } = renderTemplate(input.key, input.vars);
    return await notify({
      tenantId: input.tenantId,
      to: input.to,
      subject,
      body,
      channel: input.channel ?? "email",
      link: input.link,
    });
  } catch (err) {
    console.error(`[notify] template ${input.key} failed:`, err);
    return null;
  }
}

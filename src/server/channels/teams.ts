// =============================================================================
// Microsoft Teams channel.
//
// Inbound: a Teams bot/outgoing-webhook posts activities here; a "create
// ticket" intent opens a ticket via the unified intake. Outbound notifications
// are handled by the notifier (Teams webhook). Returns a plain text reply the
// bot can echo back to the user.
// =============================================================================

import { defaultTenantId } from "../data";
import { intakeTicket } from "../services/intake";

export interface TeamsActivity {
  text?: string;
  from?: { name?: string; aadObjectId?: string; email?: string };
}

export async function handleTeamsActivity(activity: TeamsActivity): Promise<string> {
  const text = (activity.text ?? "").trim();
  if (!text) return "Tell me the issue and I'll open a ticket.";

  const tenantId = await defaultTenantId();
  const requester = activity.from?.email ?? `${activity.from?.name ?? "teams-user"}@netlink.com`;
  const subject = text.length > 80 ? `${text.slice(0, 77)}...` : text;

  const ticket = await intakeTicket(tenantId, {
    subject,
    body: text,
    requesterEmail: requester,
    channel: "teams",
    source: "teams-bot",
  });

  const statusLine =
    ticket.status === "auto_resolved"
      ? "I found an answer and resolved it — check the ticket for steps."
      : "An agent will follow up shortly.";
  return `Created ticket ${ticket.reference}. ${statusLine}`;
}

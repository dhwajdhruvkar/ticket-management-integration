// =============================================================================
// Background job scheduler.
//
// Runs recurring maintenance: SLA breach sweep (+escalation/notify/automation
// triggers), auto-close of stale resolved tickets, inbound email polling, and
// the weekly digest. Each tick runs under withJobLock (in-process mutex +
// Postgres advisory lock on the prisma driver, so replicas never double-run)
// with bounded retries; exhausted failures are dead-lettered to the audit
// chain as job.failed. Started once from src/instrumentation.ts on boot.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { config } from "../config";
import { getStore } from "../data";
import { pollMailbox } from "../channels/graphEmail";
import { notify } from "../notify/notifier";
import { notifyTemplate } from "../notify/templates";
import { priorityCode } from "../domain/priority";
import { runAutomationsSafe } from "../services/automationService";
import { listTickets, mutateTicket } from "../services/ticketService";
import { slaStatus } from "../services/slaService";
import { buildReportPdf } from "../services/reportPdfService";
import { runWithRetry, withJobLock } from "./lock";
import { logger } from "../observability/logger";
import type { Role, TicketRow, UserRow } from "../domain/models";

const OPEN = ["new", "open", "in_progress", "pending", "pending_agent", "escalated", "reopened"];
const RESOLVED = ["auto_resolved", "resolved"];
const AUTO_CLOSE_DAYS = 7;

const AT_RISK_TAG = "sla_at_risk";
const BREACHED_TAG = "sla_breached";

async function escalationTargets(tenantId: string, ticket: TicketRow): Promise<UserRow[]> {
  const store = await getStore();
  const users = await store.users.list({ tenantId });
  const targets = new Map<string, UserRow>();
  const manager = users.find((u) => u.role === "manager");
  if (manager) targets.set(manager.id, manager);
  if (ticket.assigneeId) {
    const assignee = users.find((u) => u.id === ticket.assigneeId);
    if (assignee) targets.set(assignee.id, assignee);
  }
  return [...targets.values()];
}

/**
 * Staged SLA escalation:
 *   stage 1 (>= 80% of the window elapsed): tag sla_at_risk + warn assignee/manager
 *   stage 2 (breached): escalate the ticket + alert the manager
 */
export async function slaSweep(): Promise<void> {
  const store = await getStore();
  for (const tenant of await store.tenants.list()) {
    const { data: tickets } = await listTickets(tenant.id);
    for (const ticket of tickets) {
      if (!OPEN.includes(ticket.status)) continue;
      const status = slaStatus(ticket);
      if (status.paused) continue; // clock stopped while pending

      const breached = status.responseBreached || status.resolveBreached;
      if (breached && !ticket.tags.includes(BREACHED_TAG)) {
        await mutateTicket(
          ticket.id,
          { status: "escalated", tags: [...ticket.tags, BREACHED_TAG] },
          { type: "escalated", message: "SLA breached — auto-escalated by the scheduler." }
        );
        await appendAudit({
          tenantId: tenant.id,
          actor: "scheduler",
          action: "sla.breached",
          ticketId: ticket.id,
          payload: { level: status.level },
        });
        for (const user of await escalationTargets(tenant.id, ticket)) {
          await notifyTemplate({
            tenantId: tenant.id,
            to: user.email,
            key: "sla_breached",
            link: `/tickets/${ticket.id}`,
            vars: {
              reference: ticket.reference,
              subject: ticket.subject,
              priority: priorityCode(ticket.priority),
            },
          });
        }
        await runAutomationsSafe(tenant.id, "sla.breached", ticket.id);
        continue;
      }

      if (status.level === "at_risk" && !ticket.tags.includes(AT_RISK_TAG) && !breached) {
        const elapsedPct = Math.round((status.elapsedFraction ?? 0) * 100);
        const due = !ticket.firstRespondedAt ? status.responseDue : status.resolveDue;
        await mutateTicket(
          ticket.id,
          { tags: [...ticket.tags, AT_RISK_TAG] },
          { type: "sla_warning", message: `SLA warning — ${elapsedPct}% of the window has elapsed.` }
        );
        await appendAudit({
          tenantId: tenant.id,
          actor: "scheduler",
          action: "sla.at_risk",
          ticketId: ticket.id,
          payload: { elapsedPct },
        });
        for (const user of await escalationTargets(tenant.id, ticket)) {
          await notifyTemplate({
            tenantId: tenant.id,
            to: user.email,
            key: "sla_warning",
            link: `/tickets/${ticket.id}`,
            vars: {
              reference: ticket.reference,
              subject: ticket.subject,
              priority: priorityCode(ticket.priority),
              elapsed_pct: elapsedPct,
              due_at: due ? new Date(due).toLocaleString() : "soon",
            },
          });
        }
        await runAutomationsSafe(tenant.id, "sla.at_risk", ticket.id);
      }
    }
  }
}

export async function autoCloseStale(): Promise<void> {
  const store = await getStore();
  const cutoff = Date.now() - AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000;
  for (const tenant of await store.tenants.list()) {
    const { data: tickets } = await listTickets(tenant.id);
    for (const ticket of tickets) {
      if (!RESOLVED.includes(ticket.status)) continue;
      const resolvedMs = ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : null;
      if (resolvedMs && resolvedMs < cutoff) {
        await mutateTicket(
          ticket.id,
          { status: "closed" },
          { type: "closed", message: `Auto-closed after ${AUTO_CLOSE_DAYS} days without a reply.` }
        );
      }
    }
  }
}

/**
 * Weekly digest (Monday >= 08:00 server time, once per day guard): a summary
 * of unread notifications + open assigned tickets for users who keep the
 * weeklyDigest preference on.
 */
let lastDigestDate = "";

export async function weeklyDigestSweep(nowDate = new Date()): Promise<number> {
  const isMonday = nowDate.getDay() === 1;
  const today = nowDate.toISOString().slice(0, 10);
  if (!isMonday || nowDate.getHours() < 8 || lastDigestDate === today) return 0;
  lastDigestDate = today;

  const store = await getStore();
  let sent = 0;
  for (const tenant of await store.tenants.list()) {
    const users = await store.users.list({ tenantId: tenant.id });
    const { data: tickets } = await listTickets(tenant.id);
    const notifications = await store.notifications.list({ tenantId: tenant.id });

    for (const user of users) {
      if (user.preferences?.weeklyDigest === false || !user.active) continue;
      const unread = notifications.filter((n) => n.toAddress === user.email && !n.readAt).length;
      const assignedOpen = tickets.filter(
        (t) => t.assigneeId === user.id && OPEN.includes(t.status)
      ).length;
      if (unread === 0 && assignedOpen === 0) continue;

      await notify({
        tenantId: tenant.id,
        channel: "email",
        to: user.email,
        subject: "Your weekly Netlink Support digest",
        link: "/tickets",
        body:
          `Hello ${user.name},\n\n` +
          `Here's your Monday summary:\n` +
          `- ${assignedOpen} open ticket${assignedOpen === 1 ? "" : "s"} assigned to you\n` +
          `- ${unread} unread notification${unread === 1 ? "" : "s"}\n\n` +
          `Open the workspace to catch up.\n\n— Netlink Support`,
      });
      sent++;
    }
  }
  if (sent > 0) logger.info("weekly digest sent", { recipients: sent });
  return sent;
}

/**
 * Monthly report (1st of the month >= 07:00 server time, once per month guard):
 * emails a branded PDF of the service-desk metrics to managers/admins who keep
 * the monthlyReport preference on. Recipients need report.read.
 */
const REPORT_ROLES: Role[] = ["manager", "tenant_admin", "super_admin"];
let lastMonthlyReportMonth = "";

export async function monthlyReportSweep(nowDate = new Date()): Promise<number> {
  const month = nowDate.toISOString().slice(0, 7); // YYYY-MM
  if (nowDate.getDate() !== 1 || nowDate.getHours() < 7 || lastMonthlyReportMonth === month) return 0;
  lastMonthlyReportMonth = month;

  const store = await getStore();
  let sent = 0;
  for (const tenant of await store.tenants.list()) {
    const users = await store.users.list({ tenantId: tenant.id });
    const recipients = users.filter(
      (u) => u.active && REPORT_ROLES.includes(u.role) && u.preferences?.monthlyReport !== false
    );
    if (recipients.length === 0) continue;

    // Render once per tenant, attach to each recipient.
    let pdfBase64: string;
    try {
      pdfBase64 = (await buildReportPdf(tenant.id)).toString("base64");
    } catch (err) {
      logger.error("monthly report render failed", {
        tenant: tenant.id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    for (const user of recipients) {
      await notify({
        tenantId: tenant.id,
        channel: "email",
        to: user.email,
        subject: `Netlink Support — monthly report (${month})`,
        link: "/analytics",
        body:
          `Hello ${user.name},\n\n` +
          `Your monthly Netlink Support report for ${month} is attached (PDF).\n` +
          `You can also explore live metrics in the Analytics workspace.\n\n— Netlink Support`,
        attachments: [
          {
            filename: `netlink-support-report-${month}.pdf`,
            contentBase64: pdfBase64,
            contentType: "application/pdf",
          },
        ],
      });
      sent++;
    }
  }
  if (sent > 0) logger.info("monthly report sent", { recipients: sent, month });
  return sent;
}

async function tick(): Promise<void> {
  await withJobLock("scheduler-tick", async () => {
    await runWithRetry("slaSweep", slaSweep, { attempts: 3 });
    await runWithRetry("autoCloseStale", autoCloseStale, { attempts: 2 });
    await runWithRetry("weeklyDigest", () => weeklyDigestSweep().then(() => undefined), { attempts: 2 });
    await runWithRetry("monthlyReport", () => monthlyReportSweep().then(() => undefined), { attempts: 2 });
    // Graph is pull-based; Brevo is push (its webhook), so only poll for Graph.
    if (config.emailProvider === "graph" && config.features.graph) {
      await runWithRetry("pollMailbox", () => pollMailbox().then(() => undefined), { attempts: 3 });
    }
  });
}

const g = globalThis as unknown as { __netlinkScheduler?: boolean };

export function startScheduler(): void {
  if (g.__netlinkScheduler) return;
  g.__netlinkScheduler = true;
  const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 5 * 60 * 1000);
  // First run shortly after boot, then on the interval.
  setTimeout(() => void tick(), 15_000);
  setInterval(() => void tick(), intervalMs);
  logger.info("scheduler started", {
    intervalMs,
    lock: config.dataDriver === "prisma" ? "pg-advisory" : "in-process",
  });
}

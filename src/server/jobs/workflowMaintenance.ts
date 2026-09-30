import { getStore } from "../data";
import type { DataStore } from "../data/store";
import { acquireLease, finishLease } from "./durableLease";
import { monitorWorkflowTicket } from "../services/workflowMonitoring";
import { drainWorkflowOutbox } from "../notify/workflowOutbox";
import { logger } from "../observability/logger";
import { cleanWorkflowMetadata } from "./workflowRetention";
import { retryPendingWebhookDeliveries } from "../services/integrationWebhookService";

/** Bounded cursor sweep for a serverless minute trigger; no browser activity required. */
export async function runWorkflowMaintenance(entryPoint: "cron" | "local_scheduler", storeOverride?: DataStore) {
  const store = storeOverride ?? await getStore();
  const started = Date.now();
  const lease = await acquireLease(store, "workflow-monitor", started, 120_000);
  if (!lease) return { skipped: true };
  let cursor = lease.cursor;
  let processed = 0, changed = 0, complete = false;
  try {
    // A stable ID cursor prevents old resolved tickets from starving newer tickets.
    while (Date.now() - started < 20_000 && processed < 1000) {
      const page = await store.tickets.list({ deletedAt: null }, { afterId: cursor ?? undefined, take: 100, orderBy: { field: "id", dir: "asc" } });
      for (const ticket of page) {
        if (Date.now() - started >= 20_000) break;
        if (ticket.workflow && !["closed", "cancelled"].includes(ticket.status) && await monitorWorkflowTicket(store, ticket.id)) changed++;
        cursor = ticket.id; processed++;
      }
      if (page.length < 100 && (!page.length || cursor === page.at(-1)?.id)) { complete = true; cursor = null; break; }
    }
    if (Date.now() - started < 22_000) await cleanWorkflowMetadata(store, Date.now(), Math.min(started + 25_000, Date.now() + 3000));
    const delivery = await drainWorkflowOutbox(store, started + 40_000);
    if (!storeOverride && Date.now() - started < 40_000) await retryPendingWebhookDeliveries(1);
    await finishLease(store, lease, { cursor, lastError: null, ...(complete ? { lastSuccessAt: new Date().toISOString() } : {}) });
    logger.info("workflow.sweep.completed", { requestId: lease.owner, entryPoint, processed, changed, complete, ...delivery, durationMs: Date.now() - started });
    return { skipped: false, processed, changed, complete, delivery };
  } catch {
    await finishLease(store, lease, { cursor, lastError: "Workflow sweep failed. See deployment logs and runbook." });
    logger.error("workflow.sweep.failed", { requestId: lease.owner, entryPoint, processed, durationMs: Date.now() - started });
    throw new Error("Workflow maintenance failed.");
  }
}

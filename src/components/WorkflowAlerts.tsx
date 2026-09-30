"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import type { WorkflowAlerts as Alerts } from "@/server/services/workflowBoard";

export function WorkflowAlertSummary({ data }: { data: Alerts }) {
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState("");
  if (!data.enabled) return null;
  return <section className="panel" style={{ padding: 16, marginBottom: 16 }} aria-label="Bucket monitoring">
    <h2 style={{ fontSize: 17 }}>{data.alerts.length > 0 && <span className="workflow-alert-dot" aria-hidden="true" />}Bucket monitoring · {data.alerts.length} need attention</h2>
    {data.alerts.length > 0 ? <><p role="status">Unattended or overdue tickets remain visible until somebody acts on them.</p><details><summary>View affected tickets</summary><ul>{data.alerts.map((alert) => <li key={alert.ticketId}><Link href={`/tickets/${alert.ticketId}`}>{alert.reference}: {alert.subject}</Link> — {alert.level.replaceAll("_", " ")}{alert.dueAt ? ` · due ${new Date(alert.dueAt).toLocaleString()}` : ""}</li>)}</ul></details></> : <p>No unattended-ticket warnings in your buckets.</p>}
    {!data.health.monitorFresh && <p role="status">Background monitoring is not healthy yet. Last complete sweep: {data.health.lastSuccessAt ? new Date(data.health.lastSuccessAt).toLocaleString() : "never"}. Configure/check the minute scheduler; dashboard alerts alone do not send escalations.</p>}
    {!data.health.emailConfigured && <p>Email delivery is not configured. Notifications stay queued and visible in-app.</p>}
    {!data.health.confirmationConfigured && <p>External requester confirmation links require AUTH_SECRET and APP_BASE_URL configuration.</p>}
    {(data.health.pendingEmails > 0 || data.health.failedEmails > 0) && <p>{data.health.pendingEmails} queued emails · {data.health.failedEmails} exhausted deliveries{data.health.failedEmails ? " — administrator action required" : ""}</p>}
    {data.canRetryEmails && data.health.failedEmails > 0 && <button type="button" className="btn btn-ghost" disabled={retrying} onClick={async () => {
      setRetrying(true); setRetryMessage("");
      try { const result = await apiSend<{ retried: number }>("/workflow/retry-emails", "POST", {}); setRetryMessage(`${result.retried} deliveries queued for retry. Check provider credentials and quota first.`); }
      catch { setRetryMessage("Could not queue retries. Please try again."); } finally { setRetrying(false); }
    }}>{retrying ? "Queuing…" : "Retry failed emails (up to 100)"}</button>}
    {retryMessage && <p role="status">{retryMessage}</p>}
    <Link href="/triage">Open bucket board</Link>
    <style jsx>{`.workflow-alert-dot { display:inline-block;width:9px;height:9px;margin-right:8px;border-radius:50%;background:var(--danger-fg,#b42318);animation:unattended-pulse 2s ease-in-out infinite; } @keyframes unattended-pulse { 50% { opacity:.4; } } @media (prefers-reduced-motion:reduce) { .workflow-alert-dot { animation:none; } }`}</style>
  </section>;
}

export function WorkflowDashboardAlerts() {
  const [data, setData] = useState<Alerts | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () => { void apiGet<Alerts>("/workflow/alerts").then((value) => { if (live) { setData(value); setError(false); } }).catch(() => { if (live) setError(true); }); };
    refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 15000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  return <>{error && <p role="status">Bucket alerts could not refresh; any displayed results may be stale.</p>}{data && <WorkflowAlertSummary data={data} />}</>;
}

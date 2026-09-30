"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import { usePersona } from "./Persona";
import type { WorkflowBoard } from "@/server/services/workflowBoard";
import type { WorkflowAction } from "@/server/services/workflowService";
import type { TicketRow } from "@/server/domain/models";
import { WORKFLOW_LABELS } from "@/shared/workflow";
import { PriorityBadge, timeAgo } from "./ui";
import { WorkflowAlertSummary } from "./WorkflowAlerts";

export function BucketWorkspace({ legacy }: { legacy: ReactNode }) {
  const { persona, ready } = usePersona();
  const [board, setBoard] = useState<WorkflowBoard | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    apiGet<WorkflowBoard>("/workflow/board").then((value) => { setBoard(value); setError(""); }).catch((failure: Error) => setError(failure.message));
  }, []);
  useEffect(() => {
    if (!ready || persona.role !== "agent") return;
    refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 15000);
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [ready, persona.role, refresh]);
  if (ready && persona.role !== "agent") return <p>Staff access is required for ticket buckets.</p>;
  if (!board) return <div className="panel" style={{ padding: 20 }} role="status">{error || "Loading ticket buckets…"}{error && <button className="btn" onClick={refresh}>Retry</button>}</div>;
  if (!board.settings.enabled && !board.hasWorkflowTickets) return board.canDispatch ? legacy : <div className="panel" style={{ padding: 20 }}>Your organization’s bucket workflow has not been enabled yet.</div>;
  return <main style={{ display: "grid", gap: 16, padding: "clamp(12px, 2vw, 28px)", minWidth: 0 }}>
    <header><h1>Triage &amp; department buckets</h1><p className="muted">Review at the service desk, route to a department, then accept responsibility. Assignment alone is not acceptance.</p></header>
    {error && <p role="alert">Refresh failed: {error}. Showing the last successful update.</p>}
    <WorkflowAlertSummary data={board.monitoring} />
    <div className="panel" style={{ padding: 16 }} role="status">{board.tickets.filter((ticket) => ["service_desk", "department", "awaiting_acceptance"].includes(ticket.workflow!.phase)).length} tickets awaiting review or acceptance · refreshes every 15 seconds</div>
    <section className="panel" style={{ padding: 16 }}><h2>Team workload</h2><p className="muted">{board.teamsConfigured ? "Teams connection configured; stale results fall back to in-app availability." : "Teams is not configured. Using in-app working hours and capacity."} <Link href="/settings">Manage availability</Link></p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>{board.staff.map((user) => <div key={user.id}><strong>{user.name}</strong><p>{user.availability.status.replaceAll("_", " ")} · {user.availability.openCount}/{user.availability.capacity} active · {user.availability.source === "teams" ? "Teams" : "In-app"}</p><p className="muted">{user.availability.reason}{user.availability.until ? ` Until ${new Date(user.availability.until).toLocaleString()}.` : ""}</p></div>)}</div>
    </section>
    {board.settings.buckets.map((bucket) => {
      const group = board.groups.find((row) => row.id === bucket.groupId);
      const tickets = board.tickets.filter((ticket) => ticket.assignmentGroupId === bucket.groupId);
      if (!board.canDispatch && !group?.memberIds.includes(persona.id) && !tickets.length) return null;
      return <section className="panel" key={bucket.groupId} style={{ padding: 16 }}>
        <h2>{group?.name ?? "Bucket unavailable"} <span className="muted">({tickets.length})</span></h2>
        <p className="muted">{bucket.kind === "service_desk" ? "Service-desk review" : "Department queue"} · Manager: {board.staff.find((user) => user.id === bucket.managerId)?.name ?? "Unavailable"} · Senior RM: {board.staff.find((user) => user.id === bucket.seniorRmId)?.name ?? "Unavailable"}</p>
        {!tickets.length && <p className="muted">No tickets waiting in this bucket.</p>}
        {tickets.map((ticket) => <BucketTicket key={ticket.id} ticket={ticket} board={board} actorId={persona.id} refresh={refresh} />)}
      </section>;
    })}
  </main>;
}

function BucketTicket({ ticket, board, actorId, refresh }: { ticket: TicketRow; board: WorkflowBoard; actorId: string; refresh: () => void }) {
  const workflow = ticket.workflow!;
  const [groupId, setGroupId] = useState("");
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const group = board.groups.find((row) => row.id === ticket.assignmentGroupId);
  const onHold = ticket.status === "pending" || !!ticket.slaPausedAt;
  async function act(action: WorkflowAction["action"]) {
    setBusy(true); setError("");
    try { await apiSend(`/tickets/${ticket.id}/workflow`, "POST", { action, groupId: groupId || undefined, userId: userId || undefined, reason: reason || undefined }); refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update ticket."); }
    finally { setBusy(false); }
  }
  const button = (label: string, action: WorkflowAction["action"], disabled = false) => <button className="btn" disabled={busy || onHold || disabled} onClick={() => act(action)}>{label}</button>;
  return <article style={{ borderTop: "1px solid var(--border)", padding: "16px 0" }}>
    <div className="flex items-center" style={{ gap: 8, flexWrap: "wrap" }}><PriorityBadge priority={ticket.priority} /><Link href={`/tickets/${ticket.id}`}><strong>{ticket.reference}: {ticket.subject}</strong></Link></div>
    <p>{WORKFLOW_LABELS[workflow.phase]} · Entered {timeAgo(workflow.queuedAt)}{onHold ? " · On hold" : ""}</p>
    {board.queueHealth[ticket.id]?.managerDueAt && <p className="muted">Review/pickup due: {new Date(board.queueHealth[ticket.id].managerDueAt!).toLocaleString()} · {board.queueHealth[ticket.id].level.replaceAll("_", " ")}</p>}
    {workflow.reviewerId && <p className="muted">Reviewer: {board.staff.find((user) => user.id === workflow.reviewerId)?.name ?? "Former staff member"}</p>}
    {ticket.assigneeId && <p className="muted">Agent: {board.staff.find((user) => user.id === ticket.assigneeId)?.name ?? "Unavailable"}{workflow.acceptedAt ? ` · Accepted ${timeAgo(workflow.acceptedAt)}` : " · Not yet accepted"}</p>}
    {board.suggestions[ticket.id]?.length > 0 && <details><summary>Suggested agents · recent similar resolutions</summary><ul>{board.suggestions[ticket.id].slice(0, 5).map((suggestion) => <li key={suggestion.id}><strong>{suggestion.name}</strong> — {suggestion.reason} {suggestion.availability.status.replaceAll("_", " ")} · {suggestion.availability.openCount}/{suggestion.availability.capacity} active.</li>)}</ul></details>}
    <div className="flex items-center" style={{ gap: 8, flexWrap: "wrap" }}>
      {workflow.phase === "service_desk" && !workflow.reviewerId && button("Claim review", "claim_review")}
      {workflow.phase === "service_desk" && (board.canDispatch || workflow.reviewerId === actorId) && <>
        <select className="select" style={{ width: "auto", maxWidth: "100%" }} aria-label={`Department for ${ticket.reference}`} value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">Choose department bucket</option>{board.settings.buckets.filter((bucket) => bucket.kind === "department").map((bucket) => <option key={bucket.groupId} value={bucket.groupId}>{board.groups.find((row) => row.id === bucket.groupId)?.name}</option>)}</select>
        {button("Route to department", "route", !groupId)}
      </>}
      {workflow.phase === "department" && group?.memberIds.includes(actorId) && button("Pick up ticket", "pickup")}
      {["department", "awaiting_acceptance"].includes(workflow.phase) && board.canDispatch && <>
        <select className="select" style={{ width: "auto", maxWidth: "100%" }} aria-label={`Assign ${ticket.reference}`} value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Choose department agent</option>{(board.suggestions[ticket.id] ?? []).map((user) => <option key={user.id} value={user.id}>{user.name} · {user.availability.status.replaceAll("_", " ")} · {user.similarResolved} similar resolved</option>)}</select>
        {button("Offer assignment", "offer", !userId)}
      </>}
      {workflow.phase === "awaiting_acceptance" && ticket.assigneeId === actorId && button("Accept assignment", "accept")}
      {["in_progress", "awaiting_acceptance"].includes(workflow.phase) && (ticket.assigneeId === actorId || board.canDispatch) && <>
        <input className="input" style={{ width: "auto", maxWidth: "100%" }} aria-label={`Return reason for ${ticket.reference}`} value={reason} maxLength={500} placeholder="Reason for returning to bucket" onChange={(e) => setReason(e.target.value)} />
        {button(workflow.phase === "in_progress" ? "Release to bucket" : "Decline assignment", workflow.phase === "in_progress" ? "release" : "decline", !reason.trim())}
      </>}
    </div>
    {error && <p role="alert">{error}</p>}
  </article>;
}

"use client";

// =============================================================================
// Route /tickets/[id] — the ticket detail workspace.
//
// Renders role-specific layouts from one page: agents get the three-pane
// console (properties/SLA/approvals | conversation + composer | AI analysis +
// activity + attachments), requesters get a focused conversation + reply view.
// Panes collapse into tabs on narrow screens. Reads the full TicketView from
// /api/v1/tickets/[id]; all actions go through the ticket action/message APIs.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiGet, apiGetAll, ApiError, apiSend } from "@/lib/api";
import type { TicketView } from "@/server/services/ticketService";
import type { AssignmentGroupRow, CIRow, CustomFieldDefRow, UserRow } from "@/server/domain/models";
import {
  AIPanel,
  DecisionBadge,
  InfoHint,
  LabelWithHint,
  PriorityBadge,
  SlaBadge,
  SparkleIcon,
  StatusBadge,
  formatDuration,
  timeAgo,
} from "@/components/ui";
import { HINTS } from "@/lib/hints";
import TicketComposer from "@/components/TicketComposer";
import TicketProperties from "@/components/TicketProperties";
import ConversationThread from "@/components/ConversationThread";
import RequesterReplyBox from "@/components/RequesterReplyBox";
import RelatedTicketsPanel from "@/components/RelatedTicketsPanel";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import { TicketDetailSkeleton } from "@/components/Skeleton";
import { usePersona } from "@/components/Persona";
import { useToast } from "@/components/Toast";
import { useNarrow } from "@/components/useNarrow";
import { useTicketLive, type TypingUser } from "@/lib/liveTicket";

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { persona, ready } = usePersona();
  const [ticket, setTicket] = useState<TicketView | null | undefined>(undefined);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [groups, setGroups] = useState<AssignmentGroupRow[]>([]);
  const [cis, setCis] = useState<CIRow[]>([]);
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    apiGet<TicketView>(`/tickets/${id}`)
      .then((t) => {
        setTicket(t);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        // Only a real 404 means "no such ticket". A dropped connection or a
        // server error must not tell the user their ticket has vanished.
        if (err instanceof ApiError && err.notFound) {
          setTicket(null);
          setLoadError(null);
        } else {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
  }, [id]);

  // Realtime: server-side changes (replies, status, assignment) re-fetch the
  // ticket without a reload, and typing pings surface as chat indicators.
  const { typing } = useTicketLive(id, {
    selfId: persona.id,
    selfName: persona.name,
    onUpdate: refresh,
  });

  useEffect(() => {
    if (!ready) return;
    refresh();
    if (persona.role === "agent") {
      apiGetAll<UserRow>("/users").then(setUsers).catch(() => {});
      apiGetAll<AssignmentGroupRow>("/groups").then(setGroups).catch(() => {});
      apiGetAll<CIRow>("/cis").then(setCis).catch(() => {});
      apiGetAll<CustomFieldDefRow>("/custom-fields").then(setCustomFieldDefs).catch(() => {});
    }
  }, [ready, persona.role, persona.id, refresh]);

  if (loadError && ticket === undefined) {
    return (
      <div className="page-pad">
        <div className="panel" style={{ padding: "2rem", textAlign: "center" }}>
          <p style={{ fontWeight: 700, marginBottom: 6 }}>Could not load this ticket</p>
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 14 }}>{loadError}</p>
          <div className="flex items-center justify-center" style={{ gap: 8 }}>
            <button className="btn btn-primary" onClick={refresh}>
              Try again
            </button>
            <Link href="/tickets" className="btn btn-ghost">
              ← Back
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (ticket === undefined || !ready)
    return (
      <div className="page-pad">
        <TicketDetailSkeleton />
      </div>
    );

  if (ticket === null) {
    return (
      <div className="page-pad">
        <div className="panel" style={{ padding: "2rem", textAlign: "center" }}>
          <p style={{ fontWeight: 700, marginBottom: 14 }}>Ticket not found</p>
          <Link href="/tickets" className="btn btn-ghost">
            ← Back
          </Link>
        </div>
      </div>
    );
  }

  return persona.role === "agent" ? (
    <AgentView
      ticket={ticket}
      users={users}
      groups={groups}
      cis={cis}
      customFieldDefs={customFieldDefs}
      typing={typing}
      onChanged={refresh}
    />
  ) : (
    <RequesterView ticket={ticket} typing={typing} onChanged={refresh} />
  );
}

// ---------------------------------------------------------------- Agent view

type AgentPane = "conversation" | "details" | "context";

function AgentView({
  ticket,
  users,
  groups,
  cis,
  customFieldDefs,
  typing,
  onChanged,
}: {
  ticket: TicketView;
  users: UserRow[];
  groups: AssignmentGroupRow[];
  cis: CIRow[];
  customFieldDefs: CustomFieldDefRow[];
  typing: TypingUser[];
  onChanged: () => void;
}) {
  const narrow = useNarrow(1200);
  const [pane, setPane] = useState<AgentPane>("conversation");

  const detailsPane = (
    <>
      <ApprovalPanel ticket={ticket} onChanged={onChanged} />

      <div className="label" style={{ marginBottom: 12 }}>
        <LabelWithHint
          info="The classification and routing fields for this ticket. Editing any of them is recorded in the audit trail, and changing impact or urgency recalculates the priority."
          side="right"
        >
          Properties
        </LabelWithHint>
      </div>
      <TicketProperties
        key={ticket.id}
        ticket={ticket}
        users={users}
        groups={groups}
        cis={cis}
        customFieldDefs={customFieldDefs}
        onChanged={onChanged}
      />

      <RelatedTicketsPanel ticket={ticket} onChanged={onChanged} />

      <SlaPanel ticket={ticket} />

      <AttachmentsPanel ticketId={ticket.id} canDelete />
    </>
  );

  const conversationPane = (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ flex: 1, overflow: "auto", padding: "1.25rem", background: "var(--bg)" }}>
        <ConversationThread ticket={ticket} viewerRole="agent" typing={typing} />
      </div>
      <TicketComposer ticket={ticket} onChanged={onChanged} />
    </div>
  );

  const contextPane = <ContextPane ticket={ticket} />;

  if (narrow) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <TicketHeader ticket={ticket} showSla />

        {/* Pane switcher for tablet/mobile */}
        <div
          role="tablist"
          style={{
            display: "flex",
            gap: 4,
            padding: "0.5rem 1rem 0",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface)",
            flexShrink: 0,
            overflowX: "auto",
          }}
        >
          {(
            [
              ["conversation", "Conversation"],
              ["details", "Details & SLA"],
              ["context", "AI & activity"],
            ] as [AgentPane, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={pane === id}
              onClick={() => setPane(id)}
              style={{
                padding: "0.5rem 0.85rem",
                fontSize: "0.82rem",
                fontWeight: 700,
                cursor: "pointer",
                borderTop: "none",
                borderRight: "none",
                borderLeft: "none",
                background: "transparent",
                color: pane === id ? "var(--brand-600)" : "var(--muted)",
                borderBottom: `2px solid ${pane === id ? "var(--brand-500)" : "transparent"}`,
                transition: "color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease)",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {pane === "conversation" ? (
          conversationPane
        ) : (
          <div
            key={pane}
            className="anim-fade-in"
            style={{ flex: 1, overflow: "auto", background: "var(--surface)", padding: "1rem" }}
          >
            {pane === "details" ? detailsPane : contextPane}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <TicketHeader ticket={ticket} showSla />

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Left: properties */}
        <aside
          style={{
            width: 290,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            overflow: "auto",
            background: "var(--surface)",
            padding: "1rem",
          }}
        >
          {detailsPane}
        </aside>

        {/* Center: conversation + composer */}
        {conversationPane}

        {/* Right: context (AI + activity) */}
        <aside
          style={{
            width: 330,
            flexShrink: 0,
            borderLeft: "1px solid var(--border)",
            overflow: "auto",
            background: "var(--surface)",
            padding: "1rem",
          }}
        >
          {contextPane}
        </aside>
      </div>
    </div>
  );
}

function SlaPanel({ ticket }: { ticket: TicketView }) {
  const sla = ticket.sla;
  const responded = !!ticket.firstRespondedAt;
  const resolved = !!ticket.resolvedAt || ["closed", "auto_resolved", "resolved"].includes(ticket.status);
  const now = Date.now();

  function slaBar(dueIso: string | null | undefined, doneAt: string | null | undefined, breached: boolean) {
    if (!dueIso) return null;
    const due = new Date(dueIso).getTime();
    const created = new Date(ticket.createdAt).getTime();
    const total = Math.max(1, due - created);
    const anchor = doneAt ? new Date(doneAt).getTime() : now;
    const pct = Math.min(100, Math.max(0, ((anchor - created) / total) * 100));
    const color = breached
      ? "var(--danger-solid)"
      : pct >= 80
      ? "var(--warning-solid)"
      : "var(--success-solid)";
    return (
      <div
        aria-hidden
        style={{ height: 6, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden", marginTop: 6 }}
      >
        <div
          className="bar-grow"
          style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999 }}
        />
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "1.25rem 0 10px" }}>
        <span className="label" style={{ margin: 0 }}>
          <LabelWithHint info={HINTS.sla} side="right">
            SLA
          </LabelWithHint>
        </span>
        <SlaBadge level={sla.level} paused={sla.paused} hint />
      </div>
      <div
        className="panel-2"
        style={{ padding: "0.75rem 0.85rem", display: "flex", flexDirection: "column", gap: 10 }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.76rem", fontWeight: 600, color: "var(--text-secondary)" }}>
              <LabelWithHint info={HINTS.slaFirstResponse} side="right">
                First response
              </LabelWithHint>
            </span>
            <span
              style={{
                fontSize: "0.76rem",
                fontWeight: 700,
                color: responded
                  ? sla.responseBreached
                    ? "var(--danger-fg)"
                    : "var(--success-fg)"
                  : sla.responseBreached
                  ? "var(--danger-fg)"
                  : "var(--text)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {responded
                ? sla.responseBreached
                  ? "breached"
                  : "met"
                : sla.responseDue
                ? formatDuration((new Date(sla.responseDue).getTime() - now) / 60000)
                : "—"}
            </span>
          </div>
          {slaBar(sla.responseDue, ticket.firstRespondedAt, !!sla.responseBreached)}
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.76rem", fontWeight: 600, color: "var(--text-secondary)" }}>
              <LabelWithHint info={HINTS.slaResolution} side="right">
                Resolution
              </LabelWithHint>
            </span>
            <span
              style={{
                fontSize: "0.76rem",
                fontWeight: 700,
                color: resolved
                  ? sla.resolveBreached
                    ? "var(--danger-fg)"
                    : "var(--success-fg)"
                  : sla.resolveBreached
                  ? "var(--danger-fg)"
                  : "var(--text)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {resolved
                ? sla.resolveBreached
                  ? "breached"
                  : "met"
                : sla.resolveDue
                ? formatDuration((new Date(sla.resolveDue).getTime() - now) / 60000)
                : "—"}
            </span>
          </div>
          {slaBar(sla.resolveDue, ticket.resolvedAt, !!sla.resolveBreached)}
        </div>
        {sla.paused ? (
          <div
            style={{
              fontSize: "0.72rem",
              color: "var(--warning-fg)",
              background: "var(--warning-bg)",
              borderRadius: 8,
              padding: "0.35rem 0.55rem",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              alignSelf: "flex-start",
            }}
          >
            <PauseGlyph /> Clock paused
            {ticket.slaPausedMins ? ` · ${ticket.slaPausedMins}m accrued` : ""}
            <InfoHint text={HINTS.slaPaused} side="right" size={11} />
          </div>
        ) : null}
      </div>
    </>
  );
}

function PauseGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function ContextPane({ ticket }: { ticket: TicketView }) {
  const res = ticket.resolution;
  return (
    <>
      {res ? (
        <>
          <AIPanel
            title="AI analysis"
            confidence={res.confidence}
            style={{ marginBottom: 10 }}
            info={HINTS.aiAnalysis}
          >
            <div style={{ marginBottom: 8 }}>
              <DecisionBadge decision={res.decision} />
            </div>
            <p style={{ margin: 0 }}>{res.reasoning}</p>
          </AIPanel>
          {res.citations.length > 0 ? (
            <>
              <div className="label" style={{ margin: "14px 0 8px" }}>
                <LabelWithHint info={HINTS.aiSources} side="right">
                  Sources
                </LabelWithHint>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {res.citations.map((c, i) => (
                  <Link
                    key={c.articleId}
                    href={`/knowledge-base?focus=${c.articleId}`}
                    className="panel-2 hover-lift"
                    style={{ padding: "0.55rem 0.7rem", textDecoration: "none", color: "inherit" }}
                  >
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                        [{i + 1}] {c.title}
                      </span>
                      <span
                        className="muted"
                        style={{ fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        {(c.score * 100).toFixed(0)}%
                        <InfoHint text={HINTS.aiCitationScore} side="left" size={11} nested />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          ) : null}
          <div className="label" style={{ margin: "16px 0 10px" }}>
            Activity
          </div>
        </>
      ) : (
        <div className="label" style={{ marginBottom: 10 }}>
          Activity
        </div>
      )}
      <ThreadSummary ticketId={ticket.id} />
      <ActivityList ticket={ticket} />
      <Link href="/audit" className="chip-link" style={{ fontSize: "0.78rem", marginTop: 10, display: "inline-flex" }}>
        Full audit trail →
      </Link>
    </>
  );
}

// ------------------------------------------------------------- Approval panel

function ApprovalPanel({ ticket, onChanged }: { ticket: TicketView; onChanged: () => void }) {
  const { persona } = usePersona();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pending = ticket.approvals.find((a) => a.state === "pending");
  const decided = ticket.approvals.filter((a) => a.state !== "pending");
  const canDecide = persona.serverRole === "manager" || persona.serverRole === "tenant_admin";

  if (!pending && decided.length === 0) return null;

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    try {
      await apiSend(`/tickets/${ticket.id}/approvals`, "POST", { decision });
      onChanged();
      toast.success({
        title: decision === "approved" ? "Request approved" : "Request rejected",
        description: decision === "approved" ? "Fulfilment resumed." : "The ticket was cancelled.",
      });
    } catch (err) {
      toast.error({ title: "Could not record decision", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="label" style={{ marginBottom: 8 }}>
        <LabelWithHint
          info="Some catalogue items need a manager to sign off before work starts. The ticket stays on hold, with its SLA clock paused, until the decision is made."
          side="right"
        >
          Approval
        </LabelWithHint>
      </div>
      {pending ? (
        <div
          className="anim-scale-in"
          style={{
            padding: "0.85rem 0.9rem",
            borderRadius: 12,
            border: "1px solid var(--warning-border)",
            background: "linear-gradient(180deg, var(--warning-bg) 0%, var(--surface) 130%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span
              aria-hidden
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "var(--warning-bg)",
                color: "var(--warning-fg)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid var(--warning-border)",
              }}
            >
              <ApprovalGlyph />
            </span>
            <div>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--warning-fg)" }}>
                Waiting on {pending.approverName}
              </div>
              <div className="muted" style={{ fontSize: "0.72rem" }}>
                <LabelWithHint info={HINTS.slaPaused} side="right" size={11}>
                  SLA clock paused while pending
                </LabelWithHint>
              </div>
            </div>
          </div>
          {canDecide ? (
            <div className="flex items-center" style={{ gap: 8, marginTop: 8 }}>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => decide("approved")}
                style={{ flex: 1 }}
              >
                {busy ? "…" : "Approve"}
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => decide("rejected")}
                style={{ flex: 1 }}
              >
                {busy ? "…" : "Reject"}
              </button>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: "0.72rem", margin: 0 }}>
              Only managers or admins can decide this request.
            </p>
          )}
        </div>
      ) : (
        decided.map((a) => {
          const isApproved = a.state === "approved";
          const isRejected = a.state === "rejected";
          const bg = isApproved
            ? "var(--success-bg)"
            : isRejected
            ? "var(--danger-bg)"
            : "var(--surface-3)";
          const fg = isApproved
            ? "var(--success-fg)"
            : isRejected
            ? "var(--danger-fg)"
            : "var(--text-secondary)";
          const border = isApproved
            ? "var(--success-border)"
            : isRejected
            ? "var(--danger-border)"
            : "var(--border)";
          return (
            <div
              key={a.id}
              style={{
                padding: "0.55rem 0.75rem",
                borderRadius: 10,
                background: bg,
                color: fg,
                border: `1px solid ${border}`,
                marginBottom: 6,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {isApproved ? <ApprovedGlyph /> : isRejected ? <RejectedGlyph /> : <ApprovalGlyph />}
              <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                {isApproved ? "Approved" : isRejected ? "Rejected" : "Cancelled"} by {a.approverName}
                {a.decidedAt ? (
                  <span style={{ opacity: 0.75, fontWeight: 500 }}> · {timeAgo(a.decidedAt)}</span>
                ) : null}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function ApprovalGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
function ApprovedGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function RejectedGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// ----------------------------------------------------------- Thread summary

function ThreadSummary({ ticketId }: { ticketId: string }) {
  const toast = useToast();
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function summarize() {
    setBusy(true);
    try {
      const r = await apiGet<{ summary: string }>(`/tickets/${ticketId}/summary`);
      setSummary(r.summary);
    } catch (err) {
      toast.error({ title: "Could not summarise", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      {summary ? (
        <AIPanel
          title="AI thread summary"
          style={{ marginBottom: 8, padding: "0.7rem 0.85rem" }}
          info={HINTS.aiSummary}
        >
          <p style={{ fontSize: "0.8rem", lineHeight: 1.5, margin: 0 }}>{summary}</p>
        </AIPanel>
      ) : null}
      <button className="btn btn-ghost" style={{ fontSize: "0.74rem", padding: "0.3rem 0.65rem" }} disabled={busy} onClick={() => void summarize()}>
        <SparkleIcon size={12} />
        {busy ? "Summarising…" : summary ? "Refresh summary" : "Summarise thread"}
      </button>
    </div>
  );
}

// ------------------------------------------------------------ Requester view

function RequesterView({
  ticket,
  typing,
  onChanged,
}: {
  ticket: TicketView;
  typing: TypingUser[];
  onChanged: () => void;
}) {
  const narrow = useNarrow(900);

  const details = (
    <>
      <div className="label" style={{ marginBottom: 12 }}>
        Request details
      </div>
      <Row
        label="Reference"
        value={ticket.reference}
        info="Quote this reference when you follow up. INC is an incident (something broken), REQ is a service request."
      />
      <Row label="Status" value={<StatusBadge status={ticket.status} />} />
      <Row
        label="Category"
        value={`${ticket.category}${ticket.subcategory ? ` › ${ticket.subcategory}` : ""}`}
        info={HINTS.category}
      />
      <Row label="Created" value={timeAgo(ticket.createdAt)} />
      <Row label="Updated" value={timeAgo(ticket.updatedAt)} />
      {ticket.approvals.some((a) => a.state === "pending") ? (
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: 10 }}>
          Your request is awaiting manager approval.
        </p>
      ) : null}
      <AttachmentsPanel ticketId={ticket.id} />
    </>
  );

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <TicketHeader ticket={ticket} />

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: 1, overflow: "auto", padding: "1.25rem", background: "var(--bg)" }}>
            {narrow ? (
              <div className="panel anim-fade-up" style={{ padding: "0.9rem 1rem", marginBottom: 14 }}>
                {details}
              </div>
            ) : null}
            <ConversationThread ticket={ticket} viewerRole="requester" typing={typing} />
          </div>
          <div style={{ borderTop: "1px solid var(--border)", background: "var(--surface)", padding: "1rem 1.25rem" }}>
            <RequesterReplyBox ticket={ticket} onChanged={onChanged} />
          </div>
        </div>

        {!narrow ? (
          <aside
            style={{
              width: 300,
              flexShrink: 0,
              borderLeft: "1px solid var(--border)",
              overflow: "auto",
              background: "var(--surface)",
              padding: "1rem",
            }}
          >
            {details}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shared bits

function TicketHeader({ ticket, showSla }: { ticket: TicketView; showSla?: boolean }) {
  const requesterInitials = initialsOf(ticket.requesterEmail);
  const assigneeInitials = ticket.assignee?.name ? initialsOf(ticket.assignee.name) : null;
  return (
    <header
      style={{
        flexShrink: 0,
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        padding: "0.85rem 1.25rem 1rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <Link href="/tickets" className="chip-link" style={{ fontSize: "0.78rem" }}>
          <BackGlyph /> <span style={{ marginLeft: 4 }}>All tickets</span>
        </Link>
        <span style={{ color: "var(--muted-soft)" }}>›</span>
        <span className="mono" style={{ fontSize: "0.74rem", color: "var(--muted)" }}>
          {ticket.reference}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              fontSize: "clamp(1.2rem, 2vw, 1.4rem)",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              margin: 0,
              color: "var(--text)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {ticket.subject}
          </h1>
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              marginTop: 10,
              alignItems: "center",
            }}
          >
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} hint />
            {showSla ? <SlaBadge level={ticket.sla.level} paused={ticket.sla.paused} hint /> : null}
            <span
              className="badge"
              style={{
                background: "var(--surface-3)",
                color: "var(--text-secondary)",
                borderColor: "var(--border)",
              }}
            >
              {ticket.category}
              {ticket.subcategory ? ` › ${ticket.subcategory}` : ""}
            </span>
            {ticket.linkedCIs.length ? (
              <span
                className="badge"
                style={{
                  background: "var(--info-bg)",
                  color: "var(--info-fg)",
                  borderColor: "var(--info-border)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <ChipGlyph />
                {ticket.linkedCIs.length === 1
                  ? ticket.linkedCIs[0].name
                  : `${ticket.linkedCIs.length} CIs`}
                <InfoHint text={HINTS.affectedCIs} side="bottom" size={11} />
              </span>
            ) : null}
          </div>
        </div>

        {showSla ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexShrink: 0,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <PersonChip
              label="Requester"
              name={ticket.requesterEmail}
              initials={requesterInitials}
              tone="brand"
            />
            <PersonChip
              label="Assignee"
              name={ticket.assignee?.name ?? "Unassigned"}
              initials={assigneeInitials ?? "?"}
              tone={ticket.assignee ? "info" : "muted"}
              sub={ticket.assignmentGroup?.name}
            />
          </div>
        ) : null}
      </div>
    </header>
  );
}

function PersonChip({
  label,
  name,
  initials,
  tone,
  sub,
}: {
  label: string;
  name: string;
  initials: string;
  tone: "brand" | "info" | "muted";
  sub?: string;
}) {
  const c = PERSON_TONE[tone];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0.35rem 0.65rem 0.35rem 0.4rem",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        maxWidth: 240,
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          background: c.bg,
          color: c.fg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: "0.7rem",
          flexShrink: 0,
        }}
      >
        {initials}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
          {label}
        </div>
        <div
          style={{
            fontSize: "0.78rem",
            fontWeight: 600,
            color: "var(--text)",
            lineHeight: 1.1,
            marginTop: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 180,
          }}
        >
          {name}
        </div>
        {sub ? (
          <div className="muted" style={{ fontSize: "0.66rem", marginTop: 1 }}>
            {sub}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const PERSON_TONE: Record<"brand" | "info" | "muted", { bg: string; fg: string }> = {
  brand: { bg: "var(--brand-50)", fg: "var(--brand-700)" },
  info: { bg: "var(--info-bg)", fg: "var(--info-fg)" },
  muted: { bg: "var(--surface-3)", fg: "var(--muted)" },
};

function initialsOf(source: string): string {
  const base = source.includes("@") ? source.split("@")[0] : source;
  return base
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

function BackGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}
function ChipGlyph() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </svg>
  );
}

function ActivityList({ ticket }: { ticket: TicketView }) {
  const events = [...ticket.events].reverse();
  return (
    <ol
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        position: "relative",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 6,
          top: 8,
          bottom: 8,
          width: 2,
          background: "var(--border)",
          borderRadius: 2,
        }}
      />
      {events.map((e) => (
        <li key={e.id} style={{ position: "relative", paddingLeft: 22, paddingBottom: 10 }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 4,
              width: 14,
              height: 14,
              borderRadius: 999,
              border: "3px solid var(--surface)",
              background: activityColor(e.type),
              boxShadow: "0 0 0 1px var(--border)",
            }}
          />
          <div style={{ fontSize: "0.8rem", lineHeight: 1.45, color: "var(--text)" }}>{e.message}</div>
          <div className="muted" style={{ fontSize: "0.68rem", marginTop: 2 }}>
            {e.type.replace(/_/g, " ")} · {timeAgo(e.createdAt)}
          </div>
        </li>
      ))}
    </ol>
  );
}

function activityColor(type: string): string {
  if (type.includes("resolved") || type.includes("approved")) return "var(--success-solid)";
  if (type.includes("escalat") || type.includes("reject")) return "var(--danger-solid)";
  if (type.includes("pending") || type.includes("hold")) return "var(--warning-solid)";
  if (type.includes("assign") || type.includes("route")) return "var(--info-solid)";
  return "var(--brand-600)";
}

function Row({ label, value, info }: { label: string; value: React.ReactNode; info?: string }) {
  return (
    <div className="flex items-center justify-between" style={{ fontSize: "0.83rem", marginBottom: 9 }}>
      <span className="muted">
        <LabelWithHint info={info} side="right">
          {label}
        </LabelWithHint>
      </span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

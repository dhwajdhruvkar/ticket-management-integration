"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { AIPanel, Avatar, InfoHint, LabelWithHint } from "@/components/ui";
import { HINTS } from "@/lib/hints";
import { useAgentOnly, usePersona } from "@/components/Persona";
import { useToast } from "@/components/Toast";
import type { UserRow } from "@/server/domain/models";

// =============================================================================
// Route /changes — ITIL Change Management (agent+; approvals need manager+).
//
// Lists changes with an AI risk gauge and a CAB stepper (draft -> assessing ->
// CAB review -> approved -> scheduled -> implementing -> review -> closed).
// Managers/admins approve or reject; the lifecycle buttons advance state. New
// changes are created with an automatic AI risk assessment.
// =============================================================================

interface Approval {
  id: string;
  approverName: string;
  state: string;
  comment?: string | null;
}
interface Change {
  id: string;
  reference: string;
  title: string;
  description: string;
  type: string;
  status: string;
  riskScore?: number | null;
  riskRationale?: string | null;
  approvals: Approval[];
}

function riskColor(score?: number | null): string {
  if (score == null) return "var(--muted)";
  if (score >= 66) return "var(--danger-solid)";
  if (score >= 33) return "var(--warning-solid)";
  return "var(--success-solid)";
}

// The CAB state machine: which action moves a change forward from each state.
const NEXT_STEP: Record<string, { label: string; status: string } | undefined> = {
  approved: { label: "Schedule", status: "scheduled" },
  scheduled: { label: "Start implementation", status: "implementing" },
  implementing: { label: "Move to review", status: "review" },
  review: { label: "Close change", status: "closed" },
};

export default function ChangesPage() {
  const { persona } = usePersona();
  const isAgent = useAgentOnly();
  const toast = useToast();
  const canApprove = ["manager", "tenant_admin", "super_admin"].includes(persona.serverRole);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("normal");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await apiGet<Change[]>("/changes");
      const views = await Promise.all(list.map((c) => apiGet<Change>(`/changes/${c.id}`).catch(() => c)));
      setChanges(views);
    } catch {
      setChanges([]);
    }
  }, []);

  useEffect(() => {
    if (!isAgent) return;
    refresh();
    apiGet<UserRow[]>("/users").then(setUsers).catch(() => {});
  }, [isAgent, refresh]);

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      await refresh();
      if (ok) toast.success({ title: ok });
    } catch (err) {
      toast.error({ title: "Action failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  function create() {
    if (!title.trim() || !description.trim()) return;
    void run(
      "create",
      async () => {
        await apiSend("/changes", "POST", { title, description, type });
        setTitle("");
        setDescription("");
        setShowForm(false);
      },
      "Change created with an AI risk assessment"
    );
  }

  function submit(id: string) {
    // Route CAB approval to the tenant's real approvers (managers/admins).
    const approvers = users
      .filter((u) => u.role === "manager" || u.role === "tenant_admin")
      .map((u) => ({ id: u.id, name: u.name }));
    void run(
      `submit-${id}`,
      () =>
        apiSend(`/changes/${id}/approvals`, "POST", {
          op: "submit",
          approvers: approvers.length ? approvers : undefined,
        }),
      "Submitted for CAB approval"
    );
  }

  function decide(id: string, approvalId: string, state: "approved" | "rejected") {
    void run(
      `decide-${approvalId}`,
      () => apiSend(`/changes/${id}/approvals`, "POST", { op: "decide", approvalId, state }),
      state === "approved" ? "Approval recorded" : "Rejection recorded"
    );
  }

  function advance(c: Change) {
    const step = NEXT_STEP[c.status];
    if (!step) return;
    void run(
      `advance-${c.id}`,
      () => apiSend(`/changes/${c.id}`, "PATCH", { status: step.status }),
      `${c.reference} → ${step.status.replace(/_/g, " ")}`
    );
  }

  if (!isAgent) return <div className="page-pad" />;

  return (
    <div className="page-pad">
      <header
        className="anim-fade-up"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}
      >
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>Changes Pipeline</h1>
          <p className="muted" style={{ fontSize: "0.88rem", marginTop: 3 }}>
            AI-scored changes with a CAB approval workflow.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Close" : "+ New change"}
        </button>
      </header>

      {showForm ? (
        <div className="panel anim-fade-up" style={{ padding: "1.2rem", marginBottom: 16 }}>
          <input className="input" placeholder="Change title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginBottom: 8 }} />
          <textarea className="textarea" rows={3} placeholder="What is changing and why" value={description} onChange={(e) => setDescription(e.target.value)} style={{ marginBottom: 8 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <select
              className="select"
              value={type}
              onChange={(e) => setType(e.target.value)}
              style={{ maxWidth: 220 }}
              aria-label="Change type"
            >
              <option value="standard">Standard (pre-approved)</option>
              <option value="normal">Normal</option>
              <option value="emergency">Emergency</option>
            </select>
            <InfoHint
              text={`${HINTS.changeStandard} ${HINTS.changeNormal} ${HINTS.changeEmergency}`}
              side="right"
            />
          </div>
          <div>
            <button className="btn btn-primary" onClick={create} disabled={busy === "create" || !title.trim() || !description.trim()}>
              {busy === "create" ? "Assessing risk…" : "Create change"}
            </button>
          </div>
        </div>
      ) : null}

      {changes === null ? (
        <p className="muted">Loading…</p>
      ) : changes.length === 0 ? (
        <div
          className="panel anim-scale-in"
          style={{ padding: "2.5rem 1.5rem", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}
        >
          <div
            aria-hidden
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "var(--brand-50)",
              color: "var(--brand-600)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GitBranchGlyph size={26} />
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>No changes recorded</div>
            <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>
              Create the first change — the assistant scores its risk automatically.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ New change</button>
        </div>
      ) : (
        <div className="stagger" style={{ display: "grid", gap: 12 }}>
          {changes.map((c) => {
            const step = NEXT_STEP[c.status];
            return (
              <div key={c.id} className="panel" style={{ padding: "1.1rem 1.25rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{c.reference}</span>
                  <span className="badge" style={{ textTransform: "capitalize", background: "var(--surface-3)", color: "var(--text-secondary)", borderColor: "var(--border)" }}>{c.type}</span>
                  <RiskGauge score={c.riskScore} />
                </div>

                <CabStepper status={c.status} />

                <div style={{ fontWeight: 700, fontSize: "0.98rem", marginTop: 10 }}>{c.title}</div>
                <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0 6px", lineHeight: 1.5 }}>{c.description}</p>
                {c.riskRationale ? (
                  <AIPanel
                    title="AI risk assessment"
                    style={{ margin: "0 0 8px", padding: "0.65rem 0.8rem" }}
                    info={HINTS.aiRiskScore}
                  >
                    <span style={{ lineHeight: 1.5, fontSize: "0.78rem" }}>{c.riskRationale}</span>
                  </AIPanel>
                ) : null}

                {c.approvals.length > 0 ? (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                      <div className="label" style={{ margin: 0 }}>
                        <LabelWithHint info={HINTS.cab}>CAB approvals</LabelWithHint>
                      </div>
                      <CabVoteMeter approvals={c.approvals} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {c.approvals.map((a) => (
                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <Avatar name={a.approverName} size={26} />
                          <span style={{ fontSize: "0.84rem", flex: 1, fontWeight: 600 }}>{a.approverName}</span>
                          <span
                            className="badge"
                            style={{
                              textTransform: "capitalize",
                              background:
                                a.state === "approved"
                                  ? "var(--success-bg)"
                                  : a.state === "rejected"
                                  ? "var(--danger-bg)"
                                  : "var(--warning-bg)",
                              color:
                                a.state === "approved"
                                  ? "var(--success-fg)"
                                  : a.state === "rejected"
                                  ? "var(--danger-fg)"
                                  : "var(--warning-fg)",
                              borderColor:
                                a.state === "approved"
                                  ? "var(--success-border)"
                                  : a.state === "rejected"
                                  ? "var(--danger-border)"
                                  : "var(--warning-border)",
                            }}
                          >
                            {a.state}
                          </span>
                          {a.state === "pending" && canApprove ? (
                            <>
                              <button
                                className="btn btn-ghost"
                                style={{ fontSize: "0.72rem", padding: "0.25rem 0.5rem" }}
                                disabled={busy === `decide-${a.id}`}
                                onClick={() => decide(c.id, a.id, "approved")}
                              >
                                Approve
                              </button>
                              <button
                                className="btn btn-danger"
                                style={{ fontSize: "0.72rem", padding: "0.25rem 0.5rem" }}
                                disabled={busy === `decide-${a.id}`}
                                onClick={() => decide(c.id, a.id, "rejected")}
                              >
                                Reject
                              </button>
                            </>
                          ) : a.state === "pending" ? (
                            <span className="muted" style={{ fontSize: "0.7rem" }}>manager decides</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : c.status === "draft" ? (
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: "0.78rem" }}
                    disabled={busy === `submit-${c.id}`}
                    onClick={() => submit(c.id)}
                  >
                    {busy === `submit-${c.id}` ? "Submitting…" : "Submit for CAB approval"}
                  </button>
                ) : null}

                {step ? (
                  <div style={{ marginTop: 10 }}>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: "0.78rem", padding: "0.35rem 0.8rem" }}
                      disabled={busy === `advance-${c.id}`}
                      onClick={() => advance(c)}
                    >
                      {busy === `advance-${c.id}` ? "Updating…" : `${step.label} →`}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   Pieces
   ========================================================================= */

const CAB_STAGES = ["draft", "assessing", "awaiting_approval", "approved", "scheduled", "implementing", "review", "closed"];
const STAGE_LABEL: Record<string, string> = {
  draft: "Draft",
  assessing: "Assessing",
  awaiting_approval: "CAB review",
  approved: "Approved",
  scheduled: "Scheduled",
  implementing: "Implementing",
  review: "Review",
  closed: "Closed",
};

function CabStepper({ status }: { status: string }) {
  const currentIdx = CAB_STAGES.indexOf(status);
  const isRejected = status === "rejected" || status === "cancelled";
  if (isRejected) {
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "0.3rem 0.7rem",
          borderRadius: 999,
          background: "var(--danger-bg)",
          color: "var(--danger-fg)",
          border: "1px solid var(--danger-border)",
          fontSize: "0.74rem",
          fontWeight: 700,
          textTransform: "capitalize",
        }}
      >
        {status.replace(/_/g, " ")}
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        overflowX: "auto",
        paddingBottom: 2,
      }}
      aria-label={`Change stage: ${STAGE_LABEL[status] ?? status}`}
    >
      <InfoHint text={HINTS.cabStages} side="right" size={12} />
      {CAB_STAGES.map((stage, i) => {
        const done = currentIdx > i;
        const active = currentIdx === i;
        return (
          <div key={stage} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            {i > 0 ? (
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 2,
                  background: done || active ? "var(--brand-500)" : "var(--border)",
                  transition: "background var(--dur-2) var(--ease)",
                }}
              />
            ) : null}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "0.22rem 0.6rem",
                borderRadius: 999,
                fontSize: "0.68rem",
                fontWeight: 700,
                whiteSpace: "nowrap",
                border: `1px solid ${active ? "var(--brand-500)" : done ? "var(--brand-100)" : "var(--border)"}`,
                background: active ? "var(--brand-500)" : done ? "var(--brand-50)" : "var(--surface)",
                color: active ? "#fff" : done ? "var(--brand-700)" : "var(--muted)",
                transition: "all var(--dur-2) var(--ease)",
              }}
            >
              {done ? <CheckMini /> : null}
              {STAGE_LABEL[stage]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RiskGauge({ score }: { score?: number | null }) {
  const value = score ?? null;
  const color = riskColor(value);
  const label = value === null ? "unscored" : value >= 66 ? "high" : value >= 33 ? "medium" : "low";
  const tone =
    value === null
      ? { bg: "var(--neutral-bg)", fg: "var(--neutral-fg)", border: "var(--neutral-border)" }
      : value >= 66
      ? { bg: "var(--danger-bg)", fg: "var(--danger-fg)", border: "var(--danger-border)" }
      : value >= 33
      ? { bg: "var(--warning-bg)", fg: "var(--warning-fg)", border: "var(--warning-border)" }
      : { bg: "var(--success-bg)", fg: "var(--success-fg)", border: "var(--success-border)" };
  return (
    <span
      style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}
      title={value === null ? "Risk not scored yet" : `AI risk score ${value}/100 (${label})`}
    >
      <span
        aria-hidden
        style={{
          width: 54,
          height: 6,
          borderRadius: 999,
          background: "var(--surface-3)",
          overflow: "hidden",
          display: "inline-block",
        }}
      >
        <span
          className="bar-grow"
          style={{
            display: "block",
            width: `${value ?? 0}%`,
            height: "100%",
            background: color,
            borderRadius: 999,
          }}
        />
      </span>
      <span
        className="badge"
        style={{ background: tone.bg, color: tone.fg, borderColor: tone.border }}
      >
        Risk: {value ?? "—"}
        <InfoHint text={HINTS.changeRisk} side="left" size={11} />
      </span>
    </span>
  );
}

/** "N/M Approved" vote meter for a change's CAB approvals (violet fill per the reference). */
function CabVoteMeter({ approvals }: { approvals: Approval[] }) {
  const approved = approvals.filter((a) => a.state === "approved").length;
  const total = approvals.length;
  if (!total) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span
        aria-hidden
        style={{
          width: 72,
          height: 6,
          borderRadius: 999,
          background: "var(--surface-3)",
          overflow: "hidden",
          display: "inline-block",
        }}
      >
        <span
          className="bar-grow"
          style={{
            display: "block",
            width: `${(approved / total) * 100}%`,
            height: "100%",
            background: "var(--violet-fg)",
            borderRadius: 999,
          }}
        />
      </span>
      <span
        style={{
          fontSize: "0.7rem",
          fontWeight: 700,
          color: "var(--muted)",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {approved}/{total} approved
      </span>
    </span>
  );
}

function CheckMini() {
  return (
    <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function GitBranchGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

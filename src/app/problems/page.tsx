"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { AIPanel } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useNarrow } from "@/components/useNarrow";

// =============================================================================
// Route /problems — ITIL Problem Management (agent+).
//
// Two-pane workspace: a filterable problem list (with clickable KPI tiles and
// AI-suggested clusters from recurring incidents) and a detail pane for root-
// cause analysis, workaround/known-error publishing to the KB, linked
// incidents, and raising a permanent-fix change. Stacks on narrow screens.
// =============================================================================

// ---- types -----------------------------------------------------------------
interface Problem {
  id: string;
  reference: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  impact?: string | null;
  urgency?: string | null;
  category: string;
  rootCause?: string | null;
  rcaMethod?: string | null;
  workaround?: string | null;
  knownError: boolean;
  publishedArticleId?: string | null;
  changeId?: string | null;
  assigneeName?: string | null;
  notes?: { id: string; author: string; body: string; at: string }[] | null;
  linkedIncidents?: { id: string; reference: string; subject: string; status: string; priority: string }[];
  openIncidentCount?: number;
}
interface Cluster { theme: string; ticketIds: string[] }
interface Metrics { total: number; open: number; investigating: number; knownErrors: number; resolved: number; incidentsLinked: number }
interface Incident { id: string; reference: string; subject: string; status: string; problemId?: string | null }

const STATUS_COLOR: Record<string, string> = {
  open: "var(--danger-solid)",
  investigating: "var(--info-solid)",
  known_error: "var(--warning-solid)",
  resolved: "var(--success-solid)",
  closed: "var(--muted-soft)",
};
const STATUSES = ["open", "investigating", "known_error", "resolved", "closed"];
const cap = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  ...STATUSES.map((s) => ({ id: s, label: cap(s) })),
  { id: "flag:known_error", label: "Known errors" },
];

export default function ProblemsPage() {
  const toast = useToast();
  const narrow = useNarrow(1000);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Problem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [rca, setRca] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshList = useCallback(async () => {
    const [m, list, cl, inc] = await Promise.all([
      apiGet<Metrics>("/problems?metrics=1"),
      apiGet<Problem[]>("/problems"),
      apiGet<Cluster[]>("/problems?suggest=1").catch(() => []),
      apiGet<Incident[]>("/tickets?type=incident").catch(() => []),
    ]);
    setMetrics(m);
    setProblems(list);
    setClusters(cl);
    setIncidents(inc);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setRca(null);
    setDetail(await apiGet<Problem>(`/problems/${id}`));
  }, []);

  useEffect(() => { refreshList(); }, [refreshList]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId, loadDetail]);

  async function refreshAll() {
    await refreshList();
    if (selectedId) await loadDetail(selectedId);
  }

  // ---- mutations -----------------------------------------------------------
  const failToast = (err: unknown) =>
    toast.error({ title: "Action failed", description: err instanceof Error ? err.message : String(err) });

  async function createProblem(input: Record<string, unknown>) {
    setBusy(true);
    try {
      const p = await apiSend<Problem>("/problems", "POST", input);
      setShowForm(false);
      await refreshList();
      setSelectedId(p.id);
      toast.success({ title: "Problem created" });
    } catch (err) { failToast(err); } finally { setBusy(false); }
  }
  async function createFromCluster(c: Cluster) {
    try {
      const p = await apiSend<Problem>("/problems", "POST", { cluster: c });
      await refreshAll();
      setSelectedId(p.id);
      toast.success({ title: "Problem created from cluster", description: `${c.ticketIds.length} incidents linked.` });
    } catch (err) { failToast(err); }
  }
  async function patch(id: string, body: Record<string, unknown>) {
    try {
      await apiSend(`/problems/${id}`, "PATCH", body);
      await refreshAll();
    } catch (err) { failToast(err); }
  }
  async function action(id: string, body: Record<string, unknown>) {
    return apiSend<Record<string, unknown>>(`/problems/${id}/actions`, "POST", body);
  }
  async function runAction(id: string, body: Record<string, unknown>) {
    try {
      await action(id, body);
      await refreshAll();
    } catch (err) { failToast(err); }
  }
  async function suggestRca(id: string) {
    setBusy(true);
    try {
      const r = await action(id, { action: "ai_root_cause" });
      setRca(String(r.rootCause ?? ""));
    } catch (err) { failToast(err); } finally { setBusy(false); }
  }

  const filtered = problems.filter((p) => {
    if (filter === "flag:known_error" && !p.knownError) return false;
    if (filter !== "all" && filter !== "flag:known_error" && p.status !== filter) return false;
    if (search && !`${p.reference} ${p.title}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Header + metrics */}
      <div
        className="anim-fade-up"
        style={{
          padding: "1.2rem 1.5rem 0.9rem",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 className="page-title" style={{ fontSize: "1.4rem", margin: 0 }}>Problem Management</h1>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 2 }}>Root-cause analysis, known errors, and permanent fixes.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>{showForm ? "Close" : "+ New problem"}</button>
        </div>
        {metrics ? (
          <div className="stagger" style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <Stat label="Total" value={metrics.total} active={filter === "all"} onClick={() => setFilter("all")} />
            <Stat label="Open" value={metrics.open} color="var(--danger-solid)" active={filter === "open"} onClick={() => setFilter(filter === "open" ? "all" : "open")} />
            <Stat label="Investigating" value={metrics.investigating} color="var(--info-solid)" active={filter === "investigating"} onClick={() => setFilter(filter === "investigating" ? "all" : "investigating")} />
            <Stat label="Known errors" value={metrics.knownErrors} color="var(--warning-solid)" active={filter === "flag:known_error"} onClick={() => setFilter(filter === "flag:known_error" ? "all" : "flag:known_error")} />
            <Stat label="Resolved" value={metrics.resolved} color="var(--success-solid)" active={filter === "resolved"} onClick={() => setFilter(filter === "resolved" ? "all" : "resolved")} />
            <Stat label="Incidents linked" value={metrics.incidentsLinked} />
          </div>
        ) : null}
      </div>

      {showForm ? <NewProblemForm busy={busy} onCreate={createProblem} /> : null}

      {clusters.length > 0 ? (
        <div className="anim-fade-up" style={{ margin: "0.9rem 1.5rem 0" }}>
          <AIPanel
            title={`AI incident cluster analysis — ${clusters.length} recurring ${clusters.length === 1 ? "pattern" : "patterns"}`}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {clusters.map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "0.5rem 0.7rem",
                    borderRadius: "var(--r-md)",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      background: "var(--violet-bg)",
                      color: "var(--ai-fg)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <SparkleGlyph />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: "0.85rem", color: "var(--text)" }}>
                    <strong>{c.theme}</strong>{" "}
                    <span className="muted" style={{ whiteSpace: "nowrap" }}>
                      · {c.ticketIds.length} incidents
                    </span>
                  </span>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: "0.74rem", padding: "0.3rem 0.7rem", flexShrink: 0 }}
                    onClick={() => createFromCluster(c)}
                  >
                    Create problem
                  </button>
                </div>
              ))}
            </div>
          </AIPanel>
        </div>
      ) : null}

      {/* Two-pane workspace (stacks on narrow screens: list OR detail) */}
      <div
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
          padding: narrow ? "0.9rem 1rem 1.25rem" : "0.9rem 1.5rem 1.5rem",
          gap: 16,
        }}
      >
        {/* List */}
        {narrow && detail ? null : (
        <div
          style={{
            width: narrow ? "100%" : 360,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`pill-filter${filter === f.id ? " active" : ""}`}
                style={{ fontSize: "0.72rem", padding: "0.25rem 0.6rem" }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input className="input" placeholder="Search problems…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
          <div
            style={{
              flex: 1,
              overflow: "auto",
              display: "grid",
              gridAutoRows: "max-content",
              gap: 8,
              alignContent: "start",
              paddingBottom: 4,
            }}
          >
            {filtered.length === 0 ? <p className="muted" style={{ fontSize: "0.85rem" }}>No problems match.</p> : null}
            {filtered.map((p) => {
              const active = selectedId === p.id;
              // Per-side border values: mixing the `border` shorthand with a
              // `borderLeft` override makes React warn on rerender.
              const edge = `1px solid ${active ? "var(--brand-300)" : "var(--border)"}`;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  aria-pressed={active}
                  style={{
                    display: "block",
                    width: "100%",
                    minHeight: 74,
                    textAlign: "left",
                    padding: "0.7rem 0.8rem 0.75rem",
                    borderRadius: "var(--r-md)",
                    cursor: "pointer",
                    borderTop: edge,
                    borderRight: edge,
                    borderBottom: edge,
                    borderLeft: `3px solid ${STATUS_COLOR[p.status] ?? "var(--border-strong)"}`,
                    background: active ? "var(--brand-50)" : "var(--surface)",
                    boxShadow: active ? "var(--shadow-sm)" : "none",
                    color: "var(--text)",
                    font: "inherit",
                    transition:
                      "border-color var(--dur-2) var(--ease), background var(--dur-2) var(--ease), box-shadow var(--dur-2) var(--ease)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                    <span className="mono" style={{ fontSize: "0.68rem", color: "var(--muted)" }}>{p.reference}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.7rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                      <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: STATUS_COLOR[p.status], flexShrink: 0 }} />
                      {cap(p.status)}
                    </span>
                    {p.knownError ? (
                      <span className="badge" style={{ background: "var(--warning-bg)", color: "var(--warning-fg)", borderColor: "var(--warning-border)", fontSize: "0.6rem" }}>
                        KE
                      </span>
                    ) : null}
                    {(p.openIncidentCount ?? 0) > 0 ? (
                      <span className="badge" style={{ background: "var(--info-bg)", color: "var(--info-fg)", borderColor: "var(--info-border)", fontSize: "0.6rem" }}>
                        {p.openIncidentCount} open inc.
                      </span>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: "0.86rem",
                      lineHeight: 1.35,
                      color: "var(--text)",
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {p.title}
                  </div>
                  <div className="muted" style={{ fontSize: "0.72rem", marginTop: 3 }}>
                    {cap(p.priority)} priority · {p.category}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        )}

        {/* Detail */}
        {narrow && !detail ? null : (
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {narrow && detail ? (
            <button
              className="chip-link"
              style={{ border: "none", background: "transparent", cursor: "pointer", marginBottom: 10 }}
              onClick={() => { setSelectedId(null); setDetail(null); }}
            >
              ← Back to problem list
            </button>
          ) : null}
          {!detail ? (
            <div className="panel" style={{ padding: "2rem", textAlign: "center" }}>
              <p className="muted">Select a problem to view its root-cause analysis, known error and linked incidents.</p>
            </div>
          ) : (
            <ProblemDetail
              key={detail.id}
              p={detail}
              incidents={incidents}
              rca={rca}
              busy={busy}
              onPatch={(b) => patch(detail.id, b)}
              onAction={(b) => runAction(detail.id, b)}
              onSuggestRca={() => suggestRca(detail.id)}
              onApplyRca={async (text) => { await patch(detail.id, { rootCause: text }); setRca(null); }}
              onDismissRca={() => setRca(null)}
            />
          )}
        </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
  active,
  onClick,
}: {
  label: string;
  value: number;
  color?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      aria-pressed={active}
      className={clickable ? "hover-lift" : undefined}
      style={{
        background: active ? "var(--brand-50)" : "var(--surface)",
        border: `1px solid ${active ? "var(--brand-500)" : "var(--border)"}`,
        borderRadius: 10,
        padding: "0.45rem 0.75rem",
        minWidth: 92,
        textAlign: "left",
        cursor: clickable ? "pointer" : "default",
        boxShadow: active ? "var(--shadow-sm)" : "none",
        transition:
          "border-color var(--dur-2) var(--ease), background var(--dur-2) var(--ease), box-shadow var(--dur-2) var(--ease), transform var(--dur-2) var(--ease-out)",
      }}
    >
      <div style={{ fontSize: "1.1rem", fontWeight: 800, color: color ?? "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div className="muted" style={{ fontSize: "0.66rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
    </button>
  );
}

function SparkleGlyph() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" />
    </svg>
  );
}

function NewProblemForm({ busy, onCreate }: { busy: boolean; onCreate: (b: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [impact, setImpact] = useState("medium");
  const [urgency, setUrgency] = useState("medium");
  const [category, setCategory] = useState("IT");
  return (
    <div className="panel" style={{ margin: "0.9rem 1.5rem 0", padding: "1.1rem 1.2rem" }}>
      <input className="input" placeholder="Problem title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginBottom: 8 }} />
      <textarea className="textarea" rows={2} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} style={{ marginBottom: 8 }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <Labeled label="Impact"><select className="select" value={impact} onChange={(e) => setImpact(e.target.value)}><option>low</option><option>medium</option><option>high</option></select></Labeled>
        <Labeled label="Urgency"><select className="select" value={urgency} onChange={(e) => setUrgency(e.target.value)}><option>low</option><option>medium</option><option>high</option></select></Labeled>
        <Labeled label="Category"><select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>{["IT","HR","Access","Software","Hardware","Network","Billing","Other"].map((c) => <option key={c}>{c}</option>)}</select></Labeled>
      </div>
      <button className="btn btn-primary" disabled={busy || !title.trim() || !description.trim()} onClick={() => onCreate({ title, description, impact, urgency, category })}>
        {busy ? "Creating…" : "Create problem"}
      </button>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return <div><div className="label" style={{ fontSize: "0.62rem", marginBottom: 2 }}>{label}</div>{children}</div>;
}

function ProblemDetail({
  p, incidents, rca, busy, onPatch, onAction, onSuggestRca, onApplyRca, onDismissRca,
}: {
  p: Problem;
  incidents: Incident[];
  rca: string | null;
  busy: boolean;
  onPatch: (b: Record<string, unknown>) => void;
  onAction: (b: Record<string, unknown>) => Promise<void>;
  onSuggestRca: () => void;
  onApplyRca: (text: string) => void;
  onDismissRca: () => void;
}) {
  const [note, setNote] = useState("");
  const [linkPick, setLinkPick] = useState("");
  const linkable = incidents.filter((i) => i.problemId !== p.id);

  return (
    <div className="panel" style={{ padding: "1.3rem 1.4rem" }}>
      {/* head */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <span className="mono" style={{ fontSize: "0.74rem", color: "var(--muted)" }}>{p.reference}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.78rem", fontWeight: 700 }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: STATUS_COLOR[p.status] }} />{cap(p.status)}
        </span>
        <span className="badge">{cap(p.priority)}</span>
        <span className="badge">{p.category}</span>
        {p.assigneeName ? <span className="muted" style={{ fontSize: "0.76rem", marginLeft: "auto" }}>Owner: {p.assigneeName}</span> : null}
      </div>
      <h2 style={{ fontSize: "1.15rem", fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.015em" }}>{p.title}</h2>
      <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", marginTop: 0 }}>{p.description}</p>

      {p.knownError ? (
        <div
          className="anim-scale-in"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0.7rem 0.85rem",
            borderRadius: 10,
            background: "var(--warning-bg)",
            border: "1px solid var(--warning-border)",
            color: "var(--warning-fg)",
            margin: "0.35rem 0 0.6rem",
          }}
        >
          <WarnGlyph />
          <div>
            <div style={{ fontSize: "0.82rem", fontWeight: 700 }}>Known error</div>
            <div style={{ fontSize: "0.74rem", opacity: 0.85 }}>
              {p.workaround ? "Workaround documented — see below." : "No workaround documented yet."}
            </div>
          </div>
        </div>
      ) : null}

      {/* status transitions */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0.6rem 0 1rem" }}>
        {STATUSES.filter((s) => s !== p.status).map((s) => (
          <button key={s} className="btn btn-ghost" style={{ fontSize: "0.72rem", padding: "0.3rem 0.6rem" }} onClick={() => onPatch({ status: s })}>→ {cap(s)}</button>
        ))}
        <button className="btn btn-ghost" style={{ fontSize: "0.72rem", padding: "0.3rem 0.6rem" }} onClick={() => onPatch({ knownError: !p.knownError })}>
          {p.knownError ? "Unmark known error" : "Mark known error"}
        </button>
      </div>

      {/* RCA */}
      <Section title="Root cause analysis" icon={<RcaGlyph />}>
        <p style={{ fontSize: "0.85rem", margin: "0 0 8px", color: p.rootCause ? "var(--text)" : "var(--muted)" }}>
          {p.rootCause || "No root cause recorded yet."}
        </p>
        {rca ? (
          <div className="anim-scale-in" style={{ marginBottom: 8 }}>
            <AIPanel title="AI suggested root cause">
              <p style={{ fontSize: "0.84rem", margin: "0 0 8px", lineHeight: 1.55, color: "var(--text)" }}>{rca}</p>
              <button className="btn btn-primary" style={{ fontSize: "0.72rem", padding: "0.25rem 0.6rem", marginRight: 6 }} onClick={() => onApplyRca(rca)}>Apply</button>
              <button className="btn btn-ghost" style={{ fontSize: "0.72rem", padding: "0.25rem 0.6rem" }} onClick={onDismissRca}>Dismiss</button>
            </AIPanel>
          </div>
        ) : null}
        <button
          className="btn btn-ghost"
          style={{
            fontSize: "0.76rem",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            borderColor: "var(--brand-300)",
            color: "var(--brand-700)",
          }}
          disabled={busy}
          onClick={onSuggestRca}
        >
          <SparkleGlyph />
          {busy ? "Analyzing linked incidents…" : "Suggest root cause with AI"}
        </button>
      </Section>

      {/* Workaround / KEDB */}
      <Section title="Workaround (known error)" icon={<WrenchGlyph />}>
        <textarea className="textarea" rows={2} defaultValue={p.workaround ?? ""} placeholder="Document the workaround…"
          onBlur={(e) => { if (e.target.value !== (p.workaround ?? "")) onPatch({ workaround: e.target.value }); }} style={{ marginBottom: 6 }} />
        {p.publishedArticleId ? (
          <span className="badge" style={{ background: "var(--success-bg)", color: "var(--success-fg)" }}>Published to knowledge base ✓</span>
        ) : (
          <button className="btn btn-ghost" style={{ fontSize: "0.74rem" }} disabled={!p.workaround} onClick={() => onAction({ action: "publish_workaround" })}>
            Publish workaround to KB
          </button>
        )}
      </Section>

      {/* Linked incidents */}
      <Section
        title={`Linked incidents (${p.linkedIncidents?.length ?? 0}${p.openIncidentCount ? ` · ${p.openIncidentCount} open` : ""})`}
        icon={<LinkGlyph />}
      >
        {p.linkedIncidents && p.linkedIncidents.length > 0 ? (
          <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
            {p.linkedIncidents.map((i) => (
              <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem" }}>
                <span className="mono" style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{i.reference}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.subject}</span>
                <span className="badge" style={{ fontSize: "0.62rem" }}>{cap(i.status)}</span>
                <button className="btn btn-ghost" style={{ fontSize: "0.68rem", padding: "0.2rem 0.45rem" }} onClick={() => onAction({ action: "unlink_incident", ticketId: i.id })}>Unlink</button>
              </div>
            ))}
          </div>
        ) : <p className="muted" style={{ fontSize: "0.82rem", margin: "0 0 8px" }}>No incidents linked yet.</p>}
        <div style={{ display: "flex", gap: 6 }}>
          <select className="select" value={linkPick} onChange={(e) => setLinkPick(e.target.value)}>
            <option value="">Link an incident…</option>
            {linkable.map((i) => <option key={i.id} value={i.id}>{i.reference} — {i.subject.slice(0, 40)}</option>)}
          </select>
          <button className="btn btn-ghost" disabled={!linkPick} onClick={async () => { await onAction({ action: "link_incident", ticketId: linkPick }); setLinkPick(""); }}>Link</button>
        </div>
      </Section>

      {/* Permanent fix */}
      <Section title="Permanent fix" icon={<HammerGlyph />}>
        {p.changeId ? (
          <span className="badge" style={{ background: "var(--info-bg)", color: "var(--info-fg)" }}>Change raised ✓</span>
        ) : (
          <button className="btn btn-ghost" style={{ fontSize: "0.74rem" }} onClick={() => onAction({ action: "raise_change" })}>Raise a change for the permanent fix →</button>
        )}
      </Section>

      {/* Notes / timeline */}
      <Section title="Notes" icon={<NoteGlyph />}>
        {p.notes && p.notes.length > 0 ? (
          <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
            {p.notes.map((n) => (
              <div key={n.id} style={{ fontSize: "0.82rem", background: "var(--surface-2)", borderRadius: 8, padding: "0.5rem 0.6rem" }}>
                <div style={{ fontWeight: 700, fontSize: "0.74rem" }}>{n.author} <span className="muted" style={{ fontWeight: 400 }}>· {new Date(n.at).toLocaleString()}</span></div>
                {n.body}
              </div>
            ))}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 6 }}>
          <input className="input" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-ghost" disabled={!note.trim()} onClick={async () => { await onAction({ action: "add_note", body: note }); setNote(""); }}>Add</button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        {icon ? <span style={{ color: "var(--muted)", display: "inline-flex" }}>{icon}</span> : null}
        <span className="label" style={{ margin: 0 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

/* section glyphs */
const g = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function RcaGlyph() {
  return (
    <svg {...g}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M11 8v3l2 2" />
    </svg>
  );
}
function WrenchGlyph() {
  return (
    <svg {...g}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}
function LinkGlyph() {
  return (
    <svg {...g}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function HammerGlyph() {
  return (
    <svg {...g}>
      <path d="m15 12-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9" />
      <path d="M17.64 15 22 10.64M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91" />
    </svg>
  );
}
function NoteGlyph() {
  return (
    <svg {...g}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 15h6M9 11h2" />
    </svg>
  );
}
function WarnGlyph() {
  return (
    <svg {...g} width={18} height={18}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86l-8.14 14a2 2 0 001.71 3h16.28a2 2 0 001.71-3l-8.14-14a2 2 0 00-3.42 0z" />
    </svg>
  );
}

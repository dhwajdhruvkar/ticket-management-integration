"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import { useToast } from "@/components/Toast";

// =============================================================================
// AssetsPage — hardware inventory (ITAM) + CMDB dependency graph.
//
// CI and asset rows carry type-specific icon tiles and status tones; the
// impact analysis panel lists dependents as chips and affected tickets as
// linked rows with status badges. All mutations hit the real APIs.
// =============================================================================

interface Asset {
  id: string;
  tag: string;
  name: string;
  type: string;
  status: string;
  owner?: string | null;
}
interface CI {
  id: string;
  name: string;
  type: string;
  status: string;
}
interface Impact {
  ci: CI;
  dependents: CI[];
  affectedTickets: { id: string; reference: string; subject: string; status: string }[];
}

const CI_TYPES = ["application", "server", "database", "network", "service", "endpoint", "other"];
const ASSET_TYPES = ["laptop", "desktop", "monitor", "server", "phone", "printer", "other"];

export default function AssetsPage() {
  const toast = useToast();
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [cis, setCIs] = useState<CI[] | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [assetForm, setAssetForm] = useState({ tag: "", name: "", type: "laptop" });
  const [ciForm, setCIForm] = useState({ name: "", type: "service" });
  const [link, setLink] = useState({ sourceId: "", targetId: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([apiGet<Asset[]>("/assets"), apiGet<CI[]>("/cis")]);
      setAssets(a);
      setCIs(c);
    } catch {
      setAssets([]);
      setCIs([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      await refresh();
      toast.success({ title: ok });
    } catch (err) {
      toast.error({ title: "Action failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  function addAsset() {
    if (!assetForm.tag.trim() || !assetForm.name.trim()) return;
    void run(
      "asset",
      async () => {
        await apiSend("/assets", "POST", assetForm);
        setAssetForm({ tag: "", name: "", type: "laptop" });
      },
      "Asset added"
    );
  }
  function addCI() {
    if (!ciForm.name.trim()) return;
    void run(
      "ci",
      async () => {
        await apiSend("/cis", "POST", ciForm);
        setCIForm({ name: "", type: "service" });
      },
      "Configuration item added"
    );
  }
  function linkCIs() {
    if (!link.sourceId || !link.targetId || link.sourceId === link.targetId) return;
    void run(
      "link",
      async () => {
        await apiSend("/cis", "POST", { link: { sourceId: link.sourceId, targetId: link.targetId } });
        setLink({ sourceId: "", targetId: "" });
      },
      "Dependency linked"
    );
  }
  async function showImpact(id: string) {
    try {
      setImpact(await apiGet<Impact>(`/cis/${id}/impact`));
    } catch (err) {
      toast.error({ title: "Could not load impact", description: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="page-pad anim-fade-up">
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header style={{ marginBottom: 16, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 className="page-title" style={{ margin: 0 }}>Assets & CMDB</h1>
            <p className="muted" style={{ fontSize: "0.88rem", marginTop: 3 }}>
              Hardware inventory and the configuration-item dependency graph.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <MiniStat label="Assets" value={assets?.length ?? 0} />
            <MiniStat label="CIs" value={cis?.length ?? 0} />
          </div>
        </header>

        <div className="grid-halves stagger" style={{ gap: 16 }}>
          {/* Assets ------------------------------------------------------- */}
          <section className="panel" style={{ padding: "1.1rem 1.2rem" }}>
            <PanelHead icon={<LaptopGlyph />} title="Assets (ITAM)" />
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              <input className="input" placeholder="Tag" value={assetForm.tag} onChange={(e) => setAssetForm({ ...assetForm, tag: e.target.value })} style={{ flex: "1 1 80px" }} />
              <input className="input" placeholder="Name" value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} style={{ flex: "1 1 120px" }} />
              <select className="select" value={assetForm.type} onChange={(e) => setAssetForm({ ...assetForm, type: e.target.value })} style={{ flex: "0 0 110px" }}>
                {ASSET_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={addAsset} disabled={busy === "asset" || !assetForm.tag.trim() || !assetForm.name.trim()}>
                {busy === "asset" ? "Adding…" : "Add"}
              </button>
            </div>
            {assets === null ? (
              <p className="muted">Loading…</p>
            ) : assets.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.84rem" }}>No assets registered yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {assets.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: "0.84rem",
                      padding: "0.5rem 0.6rem",
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      background: "var(--surface-2)",
                    }}
                  >
                    <TypeTile type={a.type} kind="asset" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                      <div className="muted mono" style={{ fontSize: "0.68rem", marginTop: 1 }}>{a.tag}</div>
                    </div>
                    <span className="badge hide-sm" style={{ textTransform: "capitalize", background: "var(--surface-3)", color: "var(--text-secondary)", borderColor: "var(--border)" }}>{a.type}</span>
                    <StatusPill status={a.status} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* CIs ----------------------------------------------------------- */}
          <section className="panel" style={{ padding: "1.1rem 1.2rem" }}>
            <PanelHead icon={<GraphGlyph />} title="Configuration items (CMDB)" />
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              <input className="input" placeholder="CI name (e.g. Payroll App)" value={ciForm.name} onChange={(e) => setCIForm({ ...ciForm, name: e.target.value })} style={{ flex: "1 1 140px" }} />
              <select className="select" value={ciForm.type} onChange={(e) => setCIForm({ ...ciForm, type: e.target.value })} style={{ flex: "0 0 120px" }}>
                {CI_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={addCI} disabled={busy === "ci" || !ciForm.name.trim()}>
                {busy === "ci" ? "Adding…" : "Add"}
              </button>
            </div>
            {cis === null ? (
              <p className="muted">Loading…</p>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {cis.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: "0.84rem",
                      padding: "0.5rem 0.6rem",
                      borderRadius: 10,
                      border: `1px solid ${impact?.ci.id === c.id ? "var(--brand-300)" : "var(--border)"}`,
                      background: impact?.ci.id === c.id ? "var(--brand-50)" : "var(--surface-2)",
                      transition: "border-color var(--dur-2) var(--ease), background var(--dur-2) var(--ease)",
                    }}
                  >
                    <TypeTile type={c.type} kind="ci" />
                    <span style={{ flex: 1, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.name}
                    </span>
                    <span className="badge hide-sm" style={{ textTransform: "capitalize", background: "var(--surface-3)", color: "var(--text-secondary)", borderColor: "var(--border)" }}>{c.type}</span>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: "0.72rem", padding: "0.25rem 0.55rem" }}
                      onClick={() => void showImpact(c.id)}
                    >
                      <ImpactGlyph /> <span style={{ marginLeft: 4 }}>Impact</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Dependency graph editing */}
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                <span style={{ color: "var(--muted)", display: "inline-flex" }}><LinkGlyph /></span>
                <span className="label" style={{ margin: 0 }}>Link a dependency (source depends on target)</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <select className="select" value={link.sourceId} onChange={(e) => setLink({ ...link, sourceId: e.target.value })} style={{ flex: "1 1 140px" }}>
                  <option value="">Source CI…</option>
                  {(cis ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <span className="muted" style={{ alignSelf: "center", fontSize: "0.78rem" }}>depends on</span>
                <select className="select" value={link.targetId} onChange={(e) => setLink({ ...link, targetId: e.target.value })} style={{ flex: "1 1 140px" }}>
                  <option value="">Target CI…</option>
                  {(cis ?? []).filter((c) => c.id !== link.sourceId).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button className="btn btn-ghost" onClick={linkCIs} disabled={busy === "link" || !link.sourceId || !link.targetId}>
                  {busy === "link" ? "Linking…" : "Link"}
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Impact analysis ------------------------------------------------- */}
        {impact ? (
          <div
            className="panel anim-scale-in"
            style={{ padding: "1.1rem 1.25rem", marginTop: 16 }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  aria-hidden
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: "var(--brand-100)",
                    color: "var(--brand-700)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ImpactGlyph size={16} />
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Impact analysis — {impact.ci.name}</div>
                  <div className="muted" style={{ fontSize: "0.74rem" }}>
                    What breaks downstream if this CI fails
                  </div>
                </div>
              </div>
              <button className="btn btn-ghost" style={{ fontSize: "0.74rem", padding: "0.3rem 0.6rem" }} onClick={() => setImpact(null)}>
                Close
              </button>
            </div>

            <div className="grid-halves" style={{ gap: 14 }}>
              <div>
                <div className="label" style={{ marginBottom: 8 }}>
                  Dependent CIs ({impact.dependents.length})
                </div>
                {impact.dependents.length === 0 ? (
                  <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>Nothing depends on this CI.</p>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {impact.dependents.map((d) => (
                      <span
                        key={d.id}
                        className="badge"
                        style={{
                          background: "var(--surface)",
                          color: "var(--text-secondary)",
                          borderColor: "var(--border-strong)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "0.3rem 0.6rem",
                        }}
                      >
                        <TypeGlyphOnly type={d.type} />
                        {d.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="label" style={{ marginBottom: 8 }}>
                  Related tickets ({impact.affectedTickets.length})
                </div>
                {impact.affectedTickets.length === 0 ? (
                  <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>No tickets reference this CI.</p>
                ) : (
                  <div style={{ display: "grid", gap: 5 }}>
                    {impact.affectedTickets.map((t) => (
                      <Link
                        key={t.id}
                        href={`/tickets/${t.id}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "0.4rem 0.55rem",
                          borderRadius: 8,
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          textDecoration: "none",
                          color: "inherit",
                          fontSize: "0.8rem",
                        }}
                      >
                        <span className="mono" style={{ fontSize: "0.68rem", color: "var(--muted)", flexShrink: 0 }}>
                          {t.reference}
                        </span>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                          {t.subject}
                        </span>
                        <span className="badge" style={{ fontSize: "0.62rem", textTransform: "capitalize", flexShrink: 0 }}>
                          {t.status.replace(/_/g, " ")}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* =========================================================================
   Pieces
   ========================================================================= */

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "0.45rem 0.85rem",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "1.1rem", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div className="muted" style={{ fontSize: "0.64rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}

function PanelHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
      <span style={{ color: "var(--muted)", display: "inline-flex" }}>{icon}</span>
      <span className="label" style={{ margin: 0 }}>{title}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const active = status === "active" || status === "in_use" || status === "operational";
  const retired = status === "retired" || status === "disposed";
  return (
    <span
      className="badge"
      style={{
        textTransform: "capitalize",
        background: active ? "var(--success-bg)" : retired ? "var(--surface-3)" : "var(--warning-bg)",
        color: active ? "var(--success-fg)" : retired ? "var(--muted)" : "var(--warning-fg)",
        borderColor: active ? "var(--success-border)" : retired ? "var(--border)" : "var(--warning-border)",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

const TYPE_TONE: Record<string, { bg: string; fg: string }> = {
  application: { bg: "var(--info-bg)", fg: "var(--info-fg)" },
  service: { bg: "var(--info-bg)", fg: "var(--info-fg)" },
  server: { bg: "var(--brand-50)", fg: "var(--brand-700)" },
  database: { bg: "var(--violet-bg)", fg: "var(--violet-fg)" },
  network: { bg: "var(--info-bg)", fg: "var(--info-fg)" },
  endpoint: { bg: "var(--warning-bg)", fg: "var(--warning-fg)" },
  laptop: { bg: "var(--brand-50)", fg: "var(--brand-700)" },
  desktop: { bg: "var(--brand-50)", fg: "var(--brand-700)" },
  monitor: { bg: "var(--info-bg)", fg: "var(--info-fg)" },
  phone: { bg: "var(--pink-bg)", fg: "var(--pink-fg)" },
  printer: { bg: "var(--warning-bg)", fg: "var(--warning-fg)" },
  other: { bg: "var(--surface-3)", fg: "var(--muted)" },
};

function TypeTile({ type, kind }: { type: string; kind: "asset" | "ci" }) {
  const tone = TYPE_TONE[type] ?? TYPE_TONE.other;
  return (
    <span
      aria-hidden
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        background: tone.bg,
        color: tone.fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <TypeGlyphOnly type={type} size={15} kind={kind} />
    </span>
  );
}

function TypeGlyphOnly({ type, size = 12, kind }: { type: string; size?: number; kind?: "asset" | "ci" }) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (type) {
    case "server":
      return (
        <svg {...p}>
          <rect x="2" y="2" width="20" height="8" rx="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" />
          <path d="M6 6h.01M6 18h.01" />
        </svg>
      );
    case "database":
      return (
        <svg {...p}>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      );
    case "network":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20" />
        </svg>
      );
    case "application":
    case "service":
      return (
        <svg {...p}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 21V9" />
        </svg>
      );
    case "endpoint":
    case "laptop":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M2 20h20" />
        </svg>
      );
    case "desktop":
      return (
        <svg {...p}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    case "monitor":
      return (
        <svg {...p}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    case "phone":
      return (
        <svg {...p}>
          <rect x="7" y="2" width="10" height="20" rx="2" />
          <path d="M12 18h.01" />
        </svg>
      );
    case "printer":
      return (
        <svg {...p}>
          <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
      );
    default:
      return kind === "asset" ? (
        <svg {...p}>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      ) : (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      );
  }
}

/* glyphs */
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

function LaptopGlyph() {
  return (
    <svg {...g}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </svg>
  );
}
function GraphGlyph() {
  return (
    <svg {...g}>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5" cy="19" r="2.5" />
      <circle cx="19" cy="19" r="2.5" />
      <path d="M12 7.5L6 16.7M12 7.5l6 9.2M7.5 19h9" />
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
function ImpactGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </svg>
  );
}

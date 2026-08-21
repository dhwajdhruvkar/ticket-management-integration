"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiGetAll } from "@/lib/api";
import type { AuditRow } from "@/server/domain/models";
import { auditActionLabel, LabelWithHint, timeAgo } from "./ui";
import { HINTS } from "@/lib/hints";
import { usePersona } from "./Persona";
import { useToast } from "./Toast";
import { AuditSkeleton } from "./Skeleton";
import { EmptyState } from "./primitives";
import { ShieldAlert } from "lucide-react";

// =============================================================================
// AuditViewer — tamper-evident audit chain.
//
// Stats strip + verification banner, client-side filters (action / free text),
// and a hash-chain visual: each record hangs off a vertical rail with a link
// glyph tying it to its predecessor. Rows expand to show hashes + payload,
// with one-click hash copy.
// =============================================================================

interface AuditVerification {
  valid: boolean;
  length: number;
  brokenAt: number | null;
  reason: string | null;
}

export default function AuditViewer() {
  const router = useRouter();
  const { persona, ready } = usePersona();
  const [records, setRecords] = useState<AuditRow[] | null>(null);
  const [check, setCheck] = useState<AuditVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [actionFilter, setActionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const toast = useToast();

  // Audit is agent-only; requesters go back to their requests.
  useEffect(() => {
    if (ready && persona.role === "requester") router.replace("/tickets");
  }, [ready, persona.role, router]);

  const verify = useCallback(
    async (announce: boolean) => {
      setVerifying(true);
      setError(null);
      try {
        const [recs, result] = await Promise.all([
          apiGetAll<AuditRow>("/audit"),
          apiGet<AuditVerification>("/audit?verify=1"),
        ]);
        setRecords([...recs].sort((a, b) => b.index - a.index));
        setCheck(result);
        if (announce) {
          if (result.valid) {
            toast.success({
              title: "Chain verified",
              description: `All ${result.length} records intact — no tampering detected.`,
            });
          } else {
            toast.error({
              title: "Chain integrity FAILED",
              description: result.reason ?? `Broken at record #${result.brokenAt}.`,
            });
          }
        }
      } catch (err) {
        // A failed request is not a verdict. Reporting "chain verified" here
        // would be the single most misleading thing this screen could say.
        setError(err instanceof Error ? err.message : String(err));
        setRecords(null);
        setCheck(null);
        if (announce) {
          toast.error({
            title: "Could not verify the chain",
            description: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        setVerifying(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    verify(false);
  }, [verify]);

  const actions = useMemo(() => {
    const set = new Set<string>();
    for (const r of records ?? []) set.add(r.action);
    return [...set].sort();
  }, [records]);

  const filtered = useMemo(() => {
    let list = records ?? [];
    if (actionFilter !== "all") list = list.filter((r) => r.action === actionFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.actor.toLowerCase().includes(q) ||
          (r.ticketId ?? "").toLowerCase().includes(q) ||
          r.action.toLowerCase().includes(q) ||
          r.hash.toLowerCase().includes(q)
      );
    }
    return list;
  }, [records, actionFilter, search]);

  async function copyHash(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash((h) => (h === hash ? null : h)), 1500);
    } catch {
      toast.error({ title: "Could not copy", description: "Clipboard access denied." });
    }
  }

  if (error) {
    return (
      <div className="page-pad">
        <div style={{ maxWidth: 560, margin: "8vh auto 0" }}>
          <EmptyState
            icon={ShieldAlert}
            title="Could not verify the audit chain"
            description={
              <>
                {error}
                <br />
                Integrity is unknown until this check succeeds — treat the log as unverified, not as
                intact.
              </>
            }
            action={
              <button className="btn btn-primary" onClick={() => verify(true)} disabled={verifying}>
                {verifying ? "Verifying…" : "Retry verification"}
              </button>
            }
          />
        </div>
      </div>
    );
  }

  if (records === null || check === null)
    return (
      <div className="page-pad">
        <AuditSkeleton rows={6} />
      </div>
    );

  const lastEvent = records[0];

  return (
    <div className="page-pad anim-fade-up">
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        {/* Header ---------------------------------------------------------- */}
        <header
          className="flex items-center justify-between"
          style={{ marginBottom: 16, gap: 12, flexWrap: "wrap" }}
        >
          <div>
            <h1 className="page-title" style={{ margin: 0 }}>
              Audit Chain Viewer
            </h1>
            <p className="muted" style={{ fontSize: "0.88rem", marginTop: 3 }}>
              Tamper-evident, hash-linked record of every action in the system.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => verify(true)} disabled={verifying} style={{ height: 40 }}>
            <ShieldIcon />
            <span style={{ marginLeft: 6 }}>{verifying ? "Verifying…" : "Verify integrity"}</span>
          </button>
        </header>

        {/* Stats strip ------------------------------------------------------ */}
        <div className="grid-kpis stagger" style={{ gap: 12, marginBottom: 14 }}>
          <StatTile
            icon={<LayersIcon />}
            tone={{ bg: "var(--brand-50)", fg: "var(--brand-700)" }}
            value={String(check.length)}
            label="Records in chain"
            info={HINTS.auditRecords}
          />
          <StatTile
            icon={check.valid ? <ShieldCheckIcon /> : <ShieldOffIcon />}
            tone={
              check.valid
                ? { bg: "var(--success-bg)", fg: "var(--success-fg)" }
                : { bg: "var(--danger-bg)", fg: "var(--danger-fg)" }
            }
            value={check.valid ? "Intact" : "Broken"}
            label={check.valid ? "No tampering detected" : check.reason ?? `Broken at #${check.brokenAt}`}
            info={HINTS.auditChain}
          />
          <StatTile
            icon={<ClockIcon />}
            tone={{ bg: "var(--info-bg)", fg: "var(--info-fg)" }}
            value={lastEvent ? timeAgo(lastEvent.timestamp) : "—"}
            label="Last recorded event"
          />
        </div>

        {/* Verification banner --------------------------------------------- */}
        <div
          className="anim-fade-up"
          style={{
            padding: "0.9rem 1.1rem",
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: check.valid ? "var(--success-bg)" : "var(--danger-bg)",
            border: `1px solid ${check.valid ? "var(--success-border)" : "var(--danger-border)"}`,
            borderRadius: 14,
          }}
        >
          <div
            aria-hidden
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: check.valid ? "var(--success-solid)" : "var(--danger-solid)",
              color: "#ffffff",
              flexShrink: 0,
            }}
          >
            {check.valid ? <ShieldCheckIcon /> : <ShieldOffIcon />}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.9rem", color: check.valid ? "var(--success-fg)" : "var(--danger-fg)" }}>
              {check.valid ? "Chain verified — every hash links to its predecessor" : "Chain integrity FAILED"}
            </div>
            <div style={{ fontSize: "0.78rem", marginTop: 2, color: check.valid ? "var(--success-fg)" : "var(--danger-fg)", opacity: 0.85 }}>
              {check.length} records · SHA-256 hash-linked ·{" "}
              {check.valid ? "safe to export for compliance" : check.reason ?? `broken at record #${check.brokenAt}`}
            </div>
          </div>
        </div>

        {/* Filter toolbar --------------------------------------------------- */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--muted)",
                display: "inline-flex",
                pointerEvents: "none",
              }}
            >
              <SearchIcon />
            </span>
            <input
              className="input"
              placeholder="Filter by actor, ticket, action, or hash…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 36, height: 40 }}
            />
          </div>
          <select
            className="select"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={{ height: 40, minWidth: 200 }}
            aria-label="Filter by action"
          >
            <option value="all">All actions ({records.length})</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {auditActionLabel(a)}
              </option>
            ))}
          </select>
        </div>

        {/* Chain ------------------------------------------------------------ */}
        <div className="panel anim-fade-up" style={{ padding: "0.5rem 0" }}>
          {filtered.length === 0 ? (
            <p className="muted" style={{ padding: "1.5rem 1.2rem", textAlign: "center", margin: 0 }}>
              {records.length === 0 ? "No records yet." : "Nothing matches this filter."}
            </p>
          ) : (
            <div style={{ position: "relative" }}>
              {/* Chain rail */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 37,
                  top: 18,
                  bottom: 18,
                  width: 2,
                  background: "var(--border)",
                }}
              />
              {filtered.map((r, i) => {
                const broken = !check.valid && check.brokenAt !== null && r.index >= check.brokenAt;
                const isOpen = expanded === r.index;
                return (
                  <div
                    key={r.hash + r.index}
                    style={{
                      position: "relative",
                      padding: "0.7rem 1.2rem 0.7rem 1rem",
                      borderBottom: i === filtered.length - 1 ? "none" : "1px solid var(--border)",
                      background: broken ? "var(--danger-bg)" : undefined,
                    }}
                  >
                    <div
                      style={{ display: "flex", gap: 14, cursor: "pointer", alignItems: "flex-start" }}
                      onClick={() => setExpanded(isOpen ? null : r.index)}
                    >
                      {/* Chain node */}
                      <span
                        aria-hidden
                        style={{
                          position: "relative",
                          zIndex: 1,
                          width: 30,
                          height: 30,
                          borderRadius: 999,
                          background: broken ? "var(--danger-solid)" : "var(--surface)",
                          border: `2px solid ${broken ? "var(--danger-solid)" : "var(--border-strong)"}`,
                          color: broken ? "#fff" : "var(--muted)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          marginTop: 2,
                        }}
                      >
                        <LinkIcon />
                      </span>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="flex items-center justify-between" style={{ gap: 12 }}>
                          <div className="flex items-center" style={{ gap: 10, minWidth: 0, flexWrap: "wrap" }}>
                            <span
                              className="badge mono"
                              style={{
                                background: "var(--brand-50)",
                                color: "var(--brand-700)",
                                borderColor: "var(--brand-100)",
                                fontVariantNumeric: "tabular-nums",
                                textTransform: "uppercase",
                                letterSpacing: "0.04em",
                              }}
                            >
                              <LabelWithHint info={HINTS.auditBlock} size={10} nested>
                                Block #{r.index}
                              </LabelWithHint>
                            </span>
                            <span style={{ fontSize: "0.86rem", fontWeight: 600, color: "var(--text)" }}>
                              {auditActionLabel(r.action)}
                            </span>
                          </div>
                          <span
                            className="flex items-center"
                            style={{ gap: 8, flexShrink: 0 }}
                          >
                            <span
                              className="mono hide-sm"
                              title={r.prevHash}
                              style={{ fontSize: "0.66rem", color: "var(--muted-soft)", whiteSpace: "nowrap" }}
                            >
                              Prev: {shortHash(r.prevHash)}
                            </span>
                            <ChevronIcon open={isOpen} />
                          </span>
                        </div>
                        <div className="muted" style={{ fontSize: "0.72rem", marginTop: 3 }}>
                          {r.actor}
                          {r.ticketId ? (
                            <>
                              {" "}· <span className="mono">{r.ticketId}</span>
                            </>
                          ) : null}{" "}
                          · {new Date(r.timestamp).toLocaleString()}
                        </div>
                        <div
                          className="mono"
                          title={r.hash}
                          style={{
                            fontSize: "0.66rem",
                            color: "var(--muted-soft)",
                            marginTop: 4,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          Hash: {shortHash(r.hash)}
                        </div>
                      </div>
                    </div>

                    {isOpen ? (
                      <div
                        className="panel-2 anim-fade-in"
                        style={{ marginTop: 10, marginLeft: 44, padding: "0.85rem 0.95rem", fontSize: "0.74rem" }}
                      >
                        <HashField
                          label="hash"
                          value={r.hash}
                          copied={copiedHash === r.hash}
                          onCopy={() => void copyHash(r.hash)}
                          info={HINTS.auditHash}
                        />
                        <HashField
                          label="prevHash"
                          value={r.prevHash}
                          copied={copiedHash === r.prevHash}
                          onCopy={() => void copyHash(r.prevHash)}
                          info={HINTS.auditPrevHash}
                        />
                        <HashField
                          label="payloadHash"
                          value={r.payloadHash}
                          copied={copiedHash === r.payloadHash}
                          onCopy={() => void copyHash(r.payloadHash)}
                          info={HINTS.auditPayloadHash}
                        />
                        <div className="label" style={{ marginTop: 10, marginBottom: 4 }}>
                          payload
                        </div>
                        <pre
                          className="mono"
                          style={{
                            margin: 0,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            fontSize: "0.72rem",
                            color: "var(--muted)",
                            maxHeight: 260,
                            overflow: "auto",
                          }}
                        >
                          {JSON.stringify(r.payload, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   Pieces
   ========================================================================= */

/** Abbreviate a long hash for inline display, e.g. "3e7b8f9a…l2m3n" */
function shortHash(hash: string): string {
  if (!hash || hash.length <= 16) return hash || "—";
  return `${hash.slice(0, 8)}…${hash.slice(-5)}`;
}

function StatTile({
  icon,
  tone,
  value,
  label,
  info,
}: {
  icon: React.ReactNode;
  tone: { bg: string; fg: string };
  value: string;
  label: string;
  info?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0.9rem 1rem",
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: tone.bg,
          color: tone.fg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "1.2rem", fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text)", lineHeight: 1.1 }}>
          {value}
        </div>
        <div className="muted" style={{ fontSize: "0.74rem", marginTop: 2 }}>
          <LabelWithHint info={info} size={12}>
            {label}
          </LabelWithHint>
        </div>
      </div>
    </div>
  );
}

function HashField({
  label,
  value,
  copied,
  onCopy,
  info,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  info?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 5, alignItems: "center" }}>
      <span className="muted" style={{ width: 86, flexShrink: 0 }}>
        <LabelWithHint info={info} side="right" size={11}>
          {label}
        </LabelWithHint>
      </span>
      <span
        className="mono"
        style={{ wordBreak: "break-all", flex: 1, color: "var(--text-secondary)" }}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCopy();
        }}
        aria-label={`Copy ${label}`}
        title="Copy"
        style={{
          border: "1px solid var(--border)",
          background: copied ? "var(--success-bg)" : "var(--surface)",
          color: copied ? "var(--success-fg)" : "var(--muted)",
          borderRadius: 6,
          width: 26,
          height: 26,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
          transition: "background var(--dur-1) var(--ease), color var(--dur-1) var(--ease)",
        }}
      >
        {copied ? <CheckSmIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

/* =========================================================================
   Icons
   ========================================================================= */

const ic = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function ShieldIcon() {
  return (
    <svg {...ic} width={14} height={14}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function ShieldCheckIcon() {
  return (
    <svg {...ic}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function ShieldOffIcon() {
  return (
    <svg {...ic}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  );
}
function LayersIcon() {
  return (
    <svg {...ic}>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg {...ic}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg {...ic} width={15} height={15}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg {...ic} width={13} height={13}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      {...ic}
      width={14}
      height={14}
      style={{
        color: "var(--muted)",
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform var(--dur-2) var(--ease)",
        flexShrink: 0,
      }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg {...ic} width={12} height={12}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function CheckSmIcon() {
  return (
    <svg {...ic} width={12} height={12} strokeWidth={2.5}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

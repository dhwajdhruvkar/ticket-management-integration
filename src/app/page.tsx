"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Metrics } from "@/server/services/metricsService";
import type { TicketRow, UserRow } from "@/server/domain/models";
import {
  Avatar,
  Donut,
  InfoHint,
  LabelWithHint,
  PieChart,
  PriorityBadge,
  StatusBadge,
  timeAgo,
} from "@/components/ui";
import { HINTS } from "@/lib/hints";
import { DashboardSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/primitives";
import { usePersona } from "@/components/Persona";
import { AlertTriangle } from "lucide-react";

// =============================================================================
// DashboardPage — the workspace home for agents/managers/admins.
//
// A single, dense-but-quiet overview: a personalised hero, four spotlight KPIs
// with iconography and trend hints, an operations bar for SLA health, a
// two-column detail grid (recent activity + SLA + breakdowns), and an agent
// leaderboard with per-person completion bars. Every card is a real link into
// the ticket queue where relevant.
// =============================================================================

type ChainState = "checking" | "ok" | "tampered" | "unavailable";

interface ChainCopy {
  strip: string;
  ops: string;
  opsTone: "success" | "danger" | "info";
  bg: string;
  fg: string;
  border: string;
  hint: string;
}

const NEUTRAL_CHIP = { bg: "var(--surface-2)", fg: "var(--text-muted)", border: "var(--border)" };

const CHAIN_COPY: Record<ChainState, ChainCopy> = {
  checking: {
    strip: "Verifying chain…",
    ops: "…",
    opsTone: "info",
    ...NEUTRAL_CHIP,
    hint: "Recomputing the hash chain over the audit records.",
  },
  ok: {
    strip: "Chain verified",
    ops: "Intact",
    opsTone: "success",
    bg: "var(--success-bg)",
    fg: "var(--success-fg)",
    border: "var(--success-border)",
    hint: HINTS.auditChain,
  },
  tampered: {
    strip: "Chain tampered",
    ops: "Tampered",
    opsTone: "danger",
    bg: "var(--danger-bg)",
    fg: "var(--danger-fg)",
    border: "var(--danger-border)",
    hint: "A recomputed hash did not match the stored one — the audit log has been altered.",
  },
  unavailable: {
    strip: "Chain unverified",
    ops: "Unknown",
    opsTone: "info",
    ...NEUTRAL_CHIP,
    hint: "The verification request failed, so the chain could be neither confirmed nor faulted.",
  },
};

export default function DashboardPage() {
  const { persona, ready } = usePersona();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [recent, setRecent] = useState<TicketRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  // "unavailable" is not "tampered": a failed verify request must never be
  // reported to an auditor as a broken chain, nor as a verified one.
  const [chainValid, setChainValid] = useState<ChainState>("checking");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [m, rows, ppl, audit] = await Promise.all([
        apiGet<Metrics>("/metrics"),
        apiGet<TicketRow[]>("/tickets").catch(() => [] as TicketRow[]),
        apiGet<UserRow[]>("/users").catch(() => [] as UserRow[]),
        apiGet<{ valid: boolean }>("/audit?verify=1").catch(() => null),
      ]);
      setMetrics(m);
      setRecent(rows.slice(0, 6));
      setUsers(ppl);
      setChainValid(audit ? (audit.valid ? "ok" : "tampered") : "unavailable");
    } catch (err) {
      // Metrics are the dashboard: without them there is nothing to show, so
      // say so and offer a retry instead of leaving the skeleton up forever.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (ready && persona.role !== "requester") void refresh();
  }, [ready, persona.role, persona.id, refresh]);

  if (!ready) {
    return (
      <div className="page-pad">
        <DashboardSkeleton />
      </div>
    );
  }

  // Requesters get a focused, card-based personal dashboard.
  if (persona.role === "requester") {
    return <RequesterDashboard name={persona.name} />;
  }

  if (error && !metrics) {
    return (
      <div className="page-pad">
        <div style={{ maxWidth: 560, margin: "8vh auto 0" }}>
          <EmptyState
            icon={AlertTriangle}
            title="Could not load the dashboard"
            description={
              <>
                {error}
                <br />
                Your session may have expired, or the service is temporarily unavailable.
              </>
            }
            action={
              <button className="btn btn-primary" onClick={() => void refresh()} disabled={refreshing}>
                {refreshing ? "Retrying…" : "Try again"}
              </button>
            }
          />
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="page-pad">
        <DashboardSkeleton />
      </div>
    );
  }

  const isAdmin = ["tenant_admin", "super_admin"].includes(persona.serverRole);

  return (
    <div className="page-pad anim-fade-up">
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <Hero
          name={persona.name}
          onRefresh={() => void refresh()}
          refreshing={refreshing}
        />

        {isAdmin ? <AdminQuickActions /> : null}

        <SlaHealthStrip metrics={metrics} chainValid={chainValid} />

        <PrimaryKpis metrics={metrics} />

        <OpsBar metrics={metrics} chainValid={chainValid} />

        <div className="dash-grid">
          <RecentActivity recent={recent} />
          <SlaCompliance metrics={metrics} />
          <CategoryBreakdown metrics={metrics} />
          <GroupBacklog metrics={metrics} />
        </div>

        <AgentLeaderboard metrics={metrics} users={users} />
      </div>

      <style jsx>{`
        .dash-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
          gap: 16px;
          margin-bottom: 20px;
        }
        @media (max-width: 960px) {
          .dash-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

/* =========================================================================
   Requester dashboard (card-focused personal overview)
   ========================================================================= */

const REQ_ACTIVE = ["new", "open", "in_progress", "reopened"];
const REQ_WAITING = ["pending", "pending_agent"];
const REQ_RESOLVED = ["auto_resolved", "resolved", "closed"];

function RequesterDashboard({ name }: { name: string }) {
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const greeting = useMemo(() => greetingForNow(), []);
  const firstName = name.split(" ")[0] || name;

  useEffect(() => {
    apiGet<TicketRow[]>("/tickets")
      .then((rows) => setTickets(rows))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="page-pad">
        <DashboardSkeleton />
      </div>
    );
  }

  const active = tickets.filter((t) => REQ_ACTIVE.includes(t.status)).length;
  const waiting = tickets.filter((t) => REQ_WAITING.includes(t.status)).length;
  const resolved = tickets.filter((t) => REQ_RESOLVED.includes(t.status)).length;
  const escalated = tickets.filter((t) => t.status === "escalated").length;
  const instant = tickets.filter((t) => t.status === "auto_resolved").length;
  const total = tickets.length;

  const pie = [
    { label: "Active", value: active, color: "var(--brand-500)" },
    { label: "Waiting", value: waiting, color: "var(--warning-solid)" },
    { label: "Resolved", value: resolved, color: "var(--success-solid)" },
    { label: "Escalated", value: escalated, color: "var(--danger-solid)" },
  ];

  const recent = [...tickets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);

  const cards: { label: string; value: number; hint: string; tone: Tone }[] = [
    { label: "Active", value: active, hint: "Being worked on", tone: "brand" },
    { label: "Waiting on you", value: waiting, hint: "On hold or pending", tone: "warning" },
    { label: "Resolved", value: resolved, hint: "Solutions delivered", tone: "success" },
    { label: "Instantly solved", value: instant, hint: "By the assistant", tone: "info" },
  ];

  return (
    <div className="page-pad anim-fade-up">
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <section
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 18,
            paddingTop: 4,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title" style={{ margin: 0, fontSize: "clamp(1.55rem, 2.6vw, 1.9rem)" }}>
              {greeting}, {firstName}
            </h1>
            <p className="muted" style={{ fontSize: "0.9rem", margin: "6px 0 0" }}>
              Here is where your requests stand. Need something new?
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
            <Link href="/knowledge-base" className="btn btn-ghost" style={{ height: 38 }}>
              Help center
            </Link>
            <Link href="/portal" className="btn btn-primary" style={{ height: 38 }}>
              <PlusIcon />
              <span style={{ marginLeft: 6 }}>Raise a request</span>
            </Link>
          </div>
        </section>

        <section className="grid-kpis stagger" style={{ gap: 14, marginBottom: 16 }}>
          {cards.map((c) => {
            const t = TONE[c.tone];
            return (
              <div key={c.label} className="panel" style={{ padding: "1.05rem 1.15rem", minHeight: 96 }}>
                <div
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--muted)",
                  }}
                >
                  {c.label}
                </div>
                <div
                  style={{
                    fontSize: "1.7rem",
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                    marginTop: 6,
                    color: t.fg,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {c.value}
                </div>
                <div className="muted" style={{ fontSize: "0.75rem", marginTop: 6 }}>
                  {c.hint}
                </div>
              </div>
            );
          })}
        </section>

        <div className="req-grid">
          <section className="panel anim-fade-up" style={{ padding: "1.1rem 1.2rem" }}>
            <PanelHeader title="Your requests" icon={<GaugeIcon />} />
            {total === 0 ? (
              <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                You haven&apos;t raised any requests yet.
              </p>
            ) : (
              <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
                <PieChart data={pie} size={140} stroke={18}>
                  <span style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--text)", lineHeight: 1 }}>{total}</span>
                  <span className="muted" style={{ fontSize: "0.68rem", fontWeight: 600 }}>
                    total
                  </span>
                </PieChart>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pie.map((s) => (
                    <span
                      key={s.label}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                      }}
                    >
                      <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                      {s.label}
                      <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {s.value}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="panel anim-fade-up" style={{ padding: "1.1rem 1.2rem" }}>
            <PanelHeader
              title="Recent activity"
              icon={<ListIcon />}
              right={
                <Link href="/tickets" className="chip-link" style={{ fontSize: "0.82rem" }}>
                  View all →
                </Link>
              }
            />
            {recent.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                Nothing to show yet.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {recent.map((t) => (
                  <Link
                    key={t.id}
                    href={`/tickets/${t.id}`}
                    className="recent-row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto",
                      alignItems: "center",
                      gap: 12,
                      padding: "0.6rem 0.7rem",
                      borderRadius: 10,
                      border: "1px solid transparent",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <StatusBadge status={t.status} />
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: "0.88rem",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "var(--text)",
                        }}
                      >
                        {t.subject}
                      </div>
                      <div className="muted" style={{ fontSize: "0.72rem", marginTop: 2 }}>
                        <span className="mono">{t.reference}</span> · {t.category} · {timeAgo(t.updatedAt)}
                      </div>
                    </div>
                    <PriorityBadge priority={t.priority} />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
      <style jsx>{`
        .req-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
          gap: 16px;
          margin-bottom: 20px;
        }
        @media (max-width: 860px) {
          .req-grid {
            grid-template-columns: 1fr;
          }
        }
        :global(.recent-row:hover) {
          background: var(--surface-2);
          border-color: var(--border);
        }
      `}</style>
    </div>
  );
}

/* =========================================================================
   Admin quick actions
   ========================================================================= */

function AdminQuickActions() {
  const actions = [
    { href: "/settings#users", label: "Manage users", hint: "Create & assign roles", icon: <UsersIcon /> },
    { href: "/settings#departments", label: "Departments", hint: "Organization structure", icon: <FolderIcon /> },
    { href: "/settings#integrations", label: "API integrations", hint: "Keys & agent access", icon: <ShieldIcon /> },
    { href: "/settings", label: "All settings", hint: "Workspace configuration", icon: <GaugeIcon /> },
  ];
  return (
    <section
      className="anim-fade-up"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 12,
        marginBottom: 16,
      }}
    >
      {actions.map((a) => (
        <Link
          key={a.label}
          href={a.href}
          className="panel hover-lift"
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "0.85rem 1rem", textDecoration: "none", color: "inherit" }}
        >
          <span
            aria-hidden
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "var(--brand-50)",
              color: "var(--brand-700)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {a.icon}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: "0.9rem", fontWeight: 700, color: "var(--text)" }}>{a.label}</span>
            <span className="muted" style={{ fontSize: "0.74rem" }}>
              {a.hint}
            </span>
          </span>
        </Link>
      ))}
    </section>
  );
}

/* =========================================================================
   Hero
   ========================================================================= */

function Hero({ name, onRefresh, refreshing }: { name: string; onRefresh: () => void; refreshing: boolean }) {
  const greeting = useMemo(() => greetingForNow(), []);
  const now = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    []
  );
  const firstName = name.split(" ")[0] || name;

  return (
    <section
      className="anim-fade-up"
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 18,
        paddingTop: 4,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 className="page-title" style={{ margin: 0, fontSize: "clamp(1.55rem, 2.6vw, 1.9rem)" }}>
          {greeting}, {firstName}
        </h1>
        <p className="muted" style={{ fontSize: "0.9rem", margin: "6px 0 0" }}>
          {now} — SLAs, backlog, AI containment, and team output at a glance.
        </p>
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onRefresh}
          disabled={refreshing}
          style={{ height: 38 }}
        >
          <RefreshIcon spinning={refreshing} />
          <span style={{ marginLeft: 6 }}>{refreshing ? "Refreshing…" : "Refresh"}</span>
        </button>
        <Link href="/tickets?new=1" className="btn btn-primary" style={{ height: 38 }}>
          <PlusIcon />
          <span style={{ marginLeft: 6 }}>New ticket</span>
        </Link>
      </div>
    </section>
  );
}

/* =========================================================================
   SLA health strip — segmented bar + legend + audit chain chip
   ========================================================================= */

function SlaHealthStrip({ metrics, chainValid }: { metrics: Metrics; chainValid: ChainState }) {
  const open = metrics.openCount;
  const atRisk = Math.min(metrics.slaAtRisk, open);
  const breached = Math.min(metrics.slaBreached, Math.max(0, open - atRisk));
  const healthy = Math.max(0, open - atRisk - breached);
  const total = Math.max(1, open);
  const pct = (n: number) => Math.round((n / total) * 100);
  const chain = CHAIN_COPY[chainValid];

  return (
    <section
      className="panel anim-fade-up"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0.85rem 1.15rem",
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      <span className="label" style={{ flexShrink: 0 }}>
        <LabelWithHint
          info="The split of open tickets that are comfortably inside their SLA, close to breaching, or already past their deadline."
          side="right"
        >
          SLA Health
        </LabelWithHint>
      </span>
      <div
        aria-hidden
        style={{
          flex: 1,
          minWidth: 160,
          height: 8,
          borderRadius: 999,
          overflow: "hidden",
          display: "flex",
          background: "var(--surface-3)",
        }}
      >
        <span className="bar-grow" style={{ width: `${pct(healthy)}%`, background: "var(--success-solid)" }} />
        <span className="bar-grow" style={{ width: `${pct(atRisk)}%`, background: "var(--warning-solid)" }} />
        <span className="bar-grow" style={{ width: `${pct(breached)}%`, background: "var(--danger-solid)" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", flexShrink: 0 }}>
        <LegendDot color="var(--success-solid)" label={`Healthy ${pct(healthy)}%`} />
        <LegendDot color="var(--warning-solid)" label={`At-risk ${pct(atRisk)}%`} />
        <LegendDot color="var(--danger-solid)" label={`Breached ${pct(breached)}%`} />
        <Link href="/audit" style={{ textDecoration: "none" }}>
          <span
            className="badge"
            style={{ background: chain.bg, color: chain.fg, borderColor: chain.border }}
          >
            <ShieldIcon />
            {chain.strip}
            <InfoHint text={chain.hint} side="left" size={11} nested />
          </span>
        </Link>
      </div>
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: "0.76rem",
        fontWeight: 600,
        color: "var(--text-secondary)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function greetingForNow(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/* =========================================================================
   Primary KPI spotlight
   ========================================================================= */

function PrimaryKpis({ metrics }: { metrics: Metrics }) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const money = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const mins = (n: number) => (n >= 60 ? `${(n / 60).toFixed(1)}h` : `${Math.round(n)}m`);

  const tiles: SpotlightProps[] = [
    {
      label: "Auto-resolved by AI",
      value: pct(metrics.deflectionRate),
      hint: `${metrics.autoResolved} of ${metrics.processed} handled without an agent`,
      icon: <SparkIcon />,
      tone: "success",
      href: "/tickets",
      progress: metrics.deflectionRate,
      info: HINTS.aiDeflection,
    },
    {
      label: "Assistant containment",
      value: pct(metrics.containmentRate),
      hint: "Solved or drafted by AI",
      icon: <BoltIcon />,
      tone: "brand",
      progress: metrics.containmentRate,
      info: HINTS.aiContainment,
    },
    {
      label: "First response / MTTR",
      value: `${mins(metrics.avgFirstResponseMins)} · ${mins(metrics.mttrMins)}`,
      hint: "Average across resolved tickets",
      icon: <TimerIcon />,
      tone: "info",
      info: `${HINTS.firstResponseTime} ${HINTS.mttr}`,
    },
    {
      label: "Estimated cost saved",
      value: money(metrics.costSaved),
      hint: `~${metrics.agentHoursSaved.toFixed(1)} agent-hours saved`,
      icon: <BankIcon />,
      tone: "warning",
      info: HINTS.costSaved,
    },
  ];

  return (
    <section className="grid-kpis stagger" style={{ gap: 14, marginBottom: 16 }}>
      {tiles.map((t) => (
        <Spotlight key={t.label} {...t} />
      ))}
    </section>
  );
}

type Tone = "success" | "brand" | "info" | "warning" | "danger";
interface SpotlightProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ReactNode;
  tone: Tone;
  href?: string;
  progress?: number;
  info?: string;
}

function Spotlight({ label, value, hint, icon, tone, href, progress, info }: SpotlightProps) {
  const t = TONE[tone];
  const inner = (
    <div
      className={href ? "hover-lift" : ""}
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "1.05rem 1.15rem",
        borderRadius: "var(--r-lg)",
        border: "1px solid var(--border)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
        minHeight: 118,
        height: "100%",
        transition:
          "border-color var(--dur-2) var(--ease), box-shadow var(--dur-2) var(--ease), transform var(--dur-2) var(--ease-out)",
        cursor: href ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div
          style={{
            fontSize: "0.7rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--muted)",
            paddingTop: 4,
          }}
        >
          <LabelWithHint info={info} nested={!!href}>
            {label}
          </LabelWithHint>
        </div>
        <div
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: t.bg,
            color: t.fg,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      </div>
      <div
        style={{
          fontSize: "1.7rem",
          fontWeight: 800,
          letterSpacing: "-0.03em",
          lineHeight: 1.1,
          marginTop: 2,
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {progress !== undefined ? (
        <div
          aria-hidden
          style={{
            width: "100%",
            height: 6,
            borderRadius: 999,
            background: "var(--surface-3)",
            marginTop: 10,
            overflow: "hidden",
          }}
        >
          <div
            className="bar-grow"
            style={{
              width: `${Math.min(100, Math.max(0, progress * 100))}%`,
              height: "100%",
              background: t.solid,
              borderRadius: 999,
            }}
          />
        </div>
      ) : null}
      {hint ? (
        <div className="muted" style={{ fontSize: "0.75rem", marginTop: progress !== undefined ? 6 : 8 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
  return href ? (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

const TONE: Record<Tone, { bg: string; fg: string; solid: string }> = {
  success: { bg: "var(--success-bg)", fg: "var(--success-fg)", solid: "var(--success-solid)" },
  brand: { bg: "var(--brand-50)", fg: "var(--brand-700)", solid: "var(--brand-500)" },
  info: { bg: "var(--info-bg)", fg: "var(--info-fg)", solid: "var(--info-solid)" },
  warning: { bg: "var(--warning-bg)", fg: "var(--warning-fg)", solid: "var(--warning-solid)" },
  danger: { bg: "var(--danger-bg)", fg: "var(--danger-fg)", solid: "var(--danger-solid)" },
};

/* =========================================================================
   Ops bar — SLA health, quick counters
   ========================================================================= */

function OpsBar({ metrics, chainValid }: { metrics: Metrics; chainValid: ChainState }) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const chain = CHAIN_COPY[chainValid];
  return (
    <section
      className="anim-fade-up"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
        marginBottom: 16,
        padding: "0.95rem 1.1rem",
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <OpsCell tone="brand" icon={<FolderIcon />} label="Open tickets" value={metrics.openCount} />
      <OpsCell
        tone="success"
        icon={<CheckIcon />}
        label="Resolved"
        value={metrics.resolvedCount}
      />
      <OpsCell
        tone={metrics.slaAtRisk > 0 ? "warning" : "info"}
        icon={<HourglassIcon />}
        label="SLA at risk"
        value={metrics.slaAtRisk}
        hint="80%+ of window"
        info={HINTS.slaAtRisk}
      />
      <OpsCell
        tone={metrics.slaBreached > 0 ? "danger" : "info"}
        icon={<AlertIcon />}
        label="SLA breached"
        value={metrics.slaBreached}
        hint="Past deadline"
        info={HINTS.slaBreached}
      />
      <OpsCell
        tone="info"
        icon={<HeartIcon />}
        label="CSAT"
        value={metrics.csat ? pct(metrics.csat) : "—"}
        hint="Requester rated"
        info={HINTS.csat}
      />
      <OpsCell
        tone={chain.opsTone}
        icon={<ShieldIcon />}
        label="Audit chain"
        value={chain.ops}
        hint={`${metrics.auditBlocks} records`}
        info={chain.hint}
      />
    </section>
  );
}

function OpsCell({
  tone,
  icon,
  label,
  value,
  hint,
  info,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  info?: string;
}) {
  const t = TONE[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        aria-hidden
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: t.bg,
          color: t.fg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "1.05rem", fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text)", lineHeight: 1 }}>
          {value}
        </div>
        <div style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 600, marginTop: 3 }}>
          <LabelWithHint info={info}>
            <span>
              {label}
              {hint ? <span style={{ opacity: 0.7 }}> · {hint}</span> : null}
            </span>
          </LabelWithHint>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   Recent activity
   ========================================================================= */

function RecentActivity({ recent }: { recent: TicketRow[] }) {
  return (
    <section
      className="panel anim-fade-up"
      style={{ padding: "1.1rem 1.2rem", gridColumn: "1", gridRow: "1" }}
    >
      <PanelHeader
        title="Live activity"
        icon={<ListIcon />}
        right={
          <Link href="/tickets" className="chip-link" style={{ fontSize: "0.82rem" }}>
            View all →
          </Link>
        }
      />
      {recent.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.86rem", margin: 0 }}>
          No recent tickets in this window.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {recent.map((t) => (
            <Link
              key={t.id}
              href={`/tickets/${t.id}`}
              className="recent-row"
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                alignItems: "center",
                gap: 12,
                padding: "0.6rem 0.7rem",
                borderRadius: 10,
                border: "1px solid transparent",
                textDecoration: "none",
                color: "inherit",
                transition:
                  "background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease)",
              }}
            >
              <StatusBadge status={t.status} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "0.88rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "var(--text)",
                  }}
                >
                  {t.subject}
                </div>
                <div className="muted" style={{ fontSize: "0.72rem", marginTop: 2 }}>
                  <span className="mono">{t.reference}</span> · {t.category} · {timeAgo(t.updatedAt)}
                </div>
              </div>
              <PriorityBadge priority={t.priority} />
            </Link>
          ))}
        </div>
      )}
      <style jsx>{`
        :global(.recent-row:hover) {
          background: var(--surface-2);
          border-color: var(--border);
        }
      `}</style>
    </section>
  );
}

/* =========================================================================
   SLA compliance
   ========================================================================= */

function SlaCompliance({ metrics }: { metrics: Metrics }) {
  const totals = metrics.slaCompliance.reduce(
    (acc, s) => ({ met: acc.met + s.met, total: acc.total + s.total }),
    { met: 0, total: 0 }
  );
  const overall = totals.total ? totals.met / totals.total : 0;
  const overallColor =
    overall >= 0.9 ? "var(--success-solid)" : overall >= 0.6 ? "var(--brand-600)" : "var(--danger-solid)";

  return (
    <section className="panel anim-fade-up" style={{ padding: "1.1rem 1.2rem" }}>
      <PanelHeader title="SLA compliance" icon={<GaugeIcon />} info={HINTS.slaCompliance} />
      {metrics.slaCompliance.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          No SLA data yet.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <Donut value={overall} size={132} stroke={15} color={overallColor}>
              <span
                style={{
                  fontSize: "1.45rem",
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  color: "var(--text)",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.05,
                }}
              >
                {Math.round(overall * 100)}%
              </span>
              <span className="muted" style={{ fontSize: "0.68rem", fontWeight: 600 }}>
                Met target
              </span>
            </Donut>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {metrics.slaCompliance.map((s) => (
              <SlaRow key={s.priority} priority={s.priority} met={s.met} total={s.total} compliance={s.compliance} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function SlaRow({
  priority,
  met,
  total,
  compliance,
}: {
  priority: string;
  met: number;
  total: number;
  compliance: number;
}) {
  const pct = Math.round((total ? met / total : 0) * 100);
  const color =
    compliance >= 0.9 ? "var(--success-solid)" : compliance >= 0.6 ? "var(--warning-solid)" : "var(--danger-solid)";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text)", textTransform: "capitalize" }}>
          {priority.replace("_", " ")}
        </span>
        <span className="muted" style={{ fontSize: "0.76rem", fontVariantNumeric: "tabular-nums" }}>
          {met}/{total} · {pct}%
        </span>
      </div>
      <div
        aria-hidden
        style={{
          height: 8,
          background: "var(--surface-3)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          className="bar-grow"
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: 999,
          }}
        />
      </div>
    </div>
  );
}

/* =========================================================================
   Category breakdown
   ========================================================================= */

function CategoryBreakdown({ metrics }: { metrics: Metrics }) {
  const entries = Object.entries(metrics.byCategory).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));

  return (
    <section className="panel anim-fade-up" style={{ padding: "1.1rem 1.2rem" }}>
      <PanelHeader title="Tickets by category" icon={<TagIcon />} />
      {entries.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.83rem", margin: 0 }}>
          No data yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.map(([category, count]) => (
            <div key={category} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 90,
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                }}
              >
                {category}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 8,
                  background: "var(--surface-3)",
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                <div
                  className="bar-grow"
                  style={{
                    width: `${(count / max) * 100}%`,
                    height: "100%",
                    background: "var(--brand-gradient)",
                    borderRadius: 999,
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: "var(--text)",
                  width: 30,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {count}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* =========================================================================
   Group backlog
   ========================================================================= */

function GroupBacklog({ metrics }: { metrics: Metrics }) {
  return (
    <section className="panel anim-fade-up" style={{ padding: "1.1rem 1.2rem" }}>
      <PanelHeader title="Backlog by group" icon={<UsersIcon />} info={HINTS.backlogByGroup} />
      {metrics.backlogByGroup.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.83rem", margin: 0 }}>
          No assignment groups configured.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {metrics.backlogByGroup.map((g) => (
            <div
              key={g.groupId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "0.55rem 0.7rem",
                borderRadius: "var(--r-md)",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <span
                  aria-hidden
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: "var(--brand-50)",
                    color: "var(--brand-700)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <UsersIcon />
                </span>
                <span
                  style={{
                    fontSize: "0.83rem",
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {g.name}
                </span>
              </span>
              <span
                className={g.open === 0 ? "count-pill soft" : "count-pill"}
                title={`${g.open} open tickets`}
              >
                {g.open}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* =========================================================================
   Agent leaderboard
   ========================================================================= */

function AgentLeaderboard({ metrics, users }: { metrics: Metrics; users: UserRow[] }) {
  const board = metrics.leaderboard;
  const maxTotal = Math.max(1, ...board.map((a) => a.resolved + a.open));

  return (
    <section
      className="panel anim-fade-up"
      style={{ padding: "1.1rem 1.2rem 0.5rem", marginBottom: 20 }}
    >
      <PanelHeader
        title="Agent performance"
        icon={<TrophyIcon />}
        right={
          <span className="muted" style={{ fontSize: "0.76rem" }}>
            Ordered by resolved
          </span>
        }
      />
      {board.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          No tickets are assigned yet.
        </p>
      ) : (
        <div className="table-scroll" style={{ margin: "0 -1.2rem 0" }}>
          <table className="data-table" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ paddingLeft: "1.2rem" }}>Agent</th>
                <th>
                  <LabelWithHint info={HINTS.agentWorkload}>Workload</LabelWithHint>
                </th>
                <th style={{ textAlign: "right" }}>Resolved</th>
                <th style={{ textAlign: "right", paddingRight: "1.2rem" }}>Open</th>
              </tr>
            </thead>
            <tbody>
              {board.map((a, index) => {
                const total = a.resolved + a.open;
                const resolvedPct = total ? Math.round((a.resolved / total) * 100) : 0;
                const barPct = total ? Math.round((total / maxTotal) * 100) : 0;
                const user = users.find((u) => u.id === a.id);
                return (
                  <tr key={a.id} className="row-hover">
                    <td style={{ paddingLeft: "1.2rem" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                        <span
                          style={{
                            minWidth: 18,
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            color: "var(--muted)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <Avatar name={user?.name ?? a.name} size={30} />
                        <span style={{ fontSize: "0.86rem", fontWeight: 600, color: "var(--text)" }}>
                          {a.name}
                        </span>
                      </span>
                    </td>
                    <td style={{ minWidth: 150 }}>
                      <div
                        aria-hidden
                        style={{
                          height: 8,
                          background: "var(--surface-3)",
                          borderRadius: 999,
                          overflow: "hidden",
                          display: "flex",
                          maxWidth: 220,
                        }}
                      >
                        <div
                          className="bar-grow"
                          style={{
                            width: `${(barPct * resolvedPct) / 100}%`,
                            height: "100%",
                            background: "var(--success-solid)",
                          }}
                        />
                        <div
                          className="bar-grow"
                          style={{
                            width: `${barPct - (barPct * resolvedPct) / 100}%`,
                            height: "100%",
                            background: "var(--info-solid)",
                            opacity: 0.65,
                          }}
                        />
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span
                        className="badge"
                        style={{
                          background: "var(--success-bg)",
                          color: "var(--success-fg)",
                          borderColor: "var(--success-border)",
                        }}
                      >
                        {a.resolved}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", paddingRight: "1.2rem" }}>
                      <span
                        className="badge"
                        style={{
                          background: "var(--info-bg)",
                          color: "var(--info-fg)",
                          borderColor: "var(--info-border)",
                        }}
                      >
                        {a.open}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* =========================================================================
   Panel header
   ========================================================================= */

function PanelHeader({
  title,
  icon,
  right,
  info,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  info?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        margin: "-1.1rem -1.2rem 14px",
        padding: "0.8rem 1.2rem",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon ? <span style={{ color: "var(--muted)", display: "inline-flex" }}>{icon}</span> : null}
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
          <LabelWithHint info={info}>{title}</LabelWithHint>
        </h2>
      </div>
      {right}
    </div>
  );
}

/* =========================================================================
   Icons
   ========================================================================= */

const svgProps = {
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

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      {...svgProps}
      width={14}
      height={14}
      style={spinning ? { animation: "spin 0.8s linear infinite" } : undefined}
    >
      <path d="M23 4v6h-6M1 20v-6h6" />
      <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg {...svgProps} width={14} height={14} strokeWidth={2.5}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg {...svgProps} width={20} height={20}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg {...svgProps} width={20} height={20}>
      <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
    </svg>
  );
}
function TimerIcon() {
  return (
    <svg {...svgProps} width={20} height={20}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2M9 2h6" />
    </svg>
  );
}
function BankIcon() {
  return (
    <svg {...svgProps} width={20} height={20}>
      <path d="M3 21h18M4 21V10M20 21V10M6 21V10M18 21V10M10 21V10M14 21V10M2 10l10-7 10 7" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg {...svgProps}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg {...svgProps}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function HourglassIcon() {
  return (
    <svg {...svgProps}>
      <path d="M6 2h12M6 22h12M6 2v4a6 6 0 006 6 6 6 0 006-6V2M6 22v-4a6 6 0 016-6 6 6 0 016 6v4" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86l-8.14 14a2 2 0 001.71 3h16.28a2 2 0 001.71-3l-8.14-14a2 2 0 00-3.42 0z" />
    </svg>
  );
}
function HeartIcon() {
  return (
    <svg {...svgProps}>
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg {...svgProps}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}
function GaugeIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 14l4-4" />
      <path d="M3 12a9 9 0 0 1 18 0" />
      <circle cx="12" cy="14" r="1.5" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg {...svgProps}>
      <path d="M20.59 13.41l-8.17 8.17a2 2 0 0 1-2.83 0L2 13.83V2h11.83l7.83 7.83a2 2 0 0 1 0 2.83z" />
      <circle cx="7" cy="7" r="1.5" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg {...svgProps}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function TrophyIcon() {
  return (
    <svg {...svgProps}>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z" />
      <path d="M17 4h3v3a3 3 0 01-3 3M7 4H4v3a3 3 0 003 3" />
    </svg>
  );
}

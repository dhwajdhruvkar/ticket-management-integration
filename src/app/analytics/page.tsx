"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { Avatar } from "@/components/ui";

// =============================================================================
// AnalyticsPage — grouped KPI hierarchy, visualized distributions, and a
// tidier leaderboard. Split into "Volume", "AI performance", "Speed", "SLA",
// "Quality" and "Value" bands so the numbers tell a coherent story.
// =============================================================================

interface Metrics {
  totalTickets: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  openCount: number;
  resolvedCount: number;
  deflectionRate: number;
  containmentRate: number;
  avgConfidence: number;
  avgFirstResponseMins: number;
  mttrMins: number;
  csat: number;
  slaAtRisk: number;
  slaBreached: number;
  agentHoursSaved: number;
  costSaved: number;
  leaderboard: { id: string; name: string; resolved: number; open: number }[];
}

interface TrendPoint {
  date: string;
  created: number;
  resolved: number;
  autoResolved: number;
  slaMet: number;
  slaBreached: number;
  csatSatisfied: number;
  csatRated: number;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);

export default function AnalyticsPage() {
  const [m, setM] = useState<Metrics | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Metrics>("/metrics")
      .then(setM)
      .catch((e) => setError(String(e.message ?? e)));
    apiGet<TrendPoint[]>("/reports/trends?days=30")
      .then(setTrends)
      .catch(() => setTrends([]));
  }, []);

  const bands = useMemo(() => (m ? buildBands(m) : null), [m]);

  if (error) {
    return (
      <div className="page-pad">
        <div
          className="panel anim-fade-up"
          style={{
            padding: "1.5rem",
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "var(--warning-bg)",
              color: "var(--warning-fg)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <ShieldIcon />
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Insights require an agent role</div>
            <p className="muted" style={{ fontSize: "0.82rem", margin: "4px 0 0" }}>{error}</p>
          </div>
        </div>
      </div>
    );
  }
  if (!m || !bands) {
    return (
      <div className="page-pad">
        <div className="skel" style={{ height: 140, borderRadius: 16, marginBottom: 16 }} />
        <div className="skel" style={{ height: 320, borderRadius: 16 }} />
      </div>
    );
  }

  return (
    <div className="page-pad anim-fade-up">
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        {/* Hero */}
        <section
          style={{
            marginBottom: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 16,
            flexWrap: "wrap",
            paddingTop: 4,
          }}
        >
          <div>
            <h1 className="page-title" style={{ margin: 0, fontSize: "clamp(1.55rem, 2.8vw, 1.9rem)" }}>
              Analytics Insights
            </h1>
            <p className="muted" style={{ fontSize: "0.92rem", margin: "6px 0 0", maxWidth: 620 }}>
              Real-time performance metrics — volume, containment, response times, SLA health, quality, and ROI.
            </p>
          </div>
          <div className="flex items-center" style={{ gap: 8 }}>
            <a
              href="/api/v1/reports?format=pdf"
              className="btn btn-ghost"
              style={{ height: 38 }}
              download
            >
              <DownloadIcon />
              <span style={{ marginLeft: 6 }}>Download PDF</span>
            </a>
            <a
              href="/api/v1/reports?format=csv"
              className="btn btn-primary"
              style={{ height: 38 }}
              download
            >
              <DownloadIcon />
              <span style={{ marginLeft: 6 }}>Download CSV</span>
            </a>
          </div>
        </section>

        {/* KPI bands */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginBottom: 20 }}>
          {bands.map((band) => (
            <BandSection key={band.title} band={band} />
          ))}
        </div>

        {/* Trends */}
        {trends.length > 0 ? (
          <div className="grid-halves stagger" style={{ gap: 16, marginBottom: 18 }}>
            <section className="panel" style={{ padding: "1.1rem 1.2rem" }}>
              <PanelHeader
                title="Ticket volume — last 30 days"
                icon={<BarChartIcon />}
                right={
                  <span style={{ display: "inline-flex", gap: 12, fontSize: "0.72rem", color: "var(--muted)" }}>
                    <LegendDot color="var(--brand-500)" label="created" />
                    <LegendDot color="var(--success-solid)" label="resolved" />
                  </span>
                }
              />
              <TrendChart
                points={trends}
                series={[
                  { key: "created", color: "var(--brand-500)" },
                  { key: "resolved", color: "var(--success-solid)" },
                ]}
              />
            </section>
            <section className="panel" style={{ padding: "1.1rem 1.2rem" }}>
              <PanelHeader
                title="SLA outcomes — last 30 days"
                icon={<GaugeIcon />}
                right={
                  <span style={{ display: "inline-flex", gap: 12, fontSize: "0.72rem", color: "var(--muted)" }}>
                    <LegendDot color="var(--success-solid)" label="met" />
                    <LegendDot color="var(--danger-solid)" label="breached" />
                  </span>
                }
              />
              <StackedBars points={trends} />
            </section>
          </div>
        ) : null}

        {/* Distributions */}
        <div className="grid-halves stagger" style={{ gap: 16, marginBottom: 18 }}>
          <DistPanel title="Tickets by type" icon={<TagIcon />} data={m.byType} gradient="var(--brand-gradient)" />
          <DistPanel title="Tickets by status" icon={<FolderIcon />} data={m.byStatus} gradient="linear-gradient(90deg, var(--info-solid), var(--brand-500))" />
        </div>

        {/* Leaderboard */}
        <section className="panel anim-fade-up" style={{ padding: "1.1rem 1.2rem" }}>
          <PanelHeader
            title="Agent leaderboard"
            icon={<TrophyIcon />}
            right={
              <Link href="/tickets" className="chip-link" style={{ fontSize: "0.82rem" }}>
                Open tickets →
              </Link>
            }
          />
          {m.leaderboard.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
              No assigned tickets yet.
            </p>
          ) : (
            <Leaderboard items={m.leaderboard} />
          )}
        </section>
      </div>
    </div>
  );
}

/* =========================================================================
   KPI bands
   ========================================================================= */

interface KpiEntry {
  label: string;
  value: string;
  sub?: string;
  tone: Tone;
  icon: React.ReactNode;
  progress?: number;
}

interface Band {
  title: string;
  hint?: string;
  items: KpiEntry[];
}

function buildBands(m: Metrics): Band[] {
  return [
    {
      title: "Volume",
      hint: "How many tickets moved through the workspace",
      items: [
        { label: "Total tickets", value: String(m.totalTickets), tone: "brand", icon: <FolderIcon /> },
        { label: "Open", value: String(m.openCount), tone: "info", icon: <InboxIcon /> },
        { label: "Resolved", value: String(m.resolvedCount), tone: "success", icon: <CheckIcon /> },
        {
          label: "AI processed",
          value: String(Math.max(m.totalTickets, 0)),
          sub: "input to the assistant",
          tone: "warning",
          icon: <SparkIcon />,
        },
      ],
    },
    {
      title: "AI performance",
      hint: "How much of the workload the assistant carried",
      items: [
        {
          label: "Deflection",
          value: pct(m.deflectionRate),
          sub: "auto-resolved / processed",
          tone: "success",
          icon: <BoltIcon />,
          progress: m.deflectionRate,
        },
        {
          label: "Containment",
          value: pct(m.containmentRate),
          sub: "auto + suggested",
          tone: "brand",
          icon: <ShieldIcon />,
          progress: m.containmentRate,
        },
        {
          label: "Avg confidence",
          value: pct(m.avgConfidence),
          sub: "classifier + resolver",
          tone: "info",
          icon: <GaugeIcon />,
          progress: m.avgConfidence,
        },
      ],
    },
    {
      title: "Speed",
      hint: "Time to first touch and full resolution",
      items: [
        { label: "First response", value: dur(m.avgFirstResponseMins), tone: "info", icon: <TimerIcon /> },
        { label: "MTTR", value: dur(m.mttrMins), tone: "brand", icon: <ClockIcon /> },
      ],
    },
    {
      title: "SLA & quality",
      hint: "Deadline compliance and customer sentiment",
      items: [
        {
          label: "SLA at risk",
          value: String(m.slaAtRisk),
          sub: "80%+ elapsed",
          tone: m.slaAtRisk > 0 ? "warning" : "success",
          icon: <HourglassIcon />,
        },
        {
          label: "SLA breached",
          value: String(m.slaBreached),
          sub: "past deadline",
          tone: m.slaBreached > 0 ? "danger" : "success",
          icon: <AlertIcon />,
        },
        {
          label: "CSAT",
          value: pct(m.csat),
          sub: "requester rated",
          tone: "success",
          icon: <HeartIcon />,
          progress: m.csat,
        },
      ],
    },
    {
      title: "Value",
      hint: "ROI from AI-driven deflection",
      items: [
        {
          label: "Cost saved",
          value: `$${Math.round(m.costSaved).toLocaleString()}`,
          sub: `${m.agentHoursSaved.toFixed(1)} agent hours`,
          tone: "warning",
          icon: <BankIcon />,
        },
      ],
    },
  ];
}

function BandSection({ band }: { band: Band }) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <h2
          style={{
            fontSize: "0.72rem",
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--muted)",
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          {band.title}
        </h2>
        {band.hint ? (
          <span className="muted" style={{ fontSize: "0.78rem" }}>· {band.hint}</span>
        ) : null}
      </div>
      <div className="grid-kpis stagger" style={{ gap: 12 }}>
        {band.items.map((k) => (
          <KpiTile key={k.label} entry={k} />
        ))}
      </div>
    </section>
  );
}

function KpiTile({ entry }: { entry: KpiEntry }) {
  const tone = TONE[entry.tone];
  return (
    <div
      className="hover-lift"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "1rem 1.1rem",
        borderRadius: "var(--r-lg)",
        border: "1px solid var(--border)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
        transition:
          "border-color var(--dur-2) var(--ease), box-shadow var(--dur-2) var(--ease), transform var(--dur-2) var(--ease-out)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div
          style={{
            fontSize: "0.68rem",
            fontWeight: 700,
            color: "var(--muted)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            paddingTop: 4,
          }}
        >
          {entry.label}
        </div>
        <div
          aria-hidden
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: tone.bg,
            color: tone.fg,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {entry.icon}
        </div>
      </div>
      <div
        style={{
          fontSize: "1.55rem",
          fontWeight: 800,
          letterSpacing: "-0.03em",
          fontVariantNumeric: "tabular-nums",
          marginTop: 2,
          color: "var(--text)",
          lineHeight: 1.1,
        }}
      >
        {entry.value}
      </div>
      {entry.progress !== undefined ? (
        <div
          aria-hidden
          style={{
            height: 5,
            background: "var(--surface-3)",
            borderRadius: 999,
            marginTop: 8,
            overflow: "hidden",
          }}
        >
          <div
            className="bar-grow"
            style={{
              width: `${Math.min(100, Math.max(0, entry.progress * 100))}%`,
              height: "100%",
              background: tone.solid,
              borderRadius: 999,
            }}
          />
        </div>
      ) : null}
      {entry.sub ? (
        <div className="muted" style={{ fontSize: "0.72rem", marginTop: 6 }}>
          {entry.sub}
        </div>
      ) : null}
    </div>
  );
}

type Tone = "brand" | "info" | "success" | "warning" | "danger";
const TONE: Record<Tone, { bg: string; fg: string; solid: string }> = {
  brand: { bg: "var(--brand-50)", fg: "var(--brand-700)", solid: "var(--brand-500)" },
  info: { bg: "var(--info-bg)", fg: "var(--info-fg)", solid: "var(--info-solid)" },
  success: { bg: "var(--success-bg)", fg: "var(--success-fg)", solid: "var(--success-solid)" },
  warning: { bg: "var(--warning-bg)", fg: "var(--warning-fg)", solid: "var(--warning-solid)" },
  danger: { bg: "var(--danger-bg)", fg: "var(--danger-fg)", solid: "var(--danger-solid)" },
};

/* =========================================================================
   Distributions
   ========================================================================= */

function DistPanel({
  title,
  icon,
  data,
  gradient,
}: {
  title: string;
  icon: React.ReactNode;
  data: Record<string, number>;
  gradient: string;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  return (
    <section className="panel" style={{ padding: "1.1rem 1.2rem" }}>
      <PanelHeader
        title={title}
        icon={icon}
        right={
          <span className="muted" style={{ fontSize: "0.76rem" }}>
            {total} total
          </span>
        }
      />
      {entries.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.83rem", margin: 0 }}>
          No data yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.map(([k, v]) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  textTransform: "capitalize",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {k.replace(/_/g, " ")}
              </span>
              <div style={{ height: 10, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden" }}>
                <div
                  className="bar-grow"
                  style={{
                    width: `${(v / max) * 100}%`,
                    height: "100%",
                    background: gradient,
                    borderRadius: 999,
                  }}
                />
              </div>
              <span
                style={{
                  minWidth: 36,
                  textAlign: "right",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: "var(--text)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {v}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* =========================================================================
   Trend charts (dependency-free SVG)
   ========================================================================= */

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

function TrendChart({
  points,
  series,
}: {
  points: TrendPoint[];
  series: { key: keyof TrendPoint & string; color: string }[];
}) {
  const W = 560;
  const H = 150;
  const PAD = 8;
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => Number(p[s.key]))));
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - PAD - (v * (H - PAD * 2)) / max;

  const path = (key: string) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(Number(p[key as keyof TrendPoint])).toFixed(1)}`).join(" ");

  const first = points[0]?.date.slice(5);
  const last = points[points.length - 1]?.date.slice(5);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Daily ticket trend">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD} x2={W - PAD} y1={H * f} y2={H * f} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 4" />
        ))}
        {series.map((s) => (
          <g key={s.key}>
            <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) => (
              <circle key={i} cx={x(i)} cy={y(Number(p[s.key]))} r={Number(p[s.key]) > 0 ? 2.4 : 0} fill={s.color}>
                <title>{`${p.date}: ${p[s.key]} ${s.key}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--muted)", marginTop: 4 }}>
        <span>{first}</span>
        <span>max {max}/day</span>
        <span>{last}</span>
      </div>
    </div>
  );
}

function StackedBars({ points }: { points: TrendPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.slaMet + p.slaBreached));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 150 }}>
        {points.map((p) => {
          const total = p.slaMet + p.slaBreached;
          const height = (total / max) * 100;
          const metPct = total ? (p.slaMet / total) * 100 : 0;
          return (
            <div
              key={p.date}
              title={`${p.date}: ${p.slaMet} met · ${p.slaBreached} breached`}
              style={{ flex: 1, height: `${Math.max(height, total > 0 ? 6 : 0)}%`, display: "flex", flexDirection: "column", borderRadius: 3, overflow: "hidden", background: total ? undefined : "transparent" }}
            >
              <div style={{ height: `${100 - metPct}%`, background: "var(--danger-solid)", opacity: 0.9 }} />
              <div style={{ height: `${metPct}%`, background: "var(--success-solid)", opacity: 0.85 }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--muted)", marginTop: 4 }}>
        <span>{points[0]?.date.slice(5)}</span>
        <span>resolved tickets per day</span>
        <span>{points[points.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

/* =========================================================================
   Leaderboard
   ========================================================================= */

function Leaderboard({ items }: { items: { id: string; name: string; resolved: number; open: number }[] }) {
  const maxTotal = Math.max(1, ...items.map((a) => a.resolved + a.open));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((a, index) => {
        const total = a.resolved + a.open;
        const resolvedPct = total ? Math.round((a.resolved / total) * 100) : 0;
        const barPct = total ? Math.round((total / maxTotal) * 100) : 0;
        return (
          <div key={a.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  minWidth: 22,
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  color: "var(--muted)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <Avatar name={a.name} size={32} />
              <span style={{ fontSize: "0.86rem", fontWeight: 600, color: "var(--text)" }}>{a.name}</span>
            </div>
            <div style={{ minWidth: 140 }}>
              <div
                aria-hidden
                style={{
                  height: 10,
                  background: "var(--surface-3)",
                  borderRadius: 999,
                  overflow: "hidden",
                  display: "flex",
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
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <span
                className="badge"
                style={{
                  background: "var(--success-bg)",
                  color: "var(--success-fg)",
                  borderColor: "var(--success-border)",
                }}
              >
                {a.resolved} resolved
              </span>
              <span
                className="badge"
                style={{
                  background: "var(--info-bg)",
                  color: "var(--info-fg)",
                  borderColor: "var(--info-border)",
                }}
              >
                {a.open} open
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* =========================================================================
   Panel header
   ========================================================================= */

function PanelHeader({
  title,
  icon,
  right,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
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
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
      </div>
      {right}
    </div>
  );
}

/* =========================================================================
   Icons
   ========================================================================= */

const s = {
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

function BarChartIcon() {
  return (
    <svg {...s} width={13} height={13}>
      <path d="M3 3v18h18" />
      <path d="M7 14v4M11 10v8M15 6v12M19 2v16" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg {...s} width={14} height={14}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg {...s}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function InboxIcon() {
  return (
    <svg {...s}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg {...s}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg {...s}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg {...s}>
      <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg {...s}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function GaugeIcon() {
  return (
    <svg {...s}>
      <path d="M12 14l4-4" />
      <path d="M3 12a9 9 0 0 1 18 0" />
      <circle cx="12" cy="14" r="1.5" />
    </svg>
  );
}
function TimerIcon() {
  return (
    <svg {...s}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2M9 2h6" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg {...s}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function HourglassIcon() {
  return (
    <svg {...s}>
      <path d="M6 2h12M6 22h12M6 2v4a6 6 0 006 6 6 6 0 006-6V2M6 22v-4a6 6 0 016-6 6 6 0 016 6v4" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg {...s}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86l-8.14 14a2 2 0 001.71 3h16.28a2 2 0 001.71-3l-8.14-14a2 2 0 00-3.42 0z" />
    </svg>
  );
}
function HeartIcon() {
  return (
    <svg {...s}>
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  );
}
function BankIcon() {
  return (
    <svg {...s}>
      <path d="M3 21h18M4 21V10M20 21V10M6 21V10M18 21V10M10 21V10M14 21V10M2 10l10-7 10 7" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg {...s}>
      <path d="M20.59 13.41l-8.17 8.17a2 2 0 0 1-2.83 0L2 13.83V2h11.83l7.83 7.83a2 2 0 0 1 0 2.83z" />
      <circle cx="7" cy="7" r="1.5" />
    </svg>
  );
}
function TrophyIcon() {
  return (
    <svg {...s}>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z" />
      <path d="M17 4h3v3a3 3 0 01-3 3M7 4H4v3a3 3 0 003 3" />
    </svg>
  );
}

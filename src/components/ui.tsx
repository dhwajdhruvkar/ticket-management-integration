import type { CSSProperties, ReactNode } from "react";
import type {
  ImpactLevel,
  ResolutionDecision,
  TicketPriority,
  TicketStatus,
} from "@/server/domain/models";
import type { SlaLevel } from "@/server/services/slaService";
import { HINTS } from "@/lib/hints";
import { InfoHint, type HintSide } from "./InfoHint";

export { InfoHint, type HintSide };

// =============================================================================
// Shared presentation helpers.
//
// Small, dependency-free building blocks reused across pages and both server
// and client components: status/priority/SLA/decision badges (tone-mapped to
// the design tokens), the StatCard/ConfidenceBar/PipelineRow widgets, relative-
// time formatting (timeAgo/formatDuration), and audit-action labels. Keeping
// them here guarantees a ticket looks identical everywhere it appears.
// =============================================================================

type Tone = { label: string; bg: string; fg: string; border?: string };

// Status: a colored dot + label (no pill) for dense tables.
const STATUS_DOT: Record<TicketStatus, { label: string; color: string }> = {
  new: { label: "New", color: "var(--danger-solid)" },
  open: { label: "Open", color: "var(--danger-solid)" },
  in_progress: { label: "In progress", color: "var(--info-solid)" },
  pending: { label: "On hold", color: "var(--warning-solid)" },
  pending_agent: { label: "Pending", color: "var(--info-solid)" },
  escalated: { label: "Escalated", color: "var(--danger-solid)" },
  auto_resolved: { label: "Solved", color: "var(--success-solid)" },
  resolved: { label: "Resolved", color: "var(--success-solid)" },
  reopened: { label: "Reopened", color: "var(--warning-solid)" },
  closed: { label: "Closed", color: "var(--muted-soft)" },
  cancelled: { label: "Cancelled", color: "var(--muted-soft)" },
};

const DECISION_STYLES: Record<ResolutionDecision, Tone> = {
  auto_resolve: { label: "Auto-resolved", bg: "var(--success-bg)", fg: "var(--success-fg)", border: "var(--success-border)" },
  suggest: { label: "Drafted for agent", bg: "var(--warning-bg)", fg: "var(--warning-fg)", border: "var(--warning-border)" },
  escalate: { label: "Escalated", bg: "var(--danger-bg)", fg: "var(--danger-fg)", border: "var(--danger-border)" },
};

// P1 (critical) .. P5 (very_low) — ITIL priority scale.
const PRIORITY_STYLES: Record<TicketPriority, Tone> = {
  critical: { label: "critical", bg: "var(--danger-bg)", fg: "var(--danger-fg)", border: "var(--danger-border)" },
  high: { label: "high", bg: "var(--reopen-bg)", fg: "var(--reopen-fg)", border: "var(--reopen-border)" },
  medium: { label: "medium", bg: "var(--info-bg)", fg: "var(--info-fg)", border: "var(--info-border)" },
  low: { label: "low", bg: "var(--neutral-bg)", fg: "var(--neutral-fg)", border: "var(--neutral-border)" },
  very_low: { label: "very low", bg: "var(--neutral-bg)", fg: "var(--neutral-fg)", border: "var(--neutral-border)" },
};

const PRIORITY_CODE: Record<TicketPriority, string> = {
  critical: "P1",
  high: "P2",
  medium: "P3",
  low: "P4",
  very_low: "P5",
};

export const PRIORITIES: TicketPriority[] = ["critical", "high", "medium", "low", "very_low"];
export const IMPACT_LEVELS: ImpactLevel[] = ["low", "medium", "high"];

function pill(tone: Tone, children: ReactNode) {
  return (
    <span
      className="badge"
      style={{ background: tone.bg, color: tone.fg, borderColor: tone.border ?? "transparent" }}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  const s = STATUS_DOT[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: "0.78rem",
        fontWeight: 600,
        color: "var(--text-secondary)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{ width: 8, height: 8, borderRadius: 999, background: s.color, flexShrink: 0 }}
      />
      {s.label}
    </span>
  );
}

export function DecisionBadge({ decision }: { decision: ResolutionDecision }) {
  return pill(DECISION_STYLES[decision], DECISION_STYLES[decision].label);
}

export function PriorityBadge({ priority, hint }: { priority: TicketPriority; hint?: boolean }) {
  const tone = PRIORITY_STYLES[priority];
  return pill(
    tone,
    <>
      <strong style={{ fontWeight: 800, letterSpacing: "0.01em" }}>{PRIORITY_CODE[priority]}</strong>
      <span aria-hidden style={{ opacity: 0.55 }}>·</span>
      {tone.label}
      {hint ? <InfoHint text={HINTS.derivedPriority} size={11} /> : null}
    </>
  );
}

const SLA_HINTS: Record<SlaLevel, string> = {
  met: "This ticket was answered and resolved inside its SLA targets.",
  on_track: "Still comfortably inside the SLA window.",
  at_risk: HINTS.slaAtRisk,
  breached: HINTS.slaBreached,
};

const SLA_STYLES: Record<SlaLevel, Tone> = {
  met: { label: "Within SLA", bg: "var(--success-bg)", fg: "var(--success-fg)", border: "var(--success-border)" },
  on_track: { label: "On track", bg: "var(--info-bg)", fg: "var(--info-fg)", border: "var(--info-border)" },
  at_risk: { label: "At risk", bg: "var(--warning-bg)", fg: "var(--warning-fg)", border: "var(--warning-border)" },
  breached: { label: "Breached", bg: "var(--danger-bg)", fg: "var(--danger-fg)", border: "var(--danger-border)" },
};

export function SlaBadge({ level, paused, hint }: { level: SlaLevel; paused?: boolean; hint?: boolean }) {
  if (paused) {
    return pill(
      { label: "Paused", bg: "var(--neutral-bg)", fg: "var(--neutral-fg)", border: "var(--neutral-border)" },
      <>
        SLA paused
        {hint ? <InfoHint text={HINTS.slaPaused} size={11} /> : null}
      </>
    );
  }
  const tone = SLA_STYLES[level];
  const urgent = level === "at_risk" || level === "breached";
  return (
    <span
      className="badge"
      style={{ background: tone.bg, color: tone.fg, borderColor: tone.border ?? "transparent" }}
    >
      {urgent ? (
        <span
          aria-hidden
          className="pulse-attn"
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: level === "breached" ? "var(--danger-solid)" : "var(--warning-solid)",
            flexShrink: 0,
          }}
        />
      ) : null}
      {tone.label}
      {hint ? <InfoHint text={SLA_HINTS[level]} size={11} /> : null}
    </span>
  );
}

/** Human duration for SLA countdowns, e.g. 95 -> "1h 35m". */
export function formatDuration(mins: number): string {
  const abs = Math.abs(mins);
  const sign = mins < 0 ? "-" : "";
  if (abs < 60) return `${sign}${Math.round(abs)}m`;
  const h = Math.floor(abs / 60);
  const m = Math.round(abs % 60);
  if (h < 24) return `${sign}${h}h${m ? ` ${m}m` : ""}`;
  const d = Math.floor(h / 24);
  return `${sign}${d}d${h % 24 ? ` ${h % 24}h` : ""}`;
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.78
      ? "var(--success-solid)"
      : value >= 0.55
      ? "var(--warning-solid)"
      : "var(--danger-solid)";
  return (
    <div style={{ minWidth: 120 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
        <span className="muted" style={{ fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: 4 }}>
          confidence
          <InfoHint text={HINTS.aiConfidence} size={11} />
        </span>
        <span style={{ fontSize: "0.78rem", fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
          {pct}%
        </span>
      </div>
      <div
        style={{
          height: 6,
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

/** Wraps a label with an optional trailing InfoHint, keeping the two aligned. */
export function LabelWithHint({
  children,
  info,
  side = "top",
  size = 13,
  nested = false,
}: {
  children: ReactNode;
  info?: string;
  side?: HintSide;
  size?: number;
  nested?: boolean;
}) {
  if (!info) return <>{children}</>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 }}>
      {children}
      <InfoHint text={info} side={side} size={size} nested={nested} />
    </span>
  );
}

export function StatCard({
  label,
  value,
  sub,
  accent,
  info,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  info?: string;
}) {
  return (
    <div className="stat-card" style={{ minWidth: 0 }}>
      <div className="label">
        <LabelWithHint info={info}>{label}</LabelWithHint>
      </div>
      <div className="stat-value" style={{ marginTop: 8, color: accent ?? "var(--text)" }}>
        {value}
      </div>
      {sub ? (
        <div className="muted" style={{ marginTop: 6, fontSize: "0.8rem" }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  "ticket.ingested": "Ticket received",
  "ticket.retrieval": "Searched knowledge base",
  "ticket.decision.auto_resolve": "Decided: auto-resolve",
  "ticket.decision.suggest": "Decided: draft for agent",
  "ticket.decision.escalate": "Decided: escalate",
  "ticket.reply.sent": "Reply sent to requester",
  "ticket.reply.public": "Agent replied",
  "ticket.note.internal": "Internal note added",
  "ticket.closed": "Ticket closed",
  "ticket.suggestion.accepted": "Agent approved draft",
  "ticket.escalated.manual": "Agent escalated",
  "ticket.resolved.manual": "Agent resolved",
  "ticket.closed.manual": "Agent closed",
  "ticket.reopened.manual": "Ticket reopened",
  "ticket.assigned": "Ticket assigned",
  "ticket.routed": "Routed to a group",
  "ticket.updated": "Ticket details updated",
  "ticket.priority.overridden": "Priority manually overridden",
  "ticket.approval.requested": "Approval requested",
  "ticket.approval.approved": "Request approved",
  "ticket.approval.rejected": "Request rejected",
  "ticket.feedback.satisfied": "Requester confirmed resolved",
  "ticket.feedback.unsatisfied": "Requester reopened",
  "sla.at_risk": "SLA warning issued",
  "sla.breached": "SLA breached — escalated",
  "group.created": "Assignment group created",
  "kb.article.created": "Knowledge article added",
  "kb.article.updated": "Knowledge article updated",
  "kb.article.deleted": "Knowledge article removed",
};

/** Map a raw audit action code to a plain-English label (falls back to the code). */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* =========================================================
   Redesign primitives — additive, hook-free (server-safe)
   ========================================================= */

/** Small pill showing a trend arrow + text, e.g. "+12%". `tone` defaults from direction. */
export function TrendChip({
  direction,
  tone,
  children,
}: {
  direction: "up" | "down" | "flat";
  tone?: "good" | "bad" | "neutral";
  children: ReactNode;
}) {
  const resolved =
    tone ?? (direction === "up" ? "good" : direction === "down" ? "bad" : "neutral");
  const cls =
    resolved === "good" ? "trend-up" : resolved === "bad" ? "trend-down" : "trend-flat";
  return (
    <span className={`trend-chip ${cls}`}>
      {direction !== "flat" ? (
        <svg
          aria-hidden
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          style={{ transform: direction === "down" ? "rotate(180deg)" : undefined }}
        >
          <path
            d="M6 2.5v7M6 2.5 2.8 5.7M6 2.5l3.2 3.2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {children}
    </span>
  );
}

/** Tiny inline SVG sparkline for KPI cards. Values are auto-scaled to the box. */
export function Sparkline({
  points,
  color = "var(--brand-500)",
  width = 72,
  height = 24,
  fill = false,
}: {
  points: number[];
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
}) {
  if (!points.length) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 2;
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.join(" ");
  const area = `${pad},${height - pad} ${line} ${(pad + step * (points.length - 1)).toFixed(1)},${height - pad}`;
  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", overflow: "visible" }}
    >
      {fill ? <polygon points={area} fill={color} opacity={0.12} /> : null}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** SVG donut ring with centered content, per the SLA-compliance reference card. */
export function Donut({
  value,
  size = 128,
  stroke = 14,
  color = "var(--brand-600)",
  track = "var(--surface-3)",
  children,
}: {
  /** 0..1 fraction of the ring to fill. */
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * clamped).toFixed(2)} ${c.toFixed(2)}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 600ms var(--ease-out)" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Multi-segment donut/pie for distributions (e.g. requests by status). */
export function PieChart({
  data,
  size = 132,
  stroke = 16,
  track = "var(--surface-3)",
  children,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  stroke?: number;
  track?: string;
  children?: ReactNode;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {total > 0 &&
          data.map((d, i) => {
            if (d.value <= 0) return null;
            const len = (d.value / total) * c;
            const seg = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={stroke}
                strokeDasharray={`${len.toFixed(2)} ${(c - len).toFixed(2)}`}
                strokeDashoffset={(-offset).toFixed(2)}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ transition: "stroke-dasharray 600ms var(--ease-out)" }}
              />
            );
            offset += len;
            return seg;
          })}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Thin rounded progress bar (category breakdown / goals). */
export function MeterBar({
  value,
  color,
  height = 8,
}: {
  /** 0..1 fill fraction. */
  value: number;
  color?: string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="meter" style={{ height }}>
      <span
        className="bar-grow"
        style={{ width: `${pct}%`, background: color ?? undefined }}
      />
    </div>
  );
}

const AVATAR_TONES = [
  { bg: "var(--brand-100)", fg: "var(--brand-700)" },
  { bg: "var(--violet-bg)", fg: "var(--violet-fg)" },
  { bg: "var(--success-bg)", fg: "var(--success-fg)" },
  { bg: "var(--warning-bg)", fg: "var(--warning-fg)" },
  { bg: "var(--pink-bg)", fg: "var(--pink-fg)" },
  { bg: "var(--info-bg)", fg: "var(--info-fg)" },
];

/** Initials avatar with a stable tone derived from the name. */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const tone = AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 999,
        background: tone.bg,
        color: tone.fg,
        fontSize: size * 0.38,
        fontWeight: 750,
        letterSpacing: "0.02em",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {initials || "?"}
    </span>
  );
}

/** Panel header row: title on the left, optional action (e.g. "View All") on the right. */
export function SectionHeader({
  title,
  sub,
  action,
  info,
}: {
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  info?: string;
}) {
  return (
    <div className="section-head">
      <div style={{ minWidth: 0 }}>
        <div className="section-title">
          <LabelWithHint info={info}>{title}</LabelWithHint>
        </div>
        {sub ? (
          <div className="muted" style={{ fontSize: "0.76rem", marginTop: 2 }}>
            {sub}
          </div>
        ) : null}
      </div>
      {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
    </div>
  );
}

/** Four-point sparkle used to mark AI-generated content. */
export function SparkleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.5c.5 2.6 1.6 3.7 4.2 4.2.4.1.4.5 0 .6C9.6 6.8 8.5 7.9 8 10.5c-.1.4-.5.4-.6 0C6.9 7.9 5.8 6.8 3.2 6.3c-.4-.1-.4-.5 0-.6C5.8 5.2 6.9 4.1 7.4 1.5c.1-.4.5-.4.6 0Z" />
      <path d="M12.6 9.8c.3 1.5 1 2.2 2.4 2.4.3.1.3.4 0 .5-1.4.3-2.1 1-2.4 2.4-.1.3-.4.3-.5 0-.3-1.4-1-2.1-2.4-2.4-.3-.1-.3-.4 0-.5 1.4-.2 2.1-.9 2.4-2.4.1-.3.4-.3.5 0Z" opacity={0.7} />
    </svg>
  );
}

/** Violet-tinted panel for AI output, with sparkle header and optional confidence chip. */
export function AIPanel({
  title,
  confidence,
  action,
  children,
  style,
  info,
}: {
  title: ReactNode;
  /** 0..1 — renders a "NN% Confidence"-style chip when provided. */
  confidence?: number;
  action?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  info?: string;
}) {
  return (
    <div className="ai-panel" style={{ padding: "0.95rem 1.05rem", ...style }}>
      <div className="flex items-center justify-between" style={{ gap: 8, marginBottom: 8 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: "0.8rem",
            fontWeight: 750,
            color: "var(--ai-fg)",
          }}
        >
          <SparkleIcon />
          {title}
          {info ? <InfoHint text={info} /> : null}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {typeof confidence === "number" ? (
            <span
              className="badge"
              style={{
                background: "var(--surface)",
                color: "var(--ai-fg)",
                borderColor: "var(--ai-border)",
              }}
            >
              {Math.round(confidence * 100)}% confidence
              <InfoHint text={HINTS.aiConfidence} side="left" size={12} />
            </span>
          ) : null}
          {action}
        </span>
      </div>
      <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.55 }}>
        {children}
      </div>
    </div>
  );
}

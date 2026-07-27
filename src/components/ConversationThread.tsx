"use client";

import { useEffect, useRef, useState } from "react";
import { apiSend } from "@/lib/api";
import type { TicketView } from "@/server/services/ticketService";
import type { MessageAuthorKind, MessageVisibility } from "@/server/domain/models";
import type { TypingUser } from "@/lib/liveTicket";
import { timeAgo } from "./ui";

// =============================================================================
// ConversationThread
//
// Renders a ticket as a chat-style thread: the original request first, then
// every message in order. Agents see internal notes (visually distinct);
// requesters see public messages only. Live extras: "X is typing…" bubbles
// (fed by SSE via useTicketLive) and auto-scroll to new activity.
// =============================================================================

interface Bubble {
  key: string;
  authorKind: MessageAuthorKind;
  authorName: string;
  visibility: MessageVisibility;
  body: string;
  at: string;
}

/** Nearest scrollable ancestor (the conversation pane has overflow:auto). */
function scrollParentOf(node: HTMLElement | null): HTMLElement | null {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return null;
}

export default function ConversationThread({
  ticket,
  viewerRole,
  typing = [],
}: {
  ticket: TicketView;
  viewerRole: "agent" | "requester";
  typing?: TypingUser[];
}) {
  const root: Bubble = {
    key: "root",
    authorKind: "requester",
    authorName: ticket.requesterEmail,
    visibility: "public",
    body: ticket.body,
    at: ticket.createdAt,
  };

  const rest: Bubble[] = ticket.messages.map((m) => ({
    key: m.id,
    authorKind: m.authorKind,
    authorName: m.authorName,
    visibility: m.visibility,
    body: m.body,
    at: m.createdAt,
  }));

  const bubbles = [root, ...rest].filter(
    (b) => viewerRole === "agent" || b.visibility === "public"
  );

  const typers = typing.filter((t) => viewerRole === "agent" || t.visibility === "public");

  // Auto-scroll: jump to the latest message on mount; on new messages/typing,
  // follow only when the viewer is already near the bottom (don't yank someone
  // who scrolled up to read history).
  const endRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    const end = endRef.current;
    if (!end) return;
    const pane = scrollParentOf(end);
    if (!pane) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      pane.scrollTop = pane.scrollHeight;
      return;
    }
    const nearBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 160;
    if (nearBottom) end.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [bubbles.length, typers.length]);

  return (
    <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {bubbles.map((b) => (
        <MessageBubble
          key={b.key}
          bubble={b}
          ticketId={ticket.id}
          own={viewerRole === "requester" && b.authorKind === "requester"}
        />
      ))}
      {typers.map((t) => (
        <TypingBubble key={t.key} typer={t} />
      ))}
      <div ref={endRef} aria-hidden />
    </div>
  );
}

/** Chat-style "X is typing…" row with animated dots. */
function TypingBubble({ typer }: { typer: TypingUser }) {
  const isInternal = typer.visibility === "internal";
  const tone = bubbleTone(typer.kind, isInternal);
  return (
    <div className="anim-fade-in" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 999,
          flexShrink: 0,
          background: tone.avatarBg,
          color: tone.avatarFg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.68rem",
          fontWeight: 800,
          letterSpacing: "0.02em",
        }}
      >
        {tone.icon}
      </div>
      <div>
        <div className="flex items-center" style={{ gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>{typer.name}</span>
          <span className="muted" style={{ fontSize: "0.68rem" }}>
            {isInternal ? "typing an internal note…" : "typing…"}
          </span>
        </div>
        <div
          style={{
            display: "inline-flex",
            padding: "0.65rem 0.85rem",
            borderRadius: 14,
            borderTopLeftRadius: 4,
            background: tone.bubbleBg,
            border: `1px solid ${tone.bubbleBorder}`,
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <span className="typing-dots" aria-label={`${typer.name} is typing`}>
            <span />
            <span />
            <span />
          </span>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ bubble, ticketId, own }: { bubble: Bubble; ticketId: string; own?: boolean }) {
  const isInternal = bubble.visibility === "internal";
  const tone = bubbleTone(bubble.authorKind, isInternal);

  // Requesters see their own messages as right-aligned solid-blue chat bubbles.
  if (own) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <div
          style={{
            maxWidth: "min(78%, 560px)",
            padding: "0.7rem 0.9rem",
            borderRadius: 14,
            borderBottomRightRadius: 4,
            background: "var(--brand-gradient)",
            color: "#ffffff",
            fontSize: "0.9rem",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          {bubble.body}
        </div>
        <div className="muted" style={{ fontSize: "0.68rem", marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
          You · {timeAgo(bubble.at)}
          <TranslateControl ticketId={ticketId} text={bubble.body} align="right" />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 999,
          flexShrink: 0,
          background: tone.avatarBg,
          color: tone.avatarFg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.68rem",
          fontWeight: 800,
          letterSpacing: "0.02em",
          boxShadow: tone.shadow,
        }}
      >
        {tone.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center" style={{ gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>{bubble.authorName}</span>
          <span className="muted" style={{ fontSize: "0.68rem" }}>
            {tone.roleLabel} · {timeAgo(bubble.at)}
          </span>
          {isInternal ? (
            <span
              className="badge"
              style={{
                background: "var(--warning-bg)",
                color: "var(--warning-fg)",
                borderColor: "var(--warning-border)",
                fontSize: "0.62rem",
              }}
            >
              Internal note
            </span>
          ) : null}
        </div>
        <div
          style={{
            padding: "0.7rem 0.9rem",
            borderRadius: 14,
            borderTopLeftRadius: 4,
            background: tone.bubbleBg,
            // Per-side values (not the `border` shorthand): mixing it with a
            // conditional borderLeft makes React warn on rerender.
            borderTop: `1px solid ${tone.bubbleBorder}`,
            borderRight: `1px solid ${tone.bubbleBorder}`,
            borderBottom: `1px solid ${tone.bubbleBorder}`,
            borderLeft: isInternal ? `3px solid var(--warning-solid)` : `1px solid ${tone.bubbleBorder}`,
            fontSize: "0.9rem",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            color: "var(--text)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          {bubble.body}
        </div>
        <div style={{ marginTop: 4 }}>
          <TranslateControl ticketId={ticketId} text={bubble.body} align="left" />
        </div>
      </div>
    </div>
  );
}

/** Inline "Translate" affordance for a message bubble. */
function TranslateControl({ ticketId, text, align }: { ticketId: string; text: string; align: "left" | "right" }) {
  const [lang, setLang] = useState("English");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function translate() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ translated: string }>(`/tickets/${ticketId}/translate`, "POST", {
        text,
        targetLang: lang,
      });
      setResult(res.translated);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const btnStyle: React.CSSProperties = {
    border: "none",
    background: "transparent",
    color: "var(--muted)",
    cursor: "pointer",
    fontSize: "0.68rem",
    fontWeight: 600,
    padding: 0,
    textDecoration: "underline",
  };

  if (!open) {
    return (
      <button type="button" style={btnStyle} onClick={() => setOpen(true)}>
        Translate
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align === "right" ? "flex-end" : "flex-start", gap: 4 }}>
      <div className="flex items-center" style={{ gap: 6 }}>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          disabled={busy}
          aria-label="Translate to language"
          style={{ fontSize: "0.68rem", padding: "1px 4px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
        >
          {["English", "Hindi", "Spanish", "French", "German"].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <button type="button" style={btnStyle} disabled={busy} onClick={translate}>
          {busy ? "Translating…" : "Go"}
        </button>
        {result != null ? (
          <button type="button" style={btnStyle} onClick={() => setResult(null)}>
            Hide
          </button>
        ) : null}
      </div>
      {error ? (
        <div style={{ fontSize: "0.72rem", color: "var(--danger-fg)", maxWidth: "min(78%, 560px)" }}>
          Translation failed: {error}
        </div>
      ) : null}
      {result != null ? (
        <div
          style={{
            fontSize: "0.82rem",
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.5rem 0.65rem",
            whiteSpace: "pre-wrap",
            maxWidth: "min(78%, 560px)",
          }}
        >
          {result}
        </div>
      ) : null}
    </div>
  );
}

function NoteGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function SparkGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </svg>
  );
}

function bubbleTone(kind: Bubble["authorKind"], isInternal: boolean): {
  icon: React.ReactNode;
  roleLabel: string;
  avatarBg: string;
  avatarFg: string;
  bubbleBg: string;
  bubbleBorder: string;
  shadow: string;
} {
  if (isInternal) {
    return {
      icon: <NoteGlyph />,
      roleLabel: "Internal",
      avatarBg: "var(--note-bg)",
      avatarFg: "var(--warning-fg)",
      bubbleBg: "var(--note-bg)",
      bubbleBorder: "var(--note-border)",
      shadow: "none",
    };
  }
  switch (kind) {
    case "assistant":
      return {
        icon: <SparkGlyph />,
        roleLabel: "Assistant",
        avatarBg: "var(--brand-gradient)",
        avatarFg: "#fff",
        bubbleBg: "var(--brand-50)",
        bubbleBorder: "var(--brand-100)",
        shadow: "none",
      };
    case "agent":
      return {
        icon: "AG",
        roleLabel: "Agent",
        avatarBg: "var(--info-bg)",
        avatarFg: "var(--info-fg)",
        bubbleBg: "var(--surface)",
        bubbleBorder: "var(--border)",
        shadow: "none",
      };
    case "system":
      return {
        icon: "·",
        roleLabel: "System",
        avatarBg: "var(--surface-3)",
        avatarFg: "var(--muted)",
        bubbleBg: "var(--surface)",
        bubbleBorder: "var(--border)",
        shadow: "none",
      };
    case "requester":
    default:
      return {
        icon: "RQ",
        roleLabel: "Requester",
        avatarBg: "var(--surface-3)",
        avatarFg: "var(--text-secondary)",
        bubbleBg: "var(--surface)",
        bubbleBorder: "var(--border)",
        shadow: "none",
      };
  }
}

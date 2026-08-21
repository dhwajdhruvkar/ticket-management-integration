"use client";

import { useEffect, useState } from "react";
import { apiGetAll, apiSend } from "@/lib/api";
import { useTypingPing } from "@/lib/liveTicket";
import type { TicketView } from "@/server/services/ticketService";
import type { MacroRow, MessageVisibility, TicketRow } from "@/server/domain/models";
import { useToast } from "./Toast";
import { PromptDialog } from "./primitives";
import { LabelWithHint } from "./ui";
import { HINTS } from "@/lib/hints";

/** Substitute macro placeholders using the ticket in context. */
function fillMacro(body: string, ticket: TicketView): string {
  const requesterName = ticket.requesterEmail.split("@")[0]?.replace(/[._-]+/g, " ") ?? ticket.requesterEmail;
  return body
    .replace(/\{\{\s*requester_name\s*\}\}/gi, requesterName)
    .replace(/\{\{\s*reference\s*\}\}/gi, ticket.reference)
    .replace(/\{\{\s*subject\s*\}\}/gi, ticket.subject);
}

// =============================================================================
// TicketComposer — Zendesk-style docked composer.
//
// Public reply / Internal note tabs (note turns the surface yellow), a textarea,
// and a submit bar whose primary action depends on the ticket's state. All
// actions go through the /api/v1 ticket routes.
// =============================================================================

export default function TicketComposer({
  ticket,
  onChanged,
}: {
  ticket: TicketView;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<MessageVisibility>("public");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [macros, setMacros] = useState<MacroRow[]>([]);
  const [showMacros, setShowMacros] = useState(false);
  const [targetLang, setTargetLang] = useState("Hindi");
  const [escalating, setEscalating] = useState(false);
  const toast = useToast();
  const pingTyping = useTypingPing(ticket.id);

  useEffect(() => {
    apiGetAll<MacroRow>("/macros").then(setMacros).catch(() => setMacros([]));
  }, []);

  function insertMacro(macro: MacroRow) {
    const filled = fillMacro(macro.body, ticket);
    setBody((prev) => (prev.trim() ? `${prev}\n\n${filled}` : filled));
    setShowMacros(false);
  }

  function translateDraft() {
    if (!body.trim()) return;
    void run(
      "translate",
      async () => {
        const res = await apiSend<{ translated: string }>(`/tickets/${ticket.id}/translate`, "POST", {
          text: body,
          targetLang,
        });
        setBody(res.translated);
      },
      () => toast.success({ title: `Translated to ${targetLang}` }),
      "Could not translate"
    );
  }

  const active = ["new", "open", "in_progress", "pending", "pending_agent", "escalated", "reopened"].includes(
    ticket.status
  );
  const canRerun = ["open", "in_progress", "escalated", "reopened"].includes(ticket.status);
  const isSuggest = ticket.status === "pending_agent";
  // Any live ticket can hit a wall, not just one the AI drafted; already-
  // escalated tickets are excluded so the reason is not overwritten.
  const canEscalate = active && ticket.status !== "escalated";
  const isResolved = ["closed", "auto_resolved", "resolved", "cancelled"].includes(ticket.status);
  const hasText = body.trim().length > 0;

  async function run(key: string, fn: () => Promise<unknown>, ok: () => void, fail: string) {
    setBusy(key);
    try {
      await fn();
      onChanged();
      ok();
    } catch (err) {
      toast.error({ title: fail, description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  const action = (payload: Record<string, unknown>) =>
    apiSend<TicketRow>(`/tickets/${ticket.id}/actions`, "POST", payload);

  function send() {
    run(
      "send",
      () => apiSend(`/tickets/${ticket.id}/messages`, "POST", { body, visibility: tab }),
      () => {
        setBody("");
        toast.success({
          title: tab === "public" ? "Reply sent" : "Note added",
          description: tab === "public" ? "Delivered to the requester." : "Saved as an internal note.",
        });
      },
      "Could not post message"
    );
  }

  function submitSolved() {
    run(
      "solve",
      async () => {
        if (hasText && tab === "internal") {
          await apiSend(`/tickets/${ticket.id}/messages`, "POST", { body, visibility: "internal" });
          await action({ action: "resolve" });
        } else {
          await action({
            action: "resolve",
            reply: hasText ? body : undefined,
            resolutionNotes: hasText ? body : undefined,
          });
        }
      },
      () => {
        setBody("");
        toast.success({ title: "Submitted as Solved", description: "Ticket resolved — the requester was notified." });
      },
      "Could not resolve ticket"
    );
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
      <div className="flex items-center" style={{ gap: 4, padding: "0.5rem 0.9rem 0" }}>
        <Tab label="Public reply" active={tab === "public"} onClick={() => setTab("public")} info={HINTS.publicReply} />
        <Tab
          label="Internal note"
          active={tab === "internal"}
          onClick={() => setTab("internal")}
          info={HINTS.internalNote}
        />
      </div>

      <div style={{ padding: "0.6rem 0.9rem 0.9rem" }}>
        <textarea
          className={`textarea${tab === "internal" ? " note-surface" : ""}`}
          rows={3}
          placeholder={tab === "public" ? "Write a reply to the requester" : "Add a private note for agents"}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            if (e.target.value.trim()) pingTyping(tab);
          }}
          disabled={isResolved && !active}
        />

        <div className="flex items-center justify-between" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <div className="flex items-center" style={{ gap: 8, flexWrap: "wrap" }}>
            {active && macros.length > 0 ? (
              <div style={{ position: "relative" }}>
                <button
                  className="btn btn-ghost"
                  disabled={!!busy}
                  onClick={() => setShowMacros((s) => !s)}
                  aria-haspopup="menu"
                  aria-expanded={showMacros}
                >
                  Macros ▾
                </button>
                {showMacros ? (
                  <>
                    <div onClick={() => setShowMacros(false)} style={{ position: "fixed", inset: 0, zIndex: 39 }} aria-hidden />
                    <div
                      role="menu"
                      style={{
                        position: "absolute",
                        bottom: "calc(100% + 6px)",
                        left: 0,
                        width: "min(320px, 80vw)",
                        maxHeight: 260,
                        overflow: "auto",
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--r-lg)",
                        boxShadow: "var(--shadow-lg)",
                        padding: 6,
                        zIndex: 40,
                      }}
                    >
                      {macros.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          role="menuitem"
                          onClick={() => insertMacro(m)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            padding: "0.5rem 0.55rem",
                            borderRadius: 9,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                            {m.name}
                            <span className="badge" style={{ fontSize: "0.56rem", background: m.visibility === "internal" ? "var(--warning-bg)" : "var(--info-bg)", color: m.visibility === "internal" ? "var(--warning-fg)" : "var(--info-fg)", borderColor: m.visibility === "internal" ? "var(--warning-border)" : "var(--info-border)" }}>
                              {m.visibility === "internal" ? "Note" : "Reply"}
                            </span>
                          </div>
                          <div className="muted" style={{ fontSize: "0.7rem", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {m.body}
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
            {active ? (
              <div className="flex items-center" style={{ gap: 4 }}>
                <select
                  className="select"
                  value={targetLang}
                  disabled={!!busy}
                  onChange={(e) => setTargetLang(e.target.value)}
                  style={{ height: 34, fontSize: "0.76rem", padding: "0 6px" }}
                  aria-label="Translation target language"
                >
                  {["Hindi", "English", "Spanish", "French", "German"].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <button className="btn btn-ghost" disabled={!!busy || !hasText} onClick={translateDraft}>
                  {busy === "translate" ? "Translating…" : "Translate"}
                </button>
              </div>
            ) : null}
            {canRerun ? (
              <button
                className="btn btn-ghost"
                disabled={!!busy}
                onClick={() =>
                  run(
                    "rerun",
                    async () => {
                      const u = await action({ action: "run_ai" });
                      if (u.status === "auto_resolved") toast.success({ title: "Auto-resolved" });
                      else if (u.status === "pending_agent") toast.info({ title: "Draft ready" });
                      else toast.warning({ title: "Escalated" });
                    },
                    () => {},
                    "Could not run auto-resolution"
                  )
                }
                aria-label={`Run AI. ${HINTS.runAi}`}
              >
                <LabelWithHint info={HINTS.runAi} size={12} nested>
                  {busy === "rerun" ? "Running…" : "Run AI"}
                </LabelWithHint>
              </button>
            ) : null}
            {isSuggest ? (
              <button
                className="btn btn-ghost"
                disabled={!!busy}
                onClick={() =>
                  run(
                    "accept",
                    () => action({ action: "accept_suggestion" }),
                    () => toast.success({ title: "Draft sent", description: "Ticket resolved." }),
                    "Could not send draft"
                  )
                }
                aria-label={`Approve draft. ${HINTS.approveDraft}`}
              >
                <LabelWithHint info={HINTS.approveDraft} size={12} nested>
                  Approve draft
                </LabelWithHint>
              </button>
            ) : null}
            {canEscalate ? (
              <button
                className="btn btn-ghost"
                disabled={!!busy}
                onClick={() => setEscalating(true)}
                aria-label={`Escalate. ${HINTS.escalate}`}
              >
                <LabelWithHint info={HINTS.escalate} size={12} nested>
                  Escalate
                </LabelWithHint>
              </button>
            ) : null}
            {active && ticket.status !== "pending" ? (
              <button
                className="btn btn-ghost"
                disabled={!!busy}
                onClick={() =>
                  run(
                    "hold",
                    () => apiSend(`/tickets/${ticket.id}`, "PATCH", { status: "pending" }),
                    () => toast.info({ title: "Put on hold", description: "The SLA clock is paused while waiting." }),
                    "Could not put on hold"
                  )
                }
                aria-label={`On hold. ${HINTS.onHold}`}
              >
                <LabelWithHint info={HINTS.onHold} size={12} nested>
                  On hold
                </LabelWithHint>
              </button>
            ) : null}
            {active ? (
              <button
                className="btn btn-ghost"
                disabled={!!busy}
                onClick={() =>
                  run(
                    "close",
                    () => action({ action: "close" }),
                    () => toast.info({ title: "Ticket closed" }),
                    "Could not close ticket"
                  )
                }
              >
                Close
              </button>
            ) : null}
          </div>

          <div className="flex items-center" style={{ gap: 8 }}>
            {active ? (
              <>
                <button className="btn btn-ghost" disabled={!!busy || !hasText} onClick={send}>
                  {busy === "send" ? "Sending…" : "Send"}
                </button>
                <button className="btn btn-primary" disabled={!!busy} onClick={submitSolved}>
                  {busy === "solve" ? "Submitting…" : "Submit as Solved"}
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary"
                disabled={!!busy}
                onClick={() =>
                  run(
                    "reopen",
                    () => action({ action: "reopen" }),
                    () => toast.warning({ title: "Reopened", description: "Back in the active queue." }),
                    "Could not reopen"
                  )
                }
              >
                {busy === "reopen" ? "Reopening…" : "Reopen ticket"}
              </button>
            )}
          </div>
        </div>
      </div>

      <PromptDialog
        open={escalating}
        title="Escalate for reassignment"
        description="Every dispatcher is notified and the ticket moves to the top of their triage board. Explain what you tried and where you got stuck so the next person does not start over."
        label="Why can you not resolve this?"
        placeholder="e.g. Needs domain admin rights on the AD server, which I do not have."
        confirmLabel="Escalate"
        required
        multiline
        busy={busy === "esc"}
        onCancel={() => setEscalating(false)}
        onConfirm={(reason) =>
          run(
            "esc",
            () => action({ action: "escalate", reason }),
            () => {
              setEscalating(false);
              toast.info({ title: "Escalated", description: "Dispatchers have been notified." });
            },
            "Could not escalate"
          )
        }
      />
    </div>
  );
}

function Tab({
  label,
  active,
  onClick,
  info,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  info?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "0.45rem 0.8rem",
        fontSize: "0.8rem",
        fontWeight: 700,
        cursor: "pointer",
        borderTop: "none",
        borderRight: "none",
        borderLeft: "none",
        background: "transparent",
        color: active ? "var(--brand-700)" : "var(--muted)",
        borderBottom: `2px solid ${active ? "var(--brand-600)" : "transparent"}`,
        transition: "color 0.15s ease, border-color 0.15s ease",
      }}
      aria-pressed={active}
      aria-label={info ? `${label}. ${info}` : undefined}
    >
      <LabelWithHint info={info} side="right" size={12} nested>
        {label}
      </LabelWithHint>
    </button>
  );
}

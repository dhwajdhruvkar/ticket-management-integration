"use client";

// =============================================================================
// RequesterReplyBox — the reply composer on the requester's ticket view.
//
// A focused textarea for requesters to add a public reply (or confirm/reopen a
// resolved ticket). Posts the message via the ticket messages API, emits typing
// pings for the live agent view, and calls onChanged so the thread refreshes.
// =============================================================================

import { useState } from "react";
import { apiSend } from "@/lib/api";
import { useTypingPing } from "@/lib/liveTicket";
import type { TicketView } from "@/server/services/ticketService";
import { useToast } from "./Toast";

export default function RequesterReplyBox({
  ticket,
  onChanged,
}: {
  ticket: TicketView;
  onChanged: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const pingTyping = useTypingPing(ticket.id);

  const isResolved = ["closed", "auto_resolved", "resolved"].includes(ticket.status);
  const showCsat = isResolved && !ticket.satisfaction;

  async function run(key: string, fn: () => Promise<unknown>, onOk: () => void, fail: string) {
    setBusy(key);
    try {
      await fn();
      onChanged();
      onOk();
    } catch (err) {
      toast.error({ title: fail, description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {showCsat ? (
        <div
          className="panel-2"
          style={{ padding: "0.9rem 1rem", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
        >
          <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>Did this resolve your issue?</span>
          <div className="flex items-center" style={{ gap: 8 }}>
            <button
              className="btn btn-ghost"
              disabled={!!busy}
              style={{ color: "var(--success-fg)" }}
              onClick={() =>
                run(
                  "sat",
                  () => apiSend(`/tickets/${ticket.id}/actions`, "POST", { action: "feedback", satisfaction: "satisfied" }),
                  () => toast.success({ title: "Thanks for confirming", description: "Glad we could help." }),
                  "Could not record feedback"
                )
              }
            >
              <CheckIcon /> Yes, resolved
            </button>
            <button
              className="btn btn-ghost"
              disabled={!!busy}
              onClick={() =>
                run(
                  "unsat",
                  () => apiSend(`/tickets/${ticket.id}/actions`, "POST", { action: "feedback", satisfaction: "unsatisfied" }),
                  () => toast.warning({ title: "Reopened", description: "We'll take another look." }),
                  "Could not reopen"
                )
              }
            >
              <RotateIcon /> Not yet
            </button>
          </div>
        </div>
      ) : null}

      {ticket.satisfaction === "satisfied" ? (
        <p className="muted" style={{ fontSize: "0.84rem" }}>
          You confirmed this request was resolved.
        </p>
      ) : null}

      <div>
        <textarea
          className="textarea"
          rows={3}
          placeholder="Add a reply"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            if (e.target.value.trim()) pingTyping();
          }}
        />
        <div className="flex items-center" style={{ gap: 8, marginTop: 10 }}>
          <button
            className="btn btn-primary"
            disabled={!!busy || !body.trim()}
            onClick={() =>
              run(
                "reply",
                () => apiSend(`/tickets/${ticket.id}/messages`, "POST", { body, asRequester: true }),
                () => {
                  setBody("");
                  toast.success({ title: "Reply sent", description: "Your message was added to the request." });
                },
                "Could not send reply"
              )
            }
          >
            {busy === "reply" ? "Sending…" : "Send reply"}
          </button>
        </div>
      </div>
    </div>
  );
}

const feedbackIcon = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function CheckIcon() {
  return (
    <svg {...feedbackIcon}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg {...feedbackIcon} strokeWidth={2}>
      <path d="M3 2v6h6" />
      <path d="M21 12A9 9 0 0 0 6 5.3L3 8" />
    </svg>
  );
}

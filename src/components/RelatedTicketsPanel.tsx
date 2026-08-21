"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGetAll, apiSend } from "@/lib/api";
import type { TicketView } from "@/server/services/ticketService";
import type { TicketRow } from "@/server/domain/models";
import { useToast } from "./Toast";

// =============================================================================
// RelatedTicketsPanel — link/unlink related tickets and merge duplicates.
//
// Mirrors the Problems page linked-incidents pattern. Merging re-parents the
// source's messages onto the target and cancels the source (server-side); the
// source then shows a banner pointing at its merge target.
// =============================================================================

export default function RelatedTicketsPanel({
  ticket,
  onChanged,
}: {
  ticket: TicketView;
  onChanged: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [all, setAll] = useState<TicketRow[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGetAll<TicketRow>("/tickets").then(setAll).catch(() => setAll([]));
  }, []);

  useEffect(() => {
    load();
  }, [load, ticket.id, ticket.linkedTicketIds.length]);

  const byId = new Map(all.map((t) => [t.id, t]));
  const linked = ticket.linkedTicketIds.map((id) => byId.get(id)).filter((t): t is TicketRow => !!t);
  const candidates = all.filter(
    (t) => t.id !== ticket.id && !ticket.linkedTicketIds.includes(t.id) && !t.mergedIntoId
  );
  const mergedTarget = ticket.mergedIntoId ? byId.get(ticket.mergedIntoId) : null;

  async function run(fn: () => Promise<unknown>, ok: string, fail: string) {
    setBusy(true);
    try {
      await fn();
      onChanged();
      load();
      toast.success({ title: ok });
    } catch (err) {
      toast.error({ title: fail, description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  function link() {
    if (!pick) return;
    void run(
      () => apiSend(`/tickets/${ticket.id}/links`, "POST", { ticketId: pick, action: "link" }),
      "Ticket linked",
      "Could not link ticket"
    ).then(() => setPick(""));
  }

  function unlink(id: string) {
    void run(
      () => apiSend(`/tickets/${ticket.id}/links`, "POST", { ticketId: id, action: "unlink" }),
      "Ticket unlinked",
      "Could not unlink"
    );
  }

  function merge() {
    if (!pick) return;
    const target = byId.get(pick);
    if (!target) return;
    if (!confirm(`Merge this ticket into ${target.reference}? This ticket's messages move there and this one is cancelled.`)) return;
    void run(
      () => apiSend(`/tickets/${ticket.id}/merge`, "POST", { targetId: pick }),
      `Merged into ${target.reference}`,
      "Could not merge"
    ).then(() => setPick(""));
  }

  const isMerged = !!ticket.mergedIntoId;

  return (
    <div style={{ margin: "1.25rem 0 0" }}>
      <div className="label" style={{ marginBottom: 10 }}>
        Related tickets
      </div>

      {isMerged ? (
        <div
          style={{
            padding: "0.7rem 0.85rem",
            borderRadius: 10,
            border: "1px solid var(--warning-border)",
            background: "var(--warning-bg)",
            color: "var(--warning-fg)",
            fontSize: "0.8rem",
            marginBottom: 10,
          }}
        >
          This ticket was merged into{" "}
          {mergedTarget ? (
            <button
              type="button"
              onClick={() => router.push(`/tickets/${mergedTarget.id}`)}
              style={{ border: "none", background: "transparent", color: "inherit", fontWeight: 800, textDecoration: "underline", cursor: "pointer", padding: 0 }}
            >
              {mergedTarget.reference}
            </button>
          ) : (
            "another ticket"
          )}
          .
        </div>
      ) : null}

      {linked.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {linked.map((t) => (
            <div key={t.id} className="panel-2 flex items-center justify-between" style={{ padding: "0.5rem 0.7rem", gap: 8 }}>
              <button
                type="button"
                onClick={() => router.push(`/tickets/${t.id}`)}
                style={{ border: "none", background: "transparent", textAlign: "left", cursor: "pointer", minWidth: 0, padding: 0 }}
              >
                <div className="mono" style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{t.reference}</div>
                <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                  {t.subject}
                </div>
              </button>
              {!isMerged ? (
                <button className="btn btn-ghost" style={{ fontSize: "0.7rem", padding: "0.25rem 0.5rem" }} disabled={busy} onClick={() => unlink(t.id)}>
                  Unlink
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 10px" }}>
          No related tickets.
        </p>
      )}

      {!isMerged ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <select className="select" value={pick} disabled={busy} onChange={(e) => setPick(e.target.value)}>
            <option value="">Select a ticket…</option>
            {candidates.slice(0, 200).map((t) => (
              <option key={t.id} value={t.id}>
                {t.reference} — {t.subject.slice(0, 50)}
              </option>
            ))}
          </select>
          <div className="flex items-center" style={{ gap: 8 }}>
            <button className="btn btn-ghost" style={{ fontSize: "0.76rem" }} disabled={busy || !pick} onClick={link}>
              Link
            </button>
            <button className="btn btn-ghost" style={{ fontSize: "0.76rem", color: "var(--danger-fg)" }} disabled={busy || !pick} onClick={merge}>
              Merge into…
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

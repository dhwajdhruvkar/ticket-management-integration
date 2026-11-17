"use client";

import { useConfirm } from "@/components/primitives";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiGetPage, apiSend } from "@/lib/api";
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
  const { confirm, confirmDialog } = useConfirm();
  const router = useRouter();
  // Titles of the tickets already linked/merged (a few GETs, only when there are any).
  const [known, setKnown] = useState<Record<string, Pick<TicketRow, "id" | "reference" | "subject">>>({});
  // Candidates come from a server-side search, and only once the picker is used.
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<TicketRow[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  const wantedIds = [...ticket.linkedTicketIds, ...(ticket.mergedIntoId ? [ticket.mergedIntoId] : [])];
  const wantedKey = wantedIds.join(",");
  useEffect(() => {
    let live = true;
    for (const id of wantedKey ? wantedKey.split(",") : []) {
      apiGet<TicketView>(`/tickets/${id}`)
        .then((row) => { if (live) setKnown((prev) => ({ ...prev, [id]: { id: row.id, reference: row.reference, subject: row.subject } })); })
        .catch(() => {});
    }
    return () => { live = false; };
  }, [wantedKey]);

  // Debounced search (~250 ms) through the existing list endpoint; the server applies tenant and requester scoping.
  useEffect(() => {
    const text = search.trim();
    if (text.length < 2) { setResults([]); return; }
    let live = true;
    const timer = setTimeout(() => {
      apiGetPage<TicketRow>(`/tickets?view=all&q=${encodeURIComponent(text)}&page=1&pageSize=10`)
        .then(({ data }) => { if (live) setResults(data); })
        .catch(() => { if (live) setResults([]); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [search]);

  const linked = ticket.linkedTicketIds.map((id) => known[id]).filter((t): t is NonNullable<typeof t> => !!t);
  const candidates = results.filter((t) => t.id !== ticket.id && !ticket.linkedTicketIds.includes(t.id) && !t.mergedIntoId);
  const mergedTarget = ticket.mergedIntoId ? known[ticket.mergedIntoId] : null;

  async function run(fn: () => Promise<unknown>, ok: string, fail: string) {
    setBusy(true);
    try {
      await fn();
      onChanged();
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
    ).then(() => { setPick(""); setSearch(""); });
  }

  function unlink(id: string) {
    void run(
      () => apiSend(`/tickets/${ticket.id}/links`, "POST", { ticketId: id, action: "unlink" }),
      "Ticket unlinked",
      "Could not unlink"
    );
  }

  async function merge() {
    if (!pick) return;
    const target = results.find((t) => t.id === pick);
    if (!target) return;
    if (!(await confirm({ title: "Merge tickets", message: `Merge this ticket into ${target.reference}? This ticket's messages move there and this one is cancelled.`, confirmLabel: "Merge", danger: true }))) return;
    void run(
      () => apiSend(`/tickets/${ticket.id}/merge`, "POST", { targetId: pick }),
      `Merged into ${target.reference}`,
      "Could not merge"
    ).then(() => { setPick(""); setSearch(""); });
  }

  const isMerged = !!ticket.mergedIntoId;

  return (
    <div style={{ margin: "1.25rem 0 0" }}>
      {confirmDialog}
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
          <input
            className="input"
            aria-label="Search tickets to link"
            placeholder="Search by reference, subject or requester…"
            value={search}
            disabled={busy}
            onChange={(e) => { setSearch(e.target.value); setPick(""); }}
          />
          <select className="select" aria-label="Matching tickets" value={pick} disabled={busy || candidates.length === 0} onChange={(e) => setPick(e.target.value)}>
            <option value="">{search.trim().length < 2 ? "Type at least 2 characters…" : candidates.length ? "Select a ticket…" : "No matching tickets"}</option>
            {candidates.map((t) => (
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

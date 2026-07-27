"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiSend } from "@/lib/api";
import { usePersona } from "@/components/Persona";
import { useToast } from "@/components/Toast";
import { LabelWithHint, PriorityBadge, timeAgo } from "@/components/ui";
import { HINTS } from "@/lib/hints";
import type { AssignmentGroupRow, TicketRow } from "@/server/domain/models";
import type { TriageAgent, TriageBoard } from "@/server/services/triageService";

// =============================================================================
// TriageView — dispatcher queue (manager/admin only).
//
// Left: unassigned open tickets. Right: for the selected ticket, the eligible
// agents split into "Specialists" (members of the group that owns the ticket's
// category) and "Common" (the generalist Service Desk), each showing live
// open-ticket load + availability, plus a persistent team-workload overview.
// =============================================================================

const DISPATCH_ROLES = ["manager", "tenant_admin", "super_admin"];

export default function TriageView() {
  const router = useRouter();
  const { persona, ready } = usePersona();
  const toast = useToast();
  const canTriage = DISPATCH_ROLES.includes(persona.serverRole);

  const [board, setBoard] = useState<TriageBoard | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!canTriage) return;
    apiGet<TriageBoard>("/triage")
      .then(setBoard)
      .catch(() => setBoard({ queue: [], agents: [], groups: [] }));
  }, [canTriage]);

  useEffect(() => {
    if (ready && !canTriage) router.replace("/");
  }, [ready, canTriage, router]);

  useEffect(() => {
    if (ready && canTriage) refresh();
  }, [ready, canTriage, refresh]);

  const selected = useMemo(
    () => board?.queue.find((t) => t.id === selectedId) ?? null,
    [board, selectedId]
  );

  if (!ready || !canTriage || !board) {
    return (
      <div className="page-pad">
        <div className="skel" style={{ height: 140, borderRadius: 16 }} />
      </div>
    );
  }

  const agentById = new Map(board.agents.map((a) => [a.id, a]));
  const maxLoad = Math.max(1, ...board.agents.map((a) => a.openCount));

  const routedGroup: AssignmentGroupRow | undefined = selected
    ? board.groups.find((g) => g.categories.includes(selected.category))
    : undefined;
  const generalist = board.groups.find((g) => g.categories.includes("Other"));

  const specialistIds = routedGroup?.memberIds ?? [];
  const commonIds = (generalist?.memberIds ?? []).filter((id) => !specialistIds.includes(id));

  const toAgents = (ids: string[]): TriageAgent[] =>
    ids
      .map((id) => agentById.get(id))
      .filter((a): a is TriageAgent => !!a)
      .sort((a, b) => Number(b.available) - Number(a.available) || a.openCount - b.openCount);

  async function assign(agentId: string) {
    if (!selected) return;
    setBusy(agentId);
    try {
      await apiSend(`/tickets/${selected.id}/actions`, "POST", {
        action: "assign",
        assigneeId: agentId,
        assignmentGroupId: selected.assignmentGroupId ?? routedGroup?.id,
      });
      toast.success({ title: "Ticket assigned", description: `${selected.reference} → ${agentById.get(agentId)?.name ?? "agent"}.` });
      setSelectedId(null);
      refresh();
    } catch (err) {
      toast.error({ title: "Could not assign", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page-pad anim-fade-up">
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <header style={{ marginBottom: 18 }}>
          <h1 className="page-title" style={{ margin: 0 }}>
            Triage
          </h1>
          <p className="muted" style={{ fontSize: "0.88rem", marginTop: 3 }}>
            Assign unassigned tickets to the right person — specialists by category, or the Service Desk — based on current load and availability.
          </p>
        </header>

        <div className="triage-grid">
          {/* Queue --------------------------------------------------------- */}
          <section className="panel" style={{ padding: "1rem 1.1rem", minWidth: 0 }}>
            <div className="label" style={{ marginBottom: 10 }}>
              <LabelWithHint info={HINTS.triageQueue} side="right">
                Unassigned queue · {board.queue.length}
              </LabelWithHint>
            </div>
            {board.queue.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                Nothing waiting — every open ticket is assigned.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {board.queue.map((t) => (
                  <QueueRow key={t.id} ticket={t} active={t.id === selectedId} onClick={() => setSelectedId(t.id)} />
                ))}
              </div>
            )}
          </section>

          {/* Assign + workload -------------------------------------------- */}
          <section style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <div className="panel" style={{ padding: "1rem 1.1rem" }}>
              {selected ? (
                <>
                  <div className="label" style={{ marginBottom: 4 }}>
                    Assign {selected.reference}
                  </div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 12 }}>{selected.subject}</div>

                  <AgentGroup
                    title={`Specialists${routedGroup ? ` · ${routedGroup.name}` : ""}`}
                    agents={toAgents(specialistIds)}
                    maxLoad={maxLoad}
                    busy={busy}
                    onAssign={assign}
                    info={HINTS.triageSpecialists}
                  />
                  <AgentGroup
                    title={`Common${generalist ? ` · ${generalist.name}` : ""}`}
                    agents={toAgents(commonIds)}
                    maxLoad={maxLoad}
                    busy={busy}
                    onAssign={assign}
                    info={HINTS.triageCommon}
                  />
                </>
              ) : (
                <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                  Select a ticket from the queue to see who can take it.
                </p>
              )}
            </div>

            <div className="panel" style={{ padding: "1rem 1.1rem" }}>
              <div className="label" style={{ marginBottom: 10 }}>
                <LabelWithHint info={HINTS.teamWorkload} side="right">
                  Team workload
                </LabelWithHint>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {board.agents.map((a) => (
                  <AgentRow key={a.id} agent={a} maxLoad={maxLoad} />
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>

      <style jsx>{`
        .triage-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 900px) {
          .triage-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function QueueRow({ ticket, active, onClick }: { ticket: TicketRow; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "0.6rem 0.75rem",
        borderRadius: 10,
        cursor: "pointer",
        border: `1px solid ${active ? "var(--brand-300)" : "var(--border)"}`,
        background: active ? "var(--brand-50)" : "var(--surface)",
      }}
    >
      <div className="flex items-center" style={{ gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
        <span className="mono" style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{ticket.reference}</span>
        <PriorityBadge priority={ticket.priority} />
        <span
          className="badge"
          style={{ background: "var(--surface-3)", color: "var(--text-secondary)", borderColor: "var(--border)", fontSize: "0.62rem" }}
        >
          {ticket.category}
        </span>
        <span className="muted" style={{ fontSize: "0.68rem", marginLeft: "auto" }}>{timeAgo(ticket.createdAt)}</span>
      </div>
      <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {ticket.subject}
      </div>
    </button>
  );
}

function AgentGroup({
  title,
  agents,
  maxLoad,
  busy,
  onAssign,
  info,
}: {
  title: string;
  agents: TriageAgent[];
  maxLoad: number;
  busy: string | null;
  onAssign: (id: string) => void;
  info?: string;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="label" style={{ fontSize: "0.62rem", marginBottom: 6 }}>
        <LabelWithHint info={info} side="right" size={11}>
          {title}
        </LabelWithHint>
      </div>
      {agents.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.78rem", margin: 0 }}>No members.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {agents.map((a) => (
            <AgentRow key={a.id} agent={a} maxLoad={maxLoad} onAssign={() => onAssign(a.id)} busy={busy === a.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentRow({
  agent,
  maxLoad,
  onAssign,
  busy,
}: {
  agent: TriageAgent;
  maxLoad: number;
  onAssign?: () => void;
  busy?: boolean;
}) {
  const pct = Math.round((agent.openCount / maxLoad) * 100);
  const barColor = agent.openCount >= maxLoad && maxLoad > 1 ? "var(--warning-solid)" : "var(--brand-500)";
  return (
    <div className="panel-2 flex items-center" style={{ padding: "0.5rem 0.7rem", gap: 10 }}>
      <div
        aria-hidden
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          flexShrink: 0,
          background: "var(--brand-gradient)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: "0.68rem",
        }}
      >
        {agent.initials}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="flex items-center" style={{ gap: 6 }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {agent.name}
          </span>
          <span
            className="badge"
            style={{
              fontSize: "0.56rem",
              background: agent.available ? "var(--success-bg)" : "var(--surface-3)",
              color: agent.available ? "var(--success-fg)" : "var(--text-secondary)",
              borderColor: agent.available ? "var(--success-border)" : "var(--border)",
            }}
          >
            {agent.available ? "Available" : "Away"}
          </span>
        </div>
        <div className="flex items-center" style={{ gap: 6, marginTop: 4 }}>
          <div style={{ flex: 1, height: 5, borderRadius: 999, background: "var(--surface-3)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 999 }} />
          </div>
          <span className="muted" style={{ fontSize: "0.68rem", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
            {agent.openCount} open
          </span>
        </div>
      </div>
      {onAssign ? (
        <button className="btn btn-primary" style={{ fontSize: "0.72rem", padding: "0.3rem 0.65rem", flexShrink: 0 }} disabled={busy} onClick={onAssign}>
          {busy ? "…" : "Assign"}
        </button>
      ) : null}
    </div>
  );
}

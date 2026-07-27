"use client";

import { useState } from "react";
import { apiSend } from "@/lib/api";
import type { TicketView } from "@/server/services/ticketService";
import type {
  AssignmentGroupRow,
  CIRow,
  CustomFieldDefRow,
  ImpactLevel,
  TicketCategory,
  TicketPriority,
  TicketRow,
  UserRow,
} from "@/server/domain/models";
import { IMPACT_LEVELS, LabelWithHint, PRIORITIES } from "./ui";
import { PromptDialog } from "./primitives";
import { useToast } from "./Toast";
import { customFieldHint, HINTS } from "@/lib/hints";

// =============================================================================
// TicketProperties — the agent-editable property panel on ticket detail.
//
// Inline editors for the ITIL fields that drive routing, SLA, and reporting:
// impact/urgency (priority is derived from these via the matrix), category /
// subcategory, assignee, assignment group, linked CIs, and custom fields. Each
// change PATCHes /api/v1/tickets/[id] and refreshes the parent; priority is
// shown read-only because it is computed server-side.
// =============================================================================

const CATEGORIES: TicketCategory[] = [
  "IT",
  "HR",
  "Access",
  "Software",
  "Hardware",
  "Network",
  "Billing",
  "Other",
];

// The ITIL matrix, mirrored client-side purely for the "derived" hint.
const MATRIX: Record<ImpactLevel, Record<ImpactLevel, TicketPriority>> = {
  high: { high: "critical", medium: "high", low: "medium" },
  medium: { high: "high", medium: "medium", low: "low" },
  low: { high: "medium", medium: "low", low: "very_low" },
};

export default function TicketProperties({
  ticket,
  users,
  groups,
  cis,
  customFieldDefs = [],
  onChanged,
}: {
  ticket: TicketView;
  users: UserRow[];
  groups: AssignmentGroupRow[];
  cis: CIRow[];
  customFieldDefs?: CustomFieldDefRow[];
  onChanged: () => void;
}) {
  const [tags, setTags] = useState(ticket.tags.join(", "));
  const [subcategory, setSubcategory] = useState(ticket.subcategory ?? "");
  const [busy, setBusy] = useState(false);
  // Set while the agent is being asked to justify a manual priority override.
  const [override, setOverride] = useState<TicketPriority | null>(null);
  const toast = useToast();

  // The panel is reused across tickets (the detail route swaps `ticket` without
  // remounting), so drafts are reset the moment the id changes — otherwise
  // "Save tags" would write one ticket's edits onto another. Done during render
  // rather than in an effect so the stale values are never painted.
  const [draftsFor, setDraftsFor] = useState(ticket.id);
  if (draftsFor !== ticket.id) {
    setDraftsFor(ticket.id);
    setTags(ticket.tags.join(", "));
    setSubcategory(ticket.subcategory ?? "");
    setOverride(null);
  }

  const agents = users.filter((u) => u.role !== "requester");

  async function commit(fn: () => Promise<unknown>, ok: string, fail: string) {
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

  function patch(body: Record<string, unknown>, ok: string, fail: string) {
    return commit(() => apiSend<TicketRow>(`/tickets/${ticket.id}`, "PATCH", body), ok, fail);
  }

  const derived = ticket.impact && ticket.urgency ? MATRIX[ticket.impact][ticket.urgency] : null;
  const tagsDirty = tags.trim() !== ticket.tags.join(", ").trim();
  const subcatDirty = subcategory.trim() !== (ticket.subcategory ?? "").trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="Assignee" info={HINTS.assignee}>
        <select
          className="select"
          value={ticket.assigneeId ?? ""}
          disabled={busy}
          onChange={(e) =>
            commit(
              () =>
                apiSend(`/tickets/${ticket.id}/actions`, "POST", {
                  action: "assign",
                  assigneeId: e.target.value || null,
                }),
              "Assignee updated",
              "Could not assign"
            )
          }
        >
          <option value="">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Assignment group" info={HINTS.assignmentGroup}>
        <select
          className="select"
          value={ticket.assignmentGroupId ?? ""}
          disabled={busy}
          onChange={(e) =>
            patch({ assignmentGroupId: e.target.value || null }, "Group updated", "Could not update group")
          }
        >
          <option value="">No group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Impact (scope of effect)" info={HINTS.impact}>
        <select
          className="select"
          value={ticket.impact ?? ""}
          disabled={busy}
          onChange={(e) =>
            patch({ impact: e.target.value as ImpactLevel }, "Impact updated — priority recalculated", "Could not update impact")
          }
        >
          <option value="" disabled>
            not set
          </option>
          {IMPACT_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Urgency (time sensitivity)" info={HINTS.urgency}>
        <select
          className="select"
          value={ticket.urgency ?? ""}
          disabled={busy}
          onChange={(e) =>
            patch({ urgency: e.target.value as ImpactLevel }, "Urgency updated — priority recalculated", "Could not update urgency")
          }
        >
          <option value="" disabled>
            not set
          </option>
          {IMPACT_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Priority" info={HINTS.derivedPriority}>
        <select
          className="select"
          value={ticket.priority}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.value as TicketPriority;
            // Overriding the matrix requires a justification (audited).
            if (derived && next !== derived) {
              setOverride(next);
              return;
            }
            void patch({ priority: next }, "Priority updated", "Could not update priority");
          }}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p === derived ? `${p} (derived)` : p}
            </option>
          ))}
        </select>
        {derived && ticket.priority !== derived ? (
          <p className="muted" style={{ fontSize: "0.7rem", marginTop: 4 }}>
            Manually overridden — the matrix derives “{derived}”.
          </p>
        ) : null}
      </Field>

      <Field label="Category" info={HINTS.category}>
        <select
          className="select"
          value={ticket.category}
          disabled={busy}
          onChange={(e) =>
            patch({ category: e.target.value as TicketCategory }, "Category updated", "Could not update category")
          }
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Subcategory" info={HINTS.subcategory}>
        <input
          className="input"
          placeholder="e.g. VPN, Email, Laptop"
          value={subcategory}
          disabled={busy}
          onChange={(e) => setSubcategory(e.target.value)}
        />
        {subcatDirty ? (
          <button
            className="btn btn-ghost"
            style={{ marginTop: 8, padding: "0.35rem 0.7rem", fontSize: "0.76rem" }}
            disabled={busy}
            onClick={() =>
              patch({ subcategory: subcategory.trim() || null }, "Subcategory updated", "Could not update subcategory")
            }
          >
            Save subcategory
          </button>
        ) : null}
      </Field>

      <Field label="Affected CIs (CMDB)" info={HINTS.affectedCIs}>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {cis.length === 0 ? (
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              No CIs in the CMDB yet.
            </span>
          ) : (
            cis.map((ci) => {
              const linked = ticket.ciIds.includes(ci.id);
              return (
                <label
                  key={ci.id}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.8rem", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={linked}
                    disabled={busy}
                    onChange={() => {
                      const next = linked
                        ? ticket.ciIds.filter((c) => c !== ci.id)
                        : [...ticket.ciIds, ci.id];
                      void patch({ ciIds: next }, linked ? "CI unlinked" : "CI linked", "Could not update CIs");
                    }}
                  />
                  <span>
                    {ci.name} <span className="muted">({ci.type})</span>
                  </span>
                </label>
              );
            })
          )}
        </div>
      </Field>

      <Field label="Tags" info={HINTS.tags}>
        <input
          className="input"
          placeholder="comma, separated"
          value={tags}
          disabled={busy}
          onChange={(e) => setTags(e.target.value)}
        />
        {tagsDirty ? (
          <button
            className="btn btn-ghost"
            style={{ marginTop: 8, padding: "0.35rem 0.7rem", fontSize: "0.76rem" }}
            disabled={busy}
            onClick={() =>
              patch(
                { tags: tags.split(",").map((t) => t.trim()).filter(Boolean) },
                "Tags updated",
                "Could not update tags"
              )
            }
          >
            Save tags
          </button>
        ) : null}
      </Field>

      {customFieldDefs.map((def) => (
        <CustomFieldEditor
          key={def.id}
          def={def}
          ticketId={ticket.id}
          value={ticket.customFields?.[def.key]}
          busy={busy}
          onSave={(value) =>
            patch(
              { customFields: { [def.key]: value } },
              `${def.label} updated`,
              `Could not update ${def.label}`
            )
          }
        />
      ))}

      <PromptDialog
        open={override !== null}
        title="Justify the priority override"
        description={
          override
            ? `Impact × urgency derives ${derived}. Overriding to ${override} is recorded in the audit trail against your name.`
            : undefined
        }
        label="Justification"
        placeholder="e.g. Affects the CEO ahead of the board meeting"
        confirmLabel="Override priority"
        required
        multiline
        busy={busy}
        onCancel={() => setOverride(null)}
        onConfirm={(justification) => {
          const next = override;
          setOverride(null);
          if (!next) return;
          void patch(
            { priority: next, priorityJustification: justification },
            "Priority overridden",
            "Could not update priority"
          );
        }}
      />
    </div>
  );
}

/** One editable custom field; free-text/number/date use a dirty+Save pattern. */
function CustomFieldEditor({
  def,
  ticketId,
  value,
  busy,
  onSave,
}: {
  def: CustomFieldDefRow;
  ticketId: string;
  value: unknown;
  busy: boolean;
  onSave: (value: unknown) => void;
}) {
  const current = value == null ? "" : String(value);
  const [draft, setDraft] = useState(current);
  // Same reason as the panel above: keyed by def id, this editor survives a
  // ticket switch, so the draft has to follow the ticket.
  const [draftFor, setDraftFor] = useState(ticketId);
  if (draftFor !== ticketId) {
    setDraftFor(ticketId);
    setDraft(current);
  }
  const label = def.required ? `${def.label} *` : def.label;
  const info = customFieldHint(def);

  if (def.type === "checkbox") {
    return (
      <Field label={label} info={info}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.8rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={value === true}
            disabled={busy}
            onChange={(e) => onSave(e.target.checked)}
          />
          <span className="muted">{value === true ? "Yes" : "No"}</span>
        </label>
      </Field>
    );
  }

  if (def.type === "select") {
    return (
      <Field label={label} info={info}>
        <select className="select" value={current} disabled={busy} onChange={(e) => onSave(e.target.value || null)}>
          <option value="">not set</option>
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  const inputType = def.type === "number" ? "number" : def.type === "date" ? "date" : "text";
  const dirty = draft.trim() !== current.trim();
  return (
    <Field label={label} info={info}>
      <input
        className="input"
        type={inputType}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
      />
      {dirty ? (
        <button
          className="btn btn-ghost"
          style={{ marginTop: 8, padding: "0.35rem 0.7rem", fontSize: "0.76rem" }}
          disabled={busy}
          onClick={() => onSave(def.type === "number" ? (draft === "" ? null : Number(draft)) : draft.trim() || null)}
        >
          Save {def.label.toLowerCase()}
        </button>
      ) : null}
    </Field>
  );
}

function Field({
  label,
  info,
  children,
}: {
  label: string;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>
        <LabelWithHint info={info} side="right">
          {label}
        </LabelWithHint>
      </div>
      {children}
    </div>
  );
}

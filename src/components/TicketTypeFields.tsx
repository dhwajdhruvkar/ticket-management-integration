"use client";

// The type-specific part of a new-ticket form, shared by /tickets and the Help
// Center request dialog so both offer the same fields with the same limits.
// Controlled and presentational: validation lives in shared/ticketTypes (and is
// repeated on the server); this only gives quick feedback before submitting.

import { CHANGE_RISKS, TICKET_TYPE_HINTS, TYPE_DETAIL_LIMITS, CREATABLE_TICKET_TYPES, typeDetailsProblem, type CreatableTicketType } from "@/shared/ticketTypes";

export interface TypeDetailsState {
  affectedService: string;
  requestedItem: string;
  fulfilmentDetails: string;
  changeRisk: string;
  changeImpact: string;
  implementationPlan: string;
  rollbackPlan: string;
  windowStart: string;
  windowEnd: string;
}

export const emptyTypeDetails = (): TypeDetailsState => ({
  affectedService: "", requestedItem: "", fulfilmentDetails: "", changeRisk: "", changeImpact: "",
  implementationPlan: "", rollbackPlan: "", windowStart: "", windowEnd: "",
});

const iso = (local: string) => {
  const t = Date.parse(local);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};

/** The `typeDetails` payload for a type (datetime-local values become ISO strings). */
export function buildTypeDetails(type: CreatableTicketType, s: TypeDetailsState): Record<string, unknown> {
  if (type === "incident") return { affectedService: s.affectedService.trim() };
  if (type === "service_request") return { requestedItem: s.requestedItem.trim(), fulfilmentDetails: s.fulfilmentDetails.trim() };
  return {
    risk: s.changeRisk, impact: s.changeImpact, implementationPlan: s.implementationPlan.trim(), rollbackPlan: s.rollbackPlan.trim(),
    maintenanceStart: iso(s.windowStart), maintenanceEnd: iso(s.windowEnd),
  };
}

/** Why the details are incomplete for this type, or null (same rule as the server). */
export const typeDetailsError = (type: CreatableTicketType, s: TypeDetailsState) => typeDetailsProblem(type, buildTypeDetails(type, s));

export function TicketTypeSelect({ value, onChange, disabled, id }: { value: CreatableTicketType; onChange: (t: CreatableTicketType) => void; disabled?: boolean; id?: string }) {
  return (
    <select id={id} className="select" aria-label="Ticket type" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as CreatableTicketType)}>
      {CREATABLE_TICKET_TYPES.map((t) => <option key={t} value={t}>{TICKET_TYPE_HINTS[t]}</option>)}
    </select>
  );
}

export interface CatalogChoice { id: string; name: string; requiresApproval: boolean }

export function TicketTypeFields({
  type, value, onChange, catalog, catalogItemId, onCatalogChange,
}: {
  type: CreatableTicketType;
  value: TypeDetailsState;
  onChange: (next: TypeDetailsState) => void;
  /** When given, a service request can pick a catalog item (the approval note comes from the item itself). */
  catalog?: CatalogChoice[];
  catalogItemId?: string;
  onCatalogChange?: (id: string) => void;
}) {
  const set = <K extends keyof TypeDetailsState>(key: K, v: TypeDetailsState[K]) => onChange({ ...value, [key]: v });
  const error = type === "change" ? typeDetailsError(type, value) : null;
  const touched = value.changeRisk || value.changeImpact || value.implementationPlan || value.rollbackPlan || value.windowStart || value.windowEnd;

  if (type === "incident") {
    return <input className="input" aria-label="Affected service" placeholder="Affected service (e.g. VPN, email)" maxLength={TYPE_DETAIL_LIMITS.short} value={value.affectedService} onChange={(e) => set("affectedService", e.target.value)} />;
  }
  if (type === "service_request") {
    const chosen = catalog?.find((c) => c.id === catalogItemId);
    return (
      <div style={{ display: "grid", gap: 10 }}>
        {catalog && onCatalogChange ? (
          <select
            className="select"
            aria-label="Catalog item"
            value={catalogItemId ?? ""}
            onChange={(e) => {
              onCatalogChange(e.target.value);
              const item = catalog.find((c) => c.id === e.target.value);
              if (item && !value.requestedItem) set("requestedItem", item.name);
            }}
          >
            <option value="">No catalog item</option>
            {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}{c.requiresApproval ? " (needs approval)" : ""}</option>)}
          </select>
        ) : null}
        {chosen?.requiresApproval ? <p className="muted" role="note" style={{ margin: 0, fontSize: "0.78rem" }}>This item needs a manager&apos;s approval before it is fulfilled.</p> : null}
        <input className="input" aria-label="Requested item or service" placeholder="Requested item or service" maxLength={TYPE_DETAIL_LIMITS.short} value={value.requestedItem} onChange={(e) => set("requestedItem", e.target.value)} />
        <textarea className="textarea" rows={2} aria-label="Fulfilment details" placeholder="Fulfilment details (quantity, delivery location, needed-by date)" maxLength={TYPE_DETAIL_LIMITS.long} value={value.fulfilmentDetails} onChange={(e) => set("fulfilmentDetails", e.target.value)} />
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <select className="select" aria-label="Change risk" value={value.changeRisk} onChange={(e) => set("changeRisk", e.target.value)}>
          <option value="">Risk…</option>
          {CHANGE_RISKS.map((r) => <option key={r} value={r}>Risk: {r}</option>)}
        </select>
        <select className="select" aria-label="Change impact" value={value.changeImpact} onChange={(e) => set("changeImpact", e.target.value)}>
          <option value="">Impact…</option>
          {CHANGE_RISKS.map((r) => <option key={r} value={r}>Impact: {r}</option>)}
        </select>
      </div>
      <textarea className="textarea" rows={2} aria-label="Implementation plan" placeholder="Implementation plan" maxLength={TYPE_DETAIL_LIMITS.long} value={value.implementationPlan} onChange={(e) => set("implementationPlan", e.target.value)} />
      <textarea className="textarea" rows={2} aria-label="Rollback plan" placeholder="Rollback plan" maxLength={TYPE_DETAIL_LIMITS.long} value={value.rollbackPlan} onChange={(e) => set("rollbackPlan", e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <div><label className="label" htmlFor="change-window-start">Maintenance window start</label><input id="change-window-start" type="datetime-local" className="input" value={value.windowStart} onChange={(e) => set("windowStart", e.target.value)} /></div>
        <div><label className="label" htmlFor="change-window-end">Maintenance window end</label><input id="change-window-end" type="datetime-local" className="input" value={value.windowEnd} onChange={(e) => set("windowEnd", e.target.value)} /></div>
      </div>
      {error && touched ? <p role="alert" style={{ margin: 0, fontSize: "0.8rem", color: "var(--danger-fg)" }}>{error}</p> : null}
    </div>
  );
}

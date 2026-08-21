"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGetAll, apiSend } from "@/lib/api";
import type {
  ApiKeyRow,
  AssignmentGroupRow,
  AutomationRow,
  BusinessCalendarRow,
  CustomFieldDefRow,
  CustomFieldType,
  DepartmentRow,
  MacroRow,
  MessageVisibility,
  SlaPolicyRow,
  TenantRow,
  UserRow,
} from "@/server/domain/models";
import { usePersona } from "@/components/Persona";
import { useToast } from "@/components/Toast";
import { useTheme } from "@/components/Theme";
import { PRIORITY_ORDER, priorityCode } from "@/shared/priority";
import type { TicketPriority } from "@/server/domain/models";
import { InfoHint, LabelWithHint, timeAgo } from "@/components/ui";
import { PromptDialog } from "@/components/primitives";
import { customFieldHint, HINTS } from "@/lib/hints";

// =============================================================================
// SettingsView — the admin/agent configuration surface (route: /settings).
//
// One page of iconed sections, each backed by its own API: Data & health,
// SLA policies (+ business calendars), assignment groups & routing strategy,
// automation rules (with the rule builder), macros, custom fields, departments,
// organization/tenant settings, API keys, and appearance/theme. Section
// visibility is role-gated (admin-only sections hidden from plain agents), and
// every control writes through /api/v1 with optimistic UI + toasts.
// =============================================================================

interface Health {
  service: string;
  version: string;
  dataDriver: string;
  features: Record<string, boolean>;
}

type ApiKeyView = Omit<ApiKeyRow, "keyHash">;

export default function SettingsView() {
  const router = useRouter();
  const { persona, ready } = usePersona();
  const [health, setHealth] = useState<Health | null>(null);
  const [slaPolicies, setSlaPolicies] = useState<SlaPolicyRow[]>([]);
  const [groups, setGroups] = useState<AssignmentGroupRow[]>([]);
  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyView[] | null>(null);
  const [showRuleBuilder, setShowRuleBuilder] = useState(false);
  const [togglingRule, setTogglingRule] = useState<string | null>(null);
  const toast = useToast();
  const { theme, toggle } = useTheme();

  const isAdmin = ["tenant_admin", "super_admin"].includes(persona.serverRole);

  // Settings is agent-only; requesters go back to their requests.
  useEffect(() => {
    if (ready && persona.role === "requester") router.replace("/tickets");
  }, [ready, persona.role, router]);

  const refresh = useCallback(() => {
    // /health is a plain probe (no { ok, data } envelope).
    fetch("/api/v1/health", { cache: "no-store" })
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
    apiGetAll<AssignmentGroupRow>("/groups").then(setGroups).catch(() => {});
    apiGetAll<AutomationRow>("/automations").then(setAutomations).catch(() => {});
    apiGetAll<SlaPolicyRow>("/sla-policies").then(setSlaPolicies).catch(() => {});
    apiGetAll<ApiKeyView>("/api-keys").then(setApiKeys).catch(() => setApiKeys(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggleAutomation(rule: AutomationRow) {
    setTogglingRule(rule.id);
    try {
      await apiSend(`/automations/${rule.id}`, "PATCH", { enabled: !rule.enabled });
      refresh();
      toast.success({ title: rule.enabled ? "Automation disabled" : "Automation enabled" });
    } catch (err) {
      toast.error({ title: "Could not update automation", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setTogglingRule(null);
    }
  }

  const enabledFeatures = Object.entries(health?.features ?? {}).filter(([, on]) => on).map(([k]) => k);

  return (
    <div className="page-pad anim-fade-up">
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <header style={{ marginBottom: 20 }}>
          <h1 className="page-title" style={{ margin: 0 }}>
            Settings
          </h1>
          <p className="muted" style={{ fontSize: "0.88rem", marginTop: 3 }}>
            Workspace health, SLA matrix, routing, and automation controls.
          </p>
        </header>

        <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Data & health ------------------------------------------------- */}
          <section className="panel" style={{ padding: "1.15rem 1.25rem" }}>
            <SectionHead icon={<PulseIcon />} title="Data & health" hint="Live service probe" />
            {health ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                <HealthCell
                  label="Service"
                  value={`${health.service} v${health.version}`}
                  ok
                />
                <HealthCell label="Data driver" value={health.dataDriver} ok info={HINTS.dataDriver} />
                <HealthCell
                  label="Features"
                  value={enabledFeatures.length ? enabledFeatures.join(", ") : "zero-infra demo"}
                  ok={enabledFeatures.length > 0}
                  neutral={enabledFeatures.length === 0}
                  info={HINTS.featureFlags}
                />
              </div>
            ) : (
              <p className="muted" style={{ fontSize: "0.84rem", margin: 0 }}>Loading…</p>
            )}
          </section>

          {/* SLA policies --------------------------------------------------- */}
          <section className="panel" style={{ padding: "1.15rem 1.25rem" }}>
            <SectionHead
              icon={<GaugeIcon />}
              title="SLA policies"
              hint="Response / resolution per priority"
              info={HINTS.slaPolicy}
            />
            {slaPolicies.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.84rem", margin: 0 }}>
                Default matrix: P1 15m/2h · P2 1h/4h · P3 2h/24h · P4 4h/3d · P5 8h/5d.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[...slaPolicies]
                  .sort(
                    (a, b) =>
                      PRIORITY_ORDER.indexOf(a.priority as TicketPriority) -
                      PRIORITY_ORDER.indexOf(b.priority as TicketPriority)
                  )
                  .map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        fontSize: "0.84rem",
                        padding: "0.55rem 0.7rem",
                        borderRadius: 10,
                        background: "var(--surface-2)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <span
                        className="badge mono"
                        style={{
                          background: "var(--brand-50)",
                          color: "var(--brand-700)",
                          borderColor: "var(--brand-100)",
                          fontWeight: 800,
                        }}
                      >
                        {priorityCode(p.priority as TicketPriority)}
                      </span>
                      <span style={{ fontWeight: 600, textTransform: "capitalize", flex: 1 }}>
                        {p.priority.replace("_", " ")}
                      </span>
                      <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                        respond {formatMins(p.responseMins)} · resolve {formatMins(p.resolveMins)}
                        {p.businessHoursOnly ? " · business hours" : ""}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </section>

          {/* Assignment groups ---------------------------------------------- */}
          <section className="panel" style={{ padding: "1.15rem 1.25rem" }}>
            <SectionHead
              icon={<UsersIcon />}
              title="Assignment groups"
              hint="Category routing + auto-assignment strategy"
              info={HINTS.assignmentGroup}
            />
            {groups.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.84rem", margin: 0 }}>No groups configured.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                {groups.map((g) => (
                  <div key={g.id} className="panel-2" style={{ padding: "0.75rem 0.9rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        aria-hidden
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: "var(--brand-50)",
                          color: "var(--brand-700)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <UsersIcon size={13} />
                      </span>
                      <div style={{ fontSize: "0.88rem", fontWeight: 700 }}>{g.name}</div>
                      <span className="badge" style={{ marginLeft: "auto", background: "var(--surface-3)", color: "var(--muted)" }}>
                        {g.memberIds.length} member{g.memberIds.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                      {g.categories.length === 0 ? (
                        <span className="muted" style={{ fontSize: "0.74rem" }}>No routing rules</span>
                      ) : (
                        g.categories.map((c) => (
                          <span
                            key={c}
                            className="badge"
                            style={{ background: "var(--info-bg)", color: "var(--info-fg)", borderColor: "var(--info-border)", fontSize: "0.66rem" }}
                          >
                            {c}
                          </span>
                        ))
                      )}
                    </div>
                    {isAdmin ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                        <span className="muted" style={{ fontSize: "0.7rem", fontWeight: 600, flexShrink: 0 }}>
                          <LabelWithHint info={HINTS.assignStrategy} side="right" size={12}>
                            Auto-assign
                          </LabelWithHint>
                        </span>
                        <select
                          className="select"
                          value={g.strategy ?? "manual"}
                          style={{ fontSize: "0.76rem", height: 30, padding: "0 8px" }}
                          onChange={(e) => {
                            const strategy = e.target.value;
                            apiSend(`/groups/${g.id}`, "PATCH", { strategy })
                              .then(() => {
                                toast.success({ title: "Strategy updated", description: `${g.name} → ${strategy.replace("_", " ")}` });
                                refresh();
                              })
                              .catch((err) =>
                                toast.error({ title: "Could not update group", description: err instanceof Error ? err.message : String(err) })
                              );
                          }}
                        >
                          <option value="manual">manual (queue only)</option>
                          <option value="round_robin">round robin</option>
                          <option value="least_loaded">least loaded</option>
                        </select>
                      </div>
                    ) : (
                      <div className="muted" style={{ fontSize: "0.7rem", marginTop: 8 }}>
                        Auto-assign: {(g.strategy ?? "manual").replace("_", " ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* People & organization (admin) ---------------------------------- */}
          {isAdmin ? (
            <div id="users" style={{ scrollMarginTop: 80 }}>
              <UsersSection isSuperAdmin={persona.serverRole === "super_admin"} />
            </div>
          ) : null}
          {isAdmin ? (
            <div id="departments" style={{ scrollMarginTop: 80 }}>
              <DepartmentsSection />
            </div>
          ) : null}
          {persona.serverRole === "super_admin" ? (
            <div id="organizations" style={{ scrollMarginTop: 80 }}>
              <OrganizationsSection />
            </div>
          ) : null}

          {/* Business calendars ---------------------------------------------- */}
          {isAdmin ? <CalendarsSection onChanged={refresh} /> : null}

          {/* Macros ---------------------------------------------------------- */}
          <MacrosSection isAdmin={isAdmin} />

          {/* Custom fields --------------------------------------------------- */}
          {isAdmin ? <CustomFieldsSection /> : null}

          {/* Automations ----------------------------------------------------- */}
          <section className="panel" style={{ padding: "1.15rem 1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <SectionHead
                icon={<BoltIcon />}
                title="Automation rules"
                hint="Run on lifecycle + SLA events"
                info={HINTS.automation}
              />
              {isAdmin ? (
                <button className="btn btn-ghost" style={{ fontSize: "0.76rem" }} onClick={() => setShowRuleBuilder((s) => !s)}>
                  {showRuleBuilder ? "Close" : "+ New rule"}
                </button>
              ) : null}
            </div>
            {showRuleBuilder ? (
              <RuleBuilder
                onCreated={() => {
                  setShowRuleBuilder(false);
                  refresh();
                }}
              />
            ) : null}
            {automations.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.84rem", margin: 0 }}>No automation rules yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {automations.map((rule) => (
                  <div
                    key={rule.id}
                    className="panel-2 flex items-center justify-between"
                    style={{ padding: "0.7rem 0.85rem", gap: 12 }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <span
                        aria-hidden
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: rule.enabled ? "var(--success-bg)" : "var(--surface-3)",
                          color: rule.enabled ? "var(--success-fg)" : "var(--muted)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          transition: "background var(--dur-2) var(--ease), color var(--dur-2) var(--ease)",
                        }}
                      >
                        <BoltIcon size={13} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "0.86rem", fontWeight: 600 }}>{rule.name}</div>
                        <div className="muted" style={{ fontSize: "0.72rem" }}>
                          on {rule.trigger} · ran {rule.runCount}×
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={rule.enabled}
                      label={`Toggle ${rule.name}`}
                      onChange={() => void toggleAutomation(rule)}
                      disabled={!isAdmin || togglingRule === rule.id}
                      title={isAdmin ? undefined : "Only administrators can enable or disable automation rules."}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* API keys ---------------------------------------------------------- */}
          {isAdmin && apiKeys !== null ? (
            <div id="integrations" style={{ scrollMarginTop: 80 }}>
              <ApiKeysSection keys={apiKeys} onChanged={refresh} />
            </div>
          ) : null}

          {/* Appearance ------------------------------------------------------ */}
          <section className="panel" style={{ padding: "1.15rem 1.25rem" }}>
            <SectionHead icon={theme === "dark" ? <MoonIcon /> : <SunIcon />} title="Appearance" hint="Applies to this browser" />
            <div className="flex items-center justify-between" style={{ gap: 12 }}>
              <div>
                <div style={{ fontSize: "0.88rem", fontWeight: 600 }}>Theme</div>
                <div className="muted" style={{ fontSize: "0.74rem" }}>Currently {theme} mode</div>
              </div>
              <button
                type="button"
                onClick={toggle}
                aria-label="Toggle theme"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: 3,
                  borderRadius: 999,
                  background: "var(--surface-3)",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                <span style={segStyle(theme === "light")}>
                  <SunIcon size={12} /> Light
                </span>
                <span style={segStyle(theme === "dark")}>
                  <MoonIcon size={12} /> Dark
                </span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   Pieces
   ========================================================================= */

/* =========================================================================
   Automation rule builder
   ========================================================================= */

interface BuilderCondition {
  field: string;
  op: "eq" | "neq" | "contains";
  value: string;
}
interface BuilderAction {
  type: string;
  value: string;
}

const CONDITION_FIELDS = ["status", "priority", "category", "type", "channel", "subject", "requesterEmail"];
const ACTION_TYPES: { id: string; label: string; input: "user" | "priority" | "status" | "category" | "text" | "target" | "none" }[] = [
  { id: "assign", label: "Assign to agent", input: "user" },
  { id: "reassign", label: "Reassign to least-loaded agent", input: "none" },
  { id: "set_priority", label: "Set priority", input: "priority" },
  { id: "set_status", label: "Set status", input: "status" },
  { id: "set_category", label: "Set category", input: "category" },
  { id: "add_tag", label: "Add tag", input: "text" },
  { id: "notify", label: "Notify", input: "target" },
  { id: "run_ai", label: "Run AI resolution", input: "none" },
];

function RuleBuilder({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [users, setUsers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("ticket.created");
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const [conditions, setConditions] = useState<BuilderCondition[]>([
    { field: "category", op: "eq", value: "IT" },
  ]);
  const [actions, setActions] = useState<BuilderAction[]>([{ type: "add_tag", value: "automated" }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGetAll<{ id: string; name: string; role: string }>("/users")
      .then((all) => setUsers(all.filter((u) => u.role !== "requester")))
      .catch(() => {});
  }, []);

  function buildPayload() {
    const conds = conditions
      .filter((c) => c.value.trim())
      .map((c) => ({ field: c.field, op: c.op, value: c.value.trim() }));
    const acts = actions
      .map((a) => {
        switch (a.type) {
          case "assign":
            return a.value ? { type: "assign", assigneeId: a.value } : null;
          case "reassign":
            return { type: "reassign" };
          case "set_priority":
            return a.value ? { type: "set_priority", priority: a.value } : null;
          case "set_status":
            return a.value ? { type: "set_status", status: a.value } : null;
          case "set_category":
            return a.value ? { type: "set_category", category: a.value } : null;
          case "add_tag":
            return a.value ? { type: "add_tag", tag: a.value } : null;
          case "notify":
            return { type: "notify", target: (a.value || "manager") as "manager" | "assignee" | "requester" };
          case "run_ai":
            return { type: "run_ai" };
          default:
            return null;
        }
      })
      .filter(Boolean);
    return {
      name: name.trim(),
      trigger,
      conditions: matchMode === "all" ? conds : { any: conds },
      actions: acts,
    };
  }

  async function create() {
    const payload = buildPayload();
    if (!payload.name || payload.actions.length === 0) {
      toast.error({ title: "Rule needs a name and at least one action" });
      return;
    }
    setBusy(true);
    try {
      await apiSend("/automations", "POST", payload);
      toast.success({ title: "Automation created", description: `"${payload.name}" is now active.` });
      onCreated();
    } catch (err) {
      toast.error({ title: "Could not create rule", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const rowStyle: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" };
  const smallSelect: React.CSSProperties = { fontSize: "0.78rem", height: 32, padding: "0 8px", flex: "0 0 auto" };

  return (
    <div className="panel-2 anim-fade-up" style={{ padding: "0.9rem 1rem", marginBottom: 12, display: "grid", gap: 12 }}>
      <div style={rowStyle}>
        <input className="input" placeholder="Rule name (e.g. Route network incidents)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: "1 1 220px" }} />
        <select
          className="select"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          style={{ ...smallSelect, height: 38 }}
          aria-label="Trigger"
          title={HINTS.automationTrigger}
        >
          <option value="ticket.created">When a ticket is created</option>
          <option value="ticket.updated">When a ticket&apos;s status changes</option>
          <option value="sla.at_risk">When an SLA is at risk</option>
          <option value="sla.breached">When an SLA breaches</option>
        </select>
        <InfoHint text={HINTS.automationTrigger} side="left" />
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className="label" style={{ margin: 0 }}>
            <LabelWithHint
              info={`${HINTS.automationMatchAll} ${HINTS.automationMatchAny}`}
              side="right"
            >
              Conditions
            </LabelWithHint>
          </span>
          <select className="select" value={matchMode} onChange={(e) => setMatchMode(e.target.value as "all" | "any")} style={smallSelect}>
            <option value="all">match ALL</option>
            <option value="any">match ANY</option>
          </select>
          <button className="btn btn-ghost" style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }} onClick={() => setConditions((c) => [...c, { field: "status", op: "eq", value: "" }])}>
            + condition
          </button>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {conditions.map((c, i) => (
            <div key={i} style={rowStyle}>
              <select className="select" value={c.field} style={smallSelect} onChange={(e) => setConditions((all) => all.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>
                {CONDITION_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <select className="select" value={c.op} style={smallSelect} onChange={(e) => setConditions((all) => all.map((x, j) => (j === i ? { ...x, op: e.target.value as BuilderCondition["op"] } : x)))}>
                <option value="eq">is</option>
                <option value="neq">is not</option>
                <option value="contains">contains</option>
              </select>
              <input className="input" placeholder="value" value={c.value} style={{ flex: "1 1 120px", height: 32, fontSize: "0.78rem" }} onChange={(e) => setConditions((all) => all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <button className="btn btn-ghost" aria-label="Remove condition" style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }} onClick={() => setConditions((all) => all.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          {conditions.length === 0 ? <p className="muted" style={{ fontSize: "0.74rem", margin: 0 }}>No conditions — the rule matches every ticket on this trigger.</p> : null}
        </div>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className="label" style={{ margin: 0 }}>
            <LabelWithHint info={HINTS.automationActions} side="right">
              Actions
            </LabelWithHint>
          </span>
          <button className="btn btn-ghost" style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }} onClick={() => setActions((a) => [...a, { type: "add_tag", value: "" }])}>
            + action
          </button>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {actions.map((a, i) => {
            const def = ACTION_TYPES.find((t) => t.id === a.type) ?? ACTION_TYPES[0];
            return (
              <div key={i} style={rowStyle}>
                <select className="select" value={a.type} style={smallSelect} onChange={(e) => setActions((all) => all.map((x, j) => (j === i ? { type: e.target.value, value: "" } : x)))}>
                  {ACTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                {def.input === "user" ? (
                  <select className="select" value={a.value} style={{ ...smallSelect, flex: "1 1 140px" }} onChange={(e) => setActions((all) => all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                    <option value="">Pick an agent…</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                ) : def.input === "priority" ? (
                  <select className="select" value={a.value} style={smallSelect} onChange={(e) => setActions((all) => all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                    <option value="">priority…</option>
                    {["critical", "high", "medium", "low", "very_low"].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : def.input === "status" ? (
                  <select className="select" value={a.value} style={smallSelect} onChange={(e) => setActions((all) => all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                    <option value="">status…</option>
                    {["open", "in_progress", "pending", "escalated", "resolved", "closed"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                ) : def.input === "category" ? (
                  <select className="select" value={a.value} style={smallSelect} onChange={(e) => setActions((all) => all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                    <option value="">category…</option>
                    {["IT", "HR", "Access", "Software", "Hardware", "Network", "Billing", "Other"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : def.input === "target" ? (
                  <select className="select" value={a.value} style={smallSelect} onChange={(e) => setActions((all) => all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}>
                    <option value="manager">notify manager</option>
                    <option value="assignee">notify assignee</option>
                    <option value="requester">notify requester</option>
                  </select>
                ) : def.input === "text" ? (
                  <input className="input" placeholder="tag" value={a.value} style={{ flex: "1 1 120px", height: 32, fontSize: "0.78rem" }} onChange={(e) => setActions((all) => all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                ) : null}
                <button className="btn btn-ghost" aria-label="Remove action" style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }} onClick={() => setActions((all) => all.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <button className="btn btn-primary" onClick={() => void create()} disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create rule"}
        </button>
      </div>
    </div>
  );
}

function CalendarsSection({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [calendars, setCalendars] = useState<BusinessCalendarRow[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [holidays, setHolidays] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGetAll<BusinessCalendarRow>("/calendars").then(setCalendars).catch(() => setCalendars([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiSend("/calendars", "POST", {
        name: name.trim(),
        timezone: timezone.trim() || "UTC",
        holidays: holidays
          .split(/[\n,]+/)
          .map((h) => h.trim())
          .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h)),
      });
      setName("");
      setHolidays("");
      setShowForm(false);
      load();
      onChanged();
      toast.success({ title: "Calendar created", description: "Link it to SLA policies via the API or seed." });
    } catch (err) {
      toast.error({ title: "Could not create calendar", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(cal: BusinessCalendarRow) {
    if (!confirm(`Delete calendar "${cal.name}"? Policies fall back to their default window.`)) return;
    try {
      await apiSend(`/calendars/${cal.id}`, "DELETE");
      load();
      toast.info({ title: "Calendar deleted" });
    } catch (err) {
      toast.error({ title: "Could not delete", description: err instanceof Error ? err.message : String(err) });
    }
  }

  const dayLabel = (d: number) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d] ?? String(d);

  return (
    <section className="panel" style={{ padding: "1.15rem 1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <SectionHead
          icon={<CalendarIcon />}
          title="Business calendars"
          hint="SLA working hours, timezones, holidays"
          info={HINTS.businessCalendar}
        />
        <button className="btn btn-ghost" style={{ fontSize: "0.76rem" }} onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Close" : "+ New calendar"}
        </button>
      </div>

      {showForm ? (
        <div className="panel-2 anim-fade-up" style={{ padding: "0.85rem 0.95rem", marginBottom: 12, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input className="input" placeholder="Name (e.g. India Support Hours)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: "1 1 200px" }} />
            <input className="input" placeholder="IANA timezone (e.g. Asia/Kolkata)" value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ flex: "1 1 180px" }} />
          </div>
          <textarea
            className="textarea"
            rows={2}
            placeholder="Holidays, one per line or comma-separated (YYYY-MM-DD)"
            value={holidays}
            onChange={(e) => setHolidays(e.target.value)}
          />
          <div>
            <button className="btn btn-primary" onClick={() => void create()} disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create calendar"}
            </button>
            <span className="muted" style={{ fontSize: "0.72rem", marginLeft: 10 }}>
              Defaults: Mon–Fri, 09–18 in the calendar&apos;s timezone.
            </span>
          </div>
        </div>
      ) : null}

      {calendars === null ? (
        <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>Loading…</p>
      ) : calendars.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>
          No calendars yet — SLA deadlines run 24×7 (or the built-in Mon–Fri window when a policy sets business hours).
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {calendars.map((c) => (
            <div key={c.id} className="panel-2 flex items-center justify-between" style={{ padding: "0.6rem 0.8rem", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>{c.name}</div>
                <div className="muted" style={{ fontSize: "0.72rem", marginTop: 2 }}>
                  {c.timezone} · {c.workDays.map(dayLabel).join(" ")} {String(c.startHour).padStart(2, "0")}:00–{String(c.endHour).padStart(2, "0")}:00
                  {c.holidays.length ? ` · ${c.holidays.length} holiday${c.holidays.length === 1 ? "" : "s"}` : ""}
                </div>
              </div>
              <button className="btn btn-danger" style={{ fontSize: "0.72rem", padding: "0.3rem 0.6rem" }} onClick={() => void remove(c)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CalendarIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function MacrosSection({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const [macros, setMacros] = useState<MacroRow[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<MessageVisibility>("public");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGetAll<MacroRow>("/macros").then(setMacros).catch(() => setMacros([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!name.trim() || !body.trim()) return;
    setBusy(true);
    try {
      await apiSend("/macros", "POST", { name: name.trim(), body, visibility });
      setName("");
      setBody("");
      setVisibility("public");
      setShowForm(false);
      load();
      toast.success({ title: "Macro created" });
    } catch (err) {
      toast.error({ title: "Could not create macro", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(macro: MacroRow) {
    if (!confirm(`Delete macro "${macro.name}"?`)) return;
    try {
      await apiSend(`/macros/${macro.id}`, "DELETE");
      load();
      toast.info({ title: "Macro deleted" });
    } catch (err) {
      toast.error({ title: "Could not delete", description: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <section className="panel" style={{ padding: "1.15rem 1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <SectionHead
          icon={<MacroIcon />}
          title="Macros"
          hint="Canned responses agents insert into replies"
          info={HINTS.macros}
        />
        {isAdmin ? (
          <button className="btn btn-ghost" style={{ fontSize: "0.76rem" }} onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Close" : "+ New macro"}
          </button>
        ) : null}
      </div>

      {isAdmin && showForm ? (
        <div className="panel-2 anim-fade-up" style={{ padding: "0.85rem 0.95rem", marginBottom: 12, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input className="input" placeholder="Name (e.g. Ask for details)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: "1 1 200px" }} />
            <select className="select" value={visibility} onChange={(e) => setVisibility(e.target.value as MessageVisibility)} style={{ flex: "0 0 150px" }}>
              <option value="public">Public reply</option>
              <option value="internal">Internal note</option>
            </select>
          </div>
          <textarea
            className="textarea"
            rows={3}
            placeholder="Macro body. Use {{requester_name}} and {{reference}} placeholders."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div>
            <button className="btn btn-primary" onClick={() => void create()} disabled={busy || !name.trim() || !body.trim()}>
              {busy ? "Creating…" : "Create macro"}
            </button>
          </div>
        </div>
      ) : null}

      {macros === null ? (
        <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>Loading…</p>
      ) : macros.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>No macros yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {macros.map((m) => (
            <div key={m.id} className="panel-2 flex items-center justify-between" style={{ padding: "0.6rem 0.8rem", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                  {m.name}
                  <span className="badge" style={{ fontSize: "0.6rem", background: m.visibility === "internal" ? "var(--warning-bg)" : "var(--info-bg)", color: m.visibility === "internal" ? "var(--warning-fg)" : "var(--info-fg)", borderColor: m.visibility === "internal" ? "var(--warning-border)" : "var(--info-border)" }}>
                    {m.visibility === "internal" ? "Note" : "Reply"}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: "0.72rem", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 460 }}>
                  {m.body}
                </div>
              </div>
              {isAdmin ? (
                <button className="btn btn-danger" style={{ fontSize: "0.72rem", padding: "0.3rem 0.6rem" }} onClick={() => void remove(m)}>
                  Delete
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CustomFieldsSection() {
  const toast = useToast();
  const [fields, setFields] = useState<CustomFieldDefRow[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGetAll<CustomFieldDefRow>("/custom-fields").then(setFields).catch(() => setFields([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await apiSend("/custom-fields", "POST", {
        label: label.trim(),
        description: description.trim() || null,
        type,
        required,
        options: type === "select" ? options.split(/[\n,]+/).map((o) => o.trim()).filter(Boolean) : [],
      });
      setLabel("");
      setDescription("");
      setOptions("");
      setType("text");
      setRequired(false);
      setShowForm(false);
      load();
      toast.success({ title: "Custom field created" });
    } catch (err) {
      toast.error({ title: "Could not create field", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(field: CustomFieldDefRow) {
    if (!confirm(`Delete custom field "${field.label}"? Existing ticket values are kept but no longer shown.`)) return;
    try {
      await apiSend(`/custom-fields/${field.id}`, "DELETE");
      load();
      toast.info({ title: "Custom field deleted" });
    } catch (err) {
      toast.error({ title: "Could not delete", description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function saveDescription(field: CustomFieldDefRow, description: string) {
    try {
      await apiSend(`/custom-fields/${field.id}`, "PATCH", { description: description || null });
      load();
      toast.success({ title: "Help text saved", description: field.label });
    } catch (err) {
      toast.error({ title: "Could not save help text", description: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <section className="panel" style={{ padding: "1.15rem 1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <SectionHead
          icon={<FieldIcon />}
          title="Custom fields"
          hint="Extra ticket fields for this tenant"
          info={HINTS.customFields}
        />
        <button className="btn btn-ghost" style={{ fontSize: "0.76rem" }} onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Close" : "+ New field"}
        </button>
      </div>

      {showForm ? (
        <div className="panel-2 anim-fade-up" style={{ padding: "0.85rem 0.95rem", marginBottom: 12, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input className="input" placeholder="Label (e.g. Cost center)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: "1 1 200px" }} />
            <select className="select" value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} style={{ flex: "0 0 140px" }}>
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="select">Select</option>
              <option value="date">Date</option>
              <option value="checkbox">Checkbox</option>
            </select>
          </div>
          {type === "select" ? (
            <textarea
              className="textarea"
              rows={2}
              placeholder="Options, one per line or comma-separated"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
            />
          ) : null}
          <div>
            <label className="label" htmlFor="cf-help-text" style={{ marginBottom: 4, display: "block" }}>
              <LabelWithHint info={HINTS.customFieldHelp} side="right" size={12}>
                Help text
              </LabelWithHint>
            </label>
            <input
              id="cf-help-text"
              className="input"
              placeholder="Explain what this field is for (shown on the field's info icon)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem" }}>
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            Required
          </label>
          <div>
            <button className="btn btn-primary" onClick={() => void create()} disabled={busy || !label.trim()}>
              {busy ? "Creating…" : "Create field"}
            </button>
          </div>
        </div>
      ) : null}

      {fields === null ? (
        <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>Loading…</p>
      ) : fields.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>No custom fields yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {fields.map((f) => (
            <div key={f.id} className="panel-2" style={{ padding: "0.6rem 0.8rem" }}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>
                    <LabelWithHint info={customFieldHint(f)} size={12}>
                      {f.label}
                      {f.required ? <span style={{ color: "var(--danger-fg)", marginLeft: 4 }}>*</span> : null}
                    </LabelWithHint>
                  </div>
                  <div className="muted" style={{ fontSize: "0.72rem", marginTop: 2 }}>
                    {f.type}
                    {f.type === "select" && f.options.length ? ` · ${f.options.join(", ")}` : ""} · key: {f.key}
                  </div>
                </div>
                <button className="btn btn-danger" style={{ fontSize: "0.72rem", padding: "0.3rem 0.6rem" }} onClick={() => void remove(f)}>
                  Delete
                </button>
              </div>
              <input
                className="input"
                aria-label={`Help text for ${f.label}`}
                placeholder="Help text shown on the field's info icon (optional)"
                defaultValue={f.description ?? ""}
                style={{ marginTop: 8, fontSize: "0.78rem", height: 32 }}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next === (f.description ?? "")) return;
                  void saveDescription(f, next);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MacroIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 4h16v12H5.17L4 17.17z" />
      <path d="M8 8h8M8 11h5" />
    </svg>
  );
}

function FieldIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <path d="M7 11h.01M11 11h6" />
    </svg>
  );
}

function ApiKeysSection({ keys, onChanged }: { keys: ApiKeyView[]; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"details" | "agents">("details");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState("agent");
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string; role: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);

  useEffect(() => {
    apiGetAll<UserRow>("/users")
      .then((us) =>
        setAgents(
          us.filter((u) => u.role !== "requester").map((u) => ({ id: u.id, name: u.name, role: u.role }))
        )
      )
      .catch(() => setAgents([]));
  }, []);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const resetForm = () => {
    setName("");
    setDescription("");
    setRole("agent");
    setAgentIds([]);
    setTab("details");
  };
  const toggleAgent = (id: string) =>
    setAgentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function create() {
    if (!name.trim()) {
      setTab("details");
      return;
    }
    setBusy(true);
    try {
      const created = await apiSend<ApiKeyView & { key: string }>("/api-keys", "POST", {
        name: name.trim(),
        description: description.trim() || null,
        role,
        agentIds,
      });
      setFreshKey(created.key);
      resetForm();
      setOpen(false);
      onChanged();
      toast.success({ title: "Integration created", description: "Copy the key now — it won't be shown again." });
    } catch (err) {
      toast.error({ title: "Could not create integration", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k: ApiKeyView) {
    if (!confirm(`Revoke "${k.name}"? Integrations using it will stop working immediately.`)) return;
    try {
      await apiSend(`/api-keys/${k.id}`, "DELETE");
      onChanged();
      toast.info({ title: "API key revoked", description: k.prefix + "…" });
    } catch (err) {
      toast.error({ title: "Could not revoke key", description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function copyFresh() {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(freshKey);
      toast.success({ title: "Copied to clipboard" });
    } catch {
      toast.error({ title: "Could not copy" });
    }
  }

  return (
    <section className="panel" style={{ padding: "1.15rem 1.25rem" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12, gap: 10 }}>
        <SectionHead
          icon={<KeyIcon />}
          title="API integrations"
          hint="Register an application, choose the agents it acts as, then mint a key."
          info={HINTS.apiKeys}
        />
        <button
          className="btn btn-ghost"
          style={{ flexShrink: 0 }}
          onClick={() => {
            setFreshKey(null);
            setOpen((o) => !o);
          }}
        >
          {open ? "Close" : "+ New integration"}
        </button>
      </div>

      {freshKey ? (
        <div
          className="anim-scale-in"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0.7rem 0.85rem",
            borderRadius: 10,
            background: "var(--warning-bg)",
            border: "1px solid var(--warning-border)",
            color: "var(--warning-fg)",
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: "0.78rem", fontWeight: 700, flexShrink: 0 }}>Copy this key now:</div>
          <code
            className="mono"
            style={{ fontSize: "0.74rem", wordBreak: "break-all", flex: 1, minWidth: 200 }}
          >
            {freshKey}
          </code>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-primary" style={{ fontSize: "0.72rem", padding: "0.3rem 0.6rem" }} onClick={() => void copyFresh()}>
              Copy
            </button>
            <button className="btn btn-ghost" style={{ fontSize: "0.72rem", padding: "0.3rem 0.6rem" }} onClick={() => setFreshKey(null)}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      {open ? (
        <div className="panel-2 anim-fade-up" style={{ padding: "0.9rem", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            <button
              type="button"
              className={tab === "details" ? "btn btn-primary" : "btn btn-ghost"}
              style={{ fontSize: "0.74rem", padding: "0.3rem 0.7rem" }}
              onClick={() => setTab("details")}
            >
              1. Details
            </button>
            <button
              type="button"
              className={tab === "agents" ? "btn btn-primary" : "btn btn-ghost"}
              style={{ fontSize: "0.74rem", padding: "0.3rem 0.7rem" }}
              onClick={() => setTab("agents")}
            >
              2. Agents{agentIds.length ? ` (${agentIds.length})` : ""}
            </button>
          </div>

          {tab === "details" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                className="input"
                placeholder="Application name (e.g. Zabbix integration)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <textarea
                className="input"
                placeholder="What is this integration for? (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                style={{ resize: "vertical" }}
              />
              <label className="muted" htmlFor="api-key-role" style={{ fontSize: "0.74rem", fontWeight: 600 }}>
                <LabelWithHint info={HINTS.apiActingRole} side="right" size={12}>
                  Acting role
                </LabelWithHint>
              </label>
              <select id="api-key-role" className="select" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="requester">requester</option>
                <option value="agent">agent</option>
                <option value="manager">manager</option>
                <option value="tenant_admin">tenant admin</option>
              </select>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 4px" }}>
                Select the agent(s) this integration acts on behalf of.
              </p>
              {agents.length === 0 ? (
                <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>No agents available.</p>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                    gap: 6,
                    maxHeight: 220,
                    overflowY: "auto",
                  }}
                >
                  {agents.map((a) => (
                    <label
                      key={a.id}
                      className="panel-2"
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.4rem 0.6rem", cursor: "pointer" }}
                    >
                      <input type="checkbox" checked={agentIds.includes(a.id)} onChange={() => toggleAgent(a.id)} />
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            display: "block",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {a.name}
                        </span>
                        <span className="muted" style={{ fontSize: "0.66rem", textTransform: "capitalize" }}>
                          {a.role.replace("_", " ")}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 12 }}>
            <button
              className="btn btn-ghost"
              onClick={() => {
                resetForm();
                setOpen(false);
              }}
            >
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void create()} disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Generate key"}
            </button>
          </div>
        </div>
      ) : null}

      {keys.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>
          No API keys yet. Create one for each integration so access can be revoked independently.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {keys.map((k) => (
            <div
              key={k.id}
              className="panel-2 flex items-center justify-between"
              style={{ padding: "0.6rem 0.8rem", gap: 10, opacity: k.active ? 1 : 0.55 }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>{k.name}</span>
                  <code className="mono muted" style={{ fontSize: "0.7rem" }}>{k.prefix}…</code>
                  <span className="badge" style={{ fontSize: "0.64rem", textTransform: "capitalize" }}>{String(k.role).replace("_", " ")}</span>
                  {!k.active ? (
                    <span className="badge" style={{ fontSize: "0.64rem", background: "var(--danger-bg)", color: "var(--danger-fg)", borderColor: "var(--danger-border)" }}>
                      revoked
                    </span>
                  ) : null}
                </div>
                {k.description ? (
                  <div className="muted" style={{ fontSize: "0.72rem", marginTop: 2 }}>{k.description}</div>
                ) : null}
                <div className="muted" style={{ fontSize: "0.7rem", marginTop: 2 }}>
                  {k.agentIds && k.agentIds.length
                    ? `Agents: ${k.agentIds.map(agentName).join(", ")} · `
                    : ""}
                  Created {timeAgo(k.createdAt)}
                  {k.lastUsedAt ? ` · last used ${timeAgo(k.lastUsedAt)}` : " · never used"}
                </div>
              </div>
              {k.active ? (
                <button className="btn btn-danger" style={{ fontSize: "0.72rem", padding: "0.3rem 0.6rem" }} onClick={() => void revoke(k)}>
                  Revoke
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const ROLE_OPTIONS_BY_ADMIN: Record<string, string[]> = {
  super_admin: ["requester", "agent", "manager", "tenant_admin", "super_admin"],
  tenant_admin: ["requester", "agent", "manager"],
};

function UsersSection({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const toast = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [orgs, setOrgs] = useState<TenantRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "agent", departmentId: "", organizationId: "" });

  const roleOptions = isSuperAdmin
    ? ROLE_OPTIONS_BY_ADMIN.super_admin
    : ROLE_OPTIONS_BY_ADMIN.tenant_admin;

  const load = useCallback(() => {
    apiGetAll<UserRow>("/users").then(setUsers).catch(() => setUsers([]));
    apiGetAll<DepartmentRow>("/departments").then(setDepartments).catch(() => setDepartments([]));
    if (isSuperAdmin) apiGetAll<TenantRow>("/organizations").then(setOrgs).catch(() => setOrgs([]));
  }, [isSuperAdmin]);
  useEffect(() => {
    load();
  }, [load]);

  const deptName = (id?: string | null) => departments.find((d) => d.id === id)?.name ?? "—";

  async function create() {
    if (!form.name.trim() || !form.email.trim()) return;
    setBusy(true);
    try {
      await apiSend("/users", "POST", {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        departmentId: form.departmentId || null,
        ...(form.organizationId ? { organizationId: form.organizationId } : {}),
      });
      toast.success({ title: "User created", description: form.email.trim() });
      setForm({ name: "", email: "", role: "agent", departmentId: "", organizationId: "" });
      setOpen(false);
      load();
    } catch (err) {
      toast.error({ title: "Could not create user", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(u: UserRow, role: string) {
    if (role === u.role) return;
    try {
      await apiSend(`/users/${u.id}`, "PATCH", { role });
      toast.success({ title: "Role updated", description: `${u.name} → ${role.replace("_", " ")}` });
      load();
    } catch (err) {
      toast.error({ title: "Could not update role", description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function toggleActive(u: UserRow) {
    try {
      if (u.active) {
        await apiSend(`/users/${u.id}`, "DELETE");
        toast.info({ title: "User deactivated", description: u.name });
      } else {
        await apiSend(`/users/${u.id}`, "PATCH", { active: true });
        toast.success({ title: "User reactivated", description: u.name });
      }
      load();
    } catch (err) {
      toast.error({ title: "Could not update user", description: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <section className="panel" style={{ padding: "1.15rem 1.25rem" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12, gap: 10 }}>
        <SectionHead icon={<UsersIcon />} title="Users" hint="Create people and assign their role and department." />
        <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "+ New user"}
        </button>
      </div>

      {open ? (
        <div
          className="panel-2 anim-fade-up"
          style={{
            padding: "0.9rem",
            marginBottom: 12,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 8,
          }}
        >
          <input className="input" placeholder="Full name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <input className="input" placeholder="name@company.com" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          <select className="select" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {r.replace("_", " ")}
              </option>
            ))}
          </select>
          <select className="select" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
            <option value="">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {isSuperAdmin ? (
            <select className="select" value={form.organizationId} onChange={(e) => setForm((f) => ({ ...f, organizationId: e.target.value }))}>
              <option value="">Current organization</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : null}
          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button className="btn btn-primary" onClick={() => void create()} disabled={busy || !form.name.trim() || !form.email.trim()}>
              {busy ? "Creating…" : "Create user"}
            </button>
          </div>
        </div>
      ) : null}

      {users.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.84rem", margin: 0 }}>No users yet.</p>
      ) : (
        <div className="table-scroll" style={{ margin: "0 -1.25rem" }}>
          <table className="data-table" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ paddingLeft: "1.25rem" }}>Name</th>
                <th>Email</th>
                <th>Department</th>
                <th>Role</th>
                <th style={{ textAlign: "right", paddingRight: "1.25rem" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const canManage = roleOptions.includes(u.role);
                const opts = canManage ? roleOptions : [u.role, ...roleOptions];
                return (
                  <tr key={u.id} className="row-hover" style={{ opacity: u.active ? 1 : 0.55 }}>
                    <td style={{ paddingLeft: "1.25rem", fontWeight: 600 }}>{u.name}</td>
                    <td className="muted">{u.email}</td>
                    <td className="muted">{deptName(u.departmentId)}</td>
                    <td>
                      <select
                        className="select"
                        value={u.role}
                        disabled={!canManage}
                        onChange={(e) => void changeRole(u, e.target.value)}
                        style={{ fontSize: "0.74rem", padding: "0.25rem 0.4rem" }}
                      >
                        {opts.map((r) => (
                          <option key={r} value={r}>
                            {r.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: "right", paddingRight: "1.25rem" }}>
                      <button
                        className={u.active ? "btn btn-danger" : "btn btn-ghost"}
                        style={{ fontSize: "0.72rem", padding: "0.25rem 0.55rem" }}
                        disabled={!canManage}
                        onClick={() => void toggleActive(u)}
                      >
                        {u.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DepartmentsSection() {
  const toast = useToast();
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<DepartmentRow | null>(null);

  const load = useCallback(() => {
    apiGetAll<DepartmentRow>("/departments").then(setDepartments).catch(() => setDepartments([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiSend("/departments", "POST", { name: name.trim(), description: description.trim() || null });
      toast.success({ title: "Department created", description: name.trim() });
      setName("");
      setDescription("");
      setOpen(false);
      load();
    } catch (err) {
      toast.error({ title: "Could not create department", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function rename(d: DepartmentRow, next: string) {
    setBusy(true);
    try {
      await apiSend(`/departments/${d.id}`, "PATCH", { name: next });
      toast.success({ title: "Department updated" });
      setRenaming(null);
      load();
    } catch (err) {
      toast.error({ title: "Could not update", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: DepartmentRow) {
    if (!confirm(`Delete "${d.name}"? Members will be unassigned.`)) return;
    try {
      await apiSend(`/departments/${d.id}`, "DELETE");
      toast.info({ title: "Department deleted", description: d.name });
      load();
    } catch (err) {
      toast.error({ title: "Could not delete", description: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <section className="panel" style={{ padding: "1.15rem 1.25rem" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12, gap: 10 }}>
        <SectionHead
          icon={<DeptIcon />}
          title="Departments"
          hint="Organize people into departments within your organization."
          info={HINTS.departments}
        />
        <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "+ New department"}
        </button>
      </div>
      {open ? (
        <div className="panel-2 anim-fade-up" style={{ padding: "0.9rem", marginBottom: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input className="input" placeholder="Department name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: "1 1 180px" }} />
          <input className="input" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} style={{ flex: "1 1 180px" }} />
          <button className="btn btn-primary" onClick={() => void create()} disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      ) : null}
      {departments.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.84rem", margin: 0 }}>No departments yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {departments.map((d) => (
            <div key={d.id} className="panel-2 flex items-center justify-between" style={{ padding: "0.6rem 0.8rem", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>{d.name}</div>
                {d.description ? <div className="muted" style={{ fontSize: "0.72rem" }}>{d.description}</div> : null}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="btn btn-ghost" style={{ fontSize: "0.72rem", padding: "0.25rem 0.55rem" }} onClick={() => setRenaming(d)}>
                  Rename
                </button>
                <button className="btn btn-danger" style={{ fontSize: "0.72rem", padding: "0.25rem 0.55rem" }} onClick={() => void remove(d)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <PromptDialog
        open={renaming !== null}
        title="Rename department"
        description="Members keep their membership; only the display name changes."
        label="Department name"
        initialValue={renaming?.name ?? ""}
        confirmLabel="Rename"
        required
        busy={busy}
        onCancel={() => setRenaming(null)}
        onConfirm={(next) => {
          if (renaming) void rename(renaming, next);
        }}
      />
    </section>
  );
}

function OrganizationsSection() {
  const toast = useToast();
  const [orgs, setOrgs] = useState<TenantRow[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGetAll<TenantRow>("/organizations").then(setOrgs).catch(() => setOrgs([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiSend("/organizations", "POST", { name: name.trim() });
      toast.success({ title: "Organization created", description: name.trim() });
      setName("");
      setOpen(false);
      load();
    } catch (err) {
      toast.error({ title: "Could not create organization", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ padding: "1.15rem 1.25rem" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12, gap: 10 }}>
        <SectionHead
          icon={<OrgIcon />}
          title="Organizations"
          hint="Provision additional organizations (tenants)."
          info={HINTS.organizations}
        />
        <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "+ New organization"}
        </button>
      </div>
      {open ? (
        <div className="panel-2 anim-fade-up" style={{ padding: "0.9rem", marginBottom: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input className="input" placeholder="Organization name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: "1 1 220px" }} />
          <button className="btn btn-primary" onClick={() => void create()} disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      ) : null}
      {orgs.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.84rem", margin: 0 }}>No organizations yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {orgs.map((o) => (
            <div key={o.id} className="panel-2 flex items-center justify-between" style={{ padding: "0.6rem 0.8rem", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 700 }}>{o.name}</div>
                <div className="muted" style={{ fontSize: "0.72rem" }}>
                  {o.slug}
                  {o.isInternal ? " · internal" : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DeptIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 21h18M6 21V7l6-4 6 4v14" />
      <path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 21v-4h4v4" />
    </svg>
  );
}

function OrgIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 9h4a2 2 0 0 1 2 2v10" />
      <path d="M9 7h2M9 11h2M9 15h2" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function segStyle(active: boolean): React.CSSProperties {
  return {
    padding: "0.3rem 0.6rem",
    borderRadius: 999,
    background: active ? "var(--surface)" : "transparent",
    color: active ? "var(--text)" : "var(--muted)",
    boxShadow: active ? "var(--shadow-sm)" : "none",
    transition: "background var(--dur-2) var(--ease)",
    fontSize: "0.75rem",
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  };
}

function SectionHead({
  icon,
  title,
  hint,
  info,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  info?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
      <span
        aria-hidden
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: "var(--brand-50)",
          color: "var(--brand-700)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div>
        <div style={{ fontSize: "0.92rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
          <LabelWithHint info={info}>{title}</LabelWithHint>
        </div>
        {hint ? <div className="muted" style={{ fontSize: "0.7rem" }}>{hint}</div> : null}
      </div>
    </div>
  );
}

function HealthCell({
  label,
  value,
  ok,
  neutral,
  info,
}: {
  label: string;
  value: string;
  ok?: boolean;
  neutral?: boolean;
  info?: string;
}) {
  return (
    <div className="panel-2" style={{ padding: "0.75rem 0.9rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: neutral ? "var(--muted-soft)" : ok ? "var(--success-solid)" : "var(--danger-solid)",
            flexShrink: 0,
          }}
        />
        <span className="label" style={{ margin: 0 }}>
          <LabelWithHint info={info}>{label}</LabelWithHint>
        </span>
      </div>
      <span style={{ fontSize: "0.9rem", fontWeight: 700, wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function Switch({
  checked,
  label,
  onChange,
  disabled = false,
  title,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      title={title}
      style={{
        position: "relative",
        width: 40,
        height: 23,
        borderRadius: 999,
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        background: checked ? "var(--brand-gradient)" : "var(--surface-3)",
        transition: "background 0.2s var(--ease), opacity 0.2s var(--ease)",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2.5,
          left: checked ? 19.5 : 2.5,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "var(--shadow-sm)",
          transition: "left 0.2s var(--ease)",
        }}
      />
    </button>
  );
}

function formatMins(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / (24 * 60))}d`;
}

/* icons */
const ic = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function PulseIcon() {
  return (
    <svg {...ic}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
function GaugeIcon() {
  return (
    <svg {...ic}>
      <path d="M12 14l4-4" />
      <path d="M3 12a9 9 0 0 1 18 0" />
      <circle cx="12" cy="14" r="1.5" />
    </svg>
  );
}
function UsersIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function BoltIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
    </svg>
  );
}
function SunIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
function MoonIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

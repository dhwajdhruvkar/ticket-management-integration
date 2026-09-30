"use client";
import { useEffect, useState } from "react";
import { apiGet, apiGetAll, apiSend } from "@/lib/api";
import { defaultWorkflowSettings, type WorkflowSettings as Settings } from "@/shared/workflow";
import type { AssignmentGroupRow, DepartmentRow, UserRow } from "@/server/domain/models";
import { PRIORITY_ORDER, priorityCode } from "@/shared/priority";

export function WorkflowSettings() {
  const [settings, setSettings] = useState<Settings>(defaultWorkflowSettings);
  const [groups, setGroups] = useState<AssignmentGroupRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [managers, setManagers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([apiGet<Settings>("/workflow/settings"), apiGetAll<AssignmentGroupRow>("/groups"), apiGetAll<DepartmentRow>("/departments"), apiGetAll<UserRow>("/users")]).then(([value, teams, depts, users]) => {
      if (!live) return;
      setSettings(value); setGroups(teams); setDepartments(depts);
      setManagers(users.filter((user) => user.active && ["manager", "tenant_admin", "super_admin"].includes(user.role)));
    }).catch((error: Error) => { if (live) { setMessage(error.message); setLoadError(true); } }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  async function save() {
    setSaving(true); setMessage("");
    try { setSettings(await apiSend<Settings>("/workflow/settings", "PATCH", settings)); setMessage("Workflow settings saved. Existing tickets keep their workflow."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save workflow."); }
    finally { setSaving(false); }
  }
  function bucketChange(index: number, patch: Partial<Settings["buckets"][number]>) {
    setSettings((value) => ({ ...value, buckets: value.buckets.map((bucket, i) => i === index ? { ...bucket, ...patch } : bucket) }));
  }
  return <section className="panel" style={{ padding: 20 }} aria-labelledby="workflow-settings-heading">
    <h2 id="workflow-settings-heading">Service-desk workflow</h2>
    <p className="muted">Create assignment groups and their members first. Configure a service desk, department buckets and different manager/RM accounts before enabling.</p>
    {loading ? <p role="status">Loading workflow settings…</p> : loadError ? <p role="alert">Settings could not be loaded. Reload the page before editing.</p> : <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <label>Reporting timezone<input className="input" value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} placeholder="Asia/Kolkata" /></label>
        <label>Availability source<select className="select" value={settings.availabilityMode} onChange={(e) => setSettings({ ...settings, availabilityMode: e.target.value as Settings["availabilityMode"] })}>
          <option value="automatic">Teams when configured; otherwise in-app</option><option value="in_app">In-app only</option>
        </select></label>
      </div>
      {settings.buckets.map((bucket, index) => <fieldset key={index} style={{ marginTop: 16, padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
        <legend>{bucket.kind === "service_desk" ? "Service-desk bucket" : "Department bucket"}</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <label>Assignment group<select className="select" value={bucket.groupId} onChange={(e) => {
            const groupId = e.target.value; bucketChange(index, { groupId });
            if (bucket.kind === "service_desk") setSettings((value) => ({ ...value, serviceDeskGroupId: groupId }));
          }}><option value="">Choose group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          {bucket.kind === "department" && <label>Department<select className="select" value={bucket.departmentId ?? ""} onChange={(e) => bucketChange(index, { departmentId: e.target.value })}><option value="">Choose department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>}
          {(["managerId", "seniorRmId"] as const).map((field) => <label key={field}>{field === "managerId" ? "Manager" : "Senior RM"}<select className="select" value={bucket[field]} onChange={(e) => bucketChange(index, { [field]: e.target.value })}><option value="">Choose account</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>)}
        </div>
        <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setSettings((value) => ({ ...value, buckets: value.buckets.filter((_, i) => i !== index), ...(bucket.kind === "service_desk" ? { serviceDeskGroupId: "" } : {}) }))}>Remove bucket configuration</button>
      </fieldset>)}
      <div className="flex items-center" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {!settings.buckets.some((bucket) => bucket.kind === "service_desk") && <button className="btn" onClick={() => setSettings({ ...settings, buckets: [...settings.buckets, { kind: "service_desk", groupId: "", managerId: "", seniorRmId: "" }] })}>Add service-desk bucket</button>}
        <button className="btn" onClick={() => setSettings({ ...settings, buckets: [...settings.buckets, { kind: "department", groupId: "", departmentId: "", managerId: "", seniorRmId: "" }] })}>Add department bucket</button>
      </div>
      <h3 style={{ marginTop: 20 }}>Unattended-ticket deadlines</h3>
      <p className="muted">Minutes in the ticket’s SLA calendar. Warn at 80%; notify the manager at the review/pickup deadline, then the senior RM after the additional manager window.</p>
      <div style={{ overflowX: "auto" }}><table className="table"><thead><tr><th scope="col">Priority</th><th scope="col">Review / pickup (minutes)</th><th scope="col">Manager action (minutes)</th></tr></thead><tbody>
        {PRIORITY_ORDER.map((priority) => <tr key={priority}><th scope="row">{priorityCode(priority)}</th>{(["pickupMins", "managerMins"] as const).map((field) => <td key={field}><input className="input" type="number" min={1} max={43200} aria-label={`${priorityCode(priority)} ${field}`} value={settings.stages[priority][field]} onChange={(e) => setSettings({ ...settings, stages: { ...settings.stages, [priority]: { ...settings.stages[priority], [field]: Number(e.target.value) } } })} /></td>)}</tr>)}
      </tbody></table></div>
      <label className="flex items-center" style={{ gap: 8, margin: "16px 0" }}><input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />Enable mandatory human review for new tickets</label>
      <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save workflow"}</button>
    </>}
    {message && <p role="status" style={{ marginTop: 12 }}>{message}</p>}
  </section>;
}

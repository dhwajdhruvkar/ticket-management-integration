"use client";
import { useEffect, useState } from "react";
import { apiGet, apiGetAll, apiSend } from "@/lib/api";
import { usePersona } from "./Persona";
import type { BusinessCalendarRow, UserRow } from "@/server/domain/models";
import type { AvailabilitySettings } from "@/server/services/availabilityService";

export function AvailabilityPreferences() {
  const { persona, ready } = usePersona();
  const admin = ["tenant_admin", "super_admin"].includes(persona.serverRole);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [calendars, setCalendars] = useState<BusinessCalendarRow[]>([]);
  const [selected, setSelected] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [capacity, setCapacity] = useState(5);
  const [teamsUserId, setTeamsUserId] = useState("");
  const [override, setOverride] = useState("available");
  const [minutes, setMinutes] = useState(60);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ready || persona.role !== "agent") return;
    let live = true;
    Promise.all([admin ? apiGetAll<UserRow>("/users") : apiGet<UserRow>("/me").then((user) => [user]), apiGetAll<BusinessCalendarRow>("/calendars")]).then(([staff, hours]) => {
      if (!live) return;
      const eligible = staff.filter((user) => user.active && ["agent", "manager", "tenant_admin", "super_admin"].includes(user.role));
      setUsers(eligible); setCalendars(hours); setSelected(eligible.find((user) => user.id === persona.id)?.id ?? eligible[0]?.id ?? "");
    }).catch((error: Error) => { if (live) setMessage(error.message); });
    return () => { live = false; };
  }, [ready, persona.id, persona.role, admin]);
  useEffect(() => {
    const settings = users.find((user) => user.id === selected)?.availabilitySettings;
    setCalendarId(settings?.calendarId ?? ""); setCapacity(settings?.capacity ?? 5); setTeamsUserId(settings?.teamsUserId ?? "");
  }, [selected, users]);
  async function save(schedule: boolean) {
    setBusy(true); setMessage("");
    try {
      const settings = await apiSend<AvailabilitySettings>(`/users/${selected}/availability`, "PATCH", schedule ? { calendarId, capacity, teamsUserId } : { override, overrideUntil: override === "available" ? "" : new Date(Date.now() + minutes * 60_000).toISOString() });
      setUsers((rows) => rows.map((row) => row.id === selected ? { ...row, availabilitySettings: settings } : row));
      setMessage(schedule ? "Working hours and capacity saved." : "Availability override saved; workload and working hours still apply.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update availability."); }
    finally { setBusy(false); }
  }
  if (persona.role !== "agent") return null;
  return <section className="panel" style={{ padding: 20 }}><h2>Agent availability</h2>
    <p className="muted">Availability reflects working hours, accepted workload, and timed overrides. Teams presence is used only when an administrator configures its connection and user mapping.</p>
    {admin && <label>Staff member<select className="select" value={selected} onChange={(e) => setSelected(e.target.value)}>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>}
    {admin && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, margin: "12px 0" }}>
      <label>Working-hours calendar<select className="select" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}><option value="">Not configured</option>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name} ({calendar.timezone})</option>)}</select></label>
      <label>Active-ticket capacity<input className="input" type="number" min={1} max={100} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /></label>
      <label>Microsoft user object ID (optional)<input className="input" value={teamsUserId} onChange={(e) => setTeamsUserId(e.target.value)} /></label>
      <button className="btn" disabled={busy || !selected} onClick={() => save(true)}>Save working hours &amp; capacity</button>
    </div>}
    <div className="flex items-center" style={{ gap: 12, flexWrap: "wrap", marginTop: 12 }}>
      <label>Temporary status<select className="select" value={override} onChange={(e) => setOverride(e.target.value)}><option value="available">Automatic (clear override)</option><option value="busy">Busy</option><option value="away">Away</option></select></label>
      {override !== "available" && <label>For minutes<input className="input" type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></label>}
      <button className="btn" disabled={busy || !selected || minutes < 1 || minutes > 1440} onClick={() => save(false)}>Update availability</button>
    </div>{message && <p role="status">{message}</p>}
  </section>;
}

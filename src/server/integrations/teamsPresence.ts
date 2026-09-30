import { z } from "zod";
import type { DataStore } from "../data/store";
import type { UserRow } from "../domain/models";
import type { PresenceSnapshot } from "../services/availabilityService";

const Connection = z.object({ tenantId: z.string().uuid(), clientId: z.string().uuid(), clientSecret: z.string().min(1) });
const Token = z.object({ access_token: z.string().min(1) });
const Response = z.object({ value: z.array(z.object({ id: z.string(), availability: z.string() })).max(650) });

function connectionFor(organizationId: string) {
  try {
    const connections = JSON.parse(process.env.TEAMS_PRESENCE_CONNECTIONS ?? "{}") as Record<string, unknown>;
    const result = Connection.safeParse(connections[organizationId]);
    return result.success ? result.data : null;
  } catch { return null; }
}
export function teamsPresenceConfigured(organizationId: string): boolean { return !!connectionFor(organizationId); }

/** Read-only Graph presence. Organization mapping is explicit; never fall back to another tenant's credentials. */
export async function refreshTeamsPresence(store: DataStore, organizationId: string, users: UserRow[]): Promise<UserRow[]> {
  const connection = connectionFor(organizationId);
  if (!connection) return users.map((user) => ({ ...user, presenceSnapshot: null }));
  const stale = users.filter((user) => user.tenantId === organizationId && user.active && user.availabilitySettings?.teamsUserId && (!user.presenceSnapshot || Date.now() - Date.parse(user.presenceSnapshot.checkedAt) >= 60_000));
  if (!stale.length) return users;
  const snapshots = new Map<string, PresenceSnapshot>();
  const checkedAt = new Date().toISOString();
  try {
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${connection.tenantId}/oauth2/v2.0/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "error", signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: connection.clientId, client_secret: connection.clientSecret, scope: "https://graph.microsoft.com/.default" }),
    });
    if (!tokenResponse.ok) throw new Error("Presence authorization unavailable");
    const token = Token.parse(await tokenResponse.json()).access_token;
    for (let start = 0; start < stale.length; start += 650) {
      const batch = stale.slice(start, start + 650);
      const response = await fetch("https://graph.microsoft.com/v1.0/communications/getPresencesByUserId", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(5000),
        body: JSON.stringify({ ids: batch.map((user) => user.availabilitySettings!.teamsUserId) }),
      });
      if (!response.ok) throw new Error("Presence provider unavailable");
      const data = Response.parse(await response.json());
      for (const user of batch) {
        const presence = data.value.find((row) => row.id === user.availabilitySettings!.teamsUserId)?.availability;
        const status = presence === "Available" || presence === "AvailableIdle" ? "available" : ["Busy", "BusyIdle", "DoNotDisturb"].includes(presence ?? "") ? "busy" : ["Away", "BeRightBack"].includes(presence ?? "") ? "away" : presence === "Offline" ? "offline" : "unknown";
        snapshots.set(user.id, { status, checkedAt });
      }
    }
  } catch {
    // Never log provider response bodies, tokens or credentials. The UI exposes fallback status.
    for (const user of stale) snapshots.set(user.id, { status: "unknown", checkedAt });
  }
  for (const [id, presenceSnapshot] of snapshots) await store.users.update(id, { presenceSnapshot });
  return users.map((user) => snapshots.has(user.id) ? { ...user, presenceSnapshot: snapshots.get(user.id)! } : user);
}

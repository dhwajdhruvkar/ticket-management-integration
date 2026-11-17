// Microsoft Graph app-only token (client credentials) with a small in-memory
// cache. Callers keep their own error handling: this throws GraphTokenError
// and never logs credentials.

export class GraphTokenError extends Error {
  constructor(readonly status: number, message = `Graph token ${status}`) {
    super(message);
    this.name = "GraphTokenError";
  }
}

export interface GraphCredentials {
  tenantId: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
}

const SAFETY_MARGIN_MS = 60_000;
const cache = new Map<string, { token: string; expiresAt: number }>();

export function clearGraphTokenCache(): void {
  cache.clear();
}

export async function getGraphToken({ tenantId, clientId, clientSecret }: GraphCredentials, now = Date.now()): Promise<string> {
  const key = `${tenantId}\u0000${clientId}\u0000${clientSecret}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.token;
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(5_000),
    redirect: "error",
    body: new URLSearchParams({
      client_id: clientId ?? "",
      client_secret: clientSecret ?? "",
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new GraphTokenError(res.status);
  const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) throw new GraphTokenError(res.status, "Graph token response had no access token");
  const lifetimeMs = typeof body.expires_in === "number" && Number.isFinite(body.expires_in) ? body.expires_in * 1000 : 0;
  if (lifetimeMs > SAFETY_MARGIN_MS) cache.set(key, { token: body.access_token, expiresAt: now + lifetimeMs - SAFETY_MARGIN_MS });
  return body.access_token;
}

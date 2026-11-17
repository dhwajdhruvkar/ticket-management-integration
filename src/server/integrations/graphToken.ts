// Microsoft Graph app-only token (client credentials) with a small in-memory
// cache. Callers keep their own error handling: this throws GraphTokenError
// and never logs credentials.
import { createHash } from "node:crypto";

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
const TIMEOUT_MS = 5_000;
// A directory id (GUID) or verified domain; anything else could change the token URL's path.
const TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const cache = new Map<string, { token: string; expiresAt: number }>();
// One token request per credential set at a time; concurrent callers share it.
const inflight = new Map<string, Promise<string>>();

export function clearGraphTokenCache(): void {
  cache.clear();
  inflight.clear();
}

/** Cache key derived from the credentials by hash, so the secret itself is never held as a map key. */
function cacheKey(tenantId: string, clientId: string, clientSecret: string): string {
  return createHash("sha256").update(`${tenantId}\u0000${clientId}\u0000${clientSecret}`).digest("hex");
}

async function requestToken(tenantId: string, clientId: string, clientSecret: string, key: string, now: number): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
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

export async function getGraphToken({ tenantId, clientId, clientSecret }: GraphCredentials, now = Date.now()): Promise<string> {
  // Incomplete or malformed credentials fail here, before any network call; the message never includes them.
  if (!tenantId || !clientId || !clientSecret || !TENANT_PATTERN.test(tenantId)) {
    throw new GraphTokenError(0, "Graph credentials are missing or malformed");
  }
  const key = cacheKey(tenantId, clientId, clientSecret);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.token;
  const pending = inflight.get(key);
  if (pending) return pending;
  // Failures are not cached; the entry is removed either way so the next call can retry.
  const request = requestToken(tenantId, clientId, clientSecret, key, now).finally(() => {
    if (inflight.get(key) === request) inflight.delete(key);
  });
  inflight.set(key, request);
  return request;
}

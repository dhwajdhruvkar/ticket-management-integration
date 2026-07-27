// Thin client for the /api/v1 REST surface. Unwraps the { ok, data } envelope.
// Identity comes from the NextAuth session cookie, which the browser attaches
// automatically — the server resolves role, permissions and record security.

/**
 * Carries the HTTP status alongside the message so callers can tell "this row
 * does not exist" (404) from "the request failed" (401/500/offline) and show
 * the right thing. Every rejection from this module is an ApiError.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }

  get notFound(): boolean {
    return this.status === 404;
  }

  get forbidden(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

async function handle<T>(res: Response): Promise<T> {
  let json: { ok?: boolean; data?: T; error?: string } | null = null;
  try {
    json = (await res.json()) as { ok?: boolean; data?: T; error?: string };
  } catch {
    // A proxy timeout or a crashed route can answer with HTML; don't let the
    // JSON parse error masquerade as the API's own message.
    throw new ApiError(`Request failed (${res.status}).`, res.status);
  }
  if (!res.ok || !json.ok) {
    throw new ApiError(json.error ?? `Request failed (${res.status}).`, res.status);
  }
  return json.data as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { cache: "no-store" });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0);
  }
  return handle<T>(res);
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0);
  }
  return handle<T>(res);
}

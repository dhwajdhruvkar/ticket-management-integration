// Thin client for the /api/v1 REST surface. Unwraps the { ok, data } envelope.
// Identity comes from the NextAuth session cookie, which the browser attaches
// automatically — the server resolves role, permissions and record security.

async function handle<T>(res: Response): Promise<T> {
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!res.ok || !json.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json.data as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return handle<T>(await fetch(`/api/v1${path}`, { cache: "no-store" }));
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> {
  return handle<T>(
    await fetch(`/api/v1${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
}

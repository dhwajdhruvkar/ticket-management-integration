// Thin client for the /api/v1 REST surface. Unwraps the { ok, data } envelope.
// Identity comes from the NextAuth session cookie, which the browser attaches
// automatically — the server resolves role, permissions and record security.

import type { AttachmentRow } from "@/server/domain/models";

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

export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  /** Backward-compatible alias returned by the API. */
  limit: number;
  totalPages: number;
  /** Per-saved-view ticket counts (ticket explorer queries only). */
  counts?: Record<string, number>;
}

interface ApiEnvelope<T> {
  ok?: boolean;
  data?: T;
  error?: string;
  meta?: PageMeta;
}

async function readEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
  let json: ApiEnvelope<T> | null = null;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    // A proxy timeout or a crashed route can answer with HTML; don't let the
    // JSON parse error masquerade as the API's own message.
    throw new ApiError(`Request failed (${res.status}).`, res.status);
  }
  if (!res.ok || !json.ok) {
    throw new ApiError(json.error ?? `Request failed (${res.status}).`, res.status);
  }
  return json;
}

async function handle<T>(res: Response): Promise<T> {
  return (await readEnvelope<T>(res)).data as T;
}

async function getResponse(path: string): Promise<Response> {
  try {
    return await fetch(`/api/v1${path}`, { cache: "no-store" });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  return handle<T>(await getResponse(path));
}

/** One page of a list plus its pagination metadata. */
export async function apiGetPage<T>(path: string): Promise<{ data: T[]; meta: PageMeta }> {
  const envelope = await readEnvelope<T[]>(await getResponse(path));
  if (!Array.isArray(envelope.data) || !envelope.meta) throw new ApiError("Expected a paginated array response.", 500);
  return { data: envelope.data, meta: envelope.meta };
}

/**
 * Read every page of an array list without silently truncating existing UI
 * consumers when server-side pagination is enabled.
 */
export async function apiGetAll<T>(path: string): Promise<T[]> {
  const url = new URL(path, "http://api.local");
  url.searchParams.delete("limit");
  url.searchParams.set("pageSize", "100");

  const rows: T[] = [];
  let page = 1;
  while (true) {
    url.searchParams.set("page", String(page));
    const requestPath = `${url.pathname}${url.search}`;
    const envelope = await readEnvelope<T[]>(await getResponse(requestPath));
    const data = envelope.data;
    if (!Array.isArray(data)) {
      throw new ApiError("Expected a paginated array response.", 500);
    }
    rows.push(...data);

    const meta = envelope.meta;
    if (!meta || page >= meta.totalPages) return rows;
    if (
      !Number.isSafeInteger(meta.totalPages) ||
      meta.totalPages < 0 ||
      meta.page !== page
    ) {
      throw new ApiError("Invalid pagination metadata returned by the server.", 500);
    }
    page += 1;
  }
}

/** POST multipart form data. The browser sets the Content-Type boundary, so no header is passed. */
export async function apiSendForm<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method: "POST", body: form });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0);
  }
  return handle<T>(res);
}

/**
 * Upload one file to a ticket (a single "file" part per request, so large
 * batches never exceed the platform body limit). Resolves with the stored
 * attachment row; rejects with an ApiError carrying a readable message.
 */
export function uploadTicketAttachment(
  ticketId: string,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<AttachmentRow> {
  return new Promise<AttachmentRow>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1/tickets/${encodeURIComponent(ticketId)}/attachments`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onerror = () => reject(new ApiError("Could not reach the server. Check your connection and try again.", 0));
    xhr.onabort = () => reject(new ApiError("Upload cancelled.", 0));
    xhr.onload = () => {
      let body = null as { ok?: boolean; data?: AttachmentRow[]; error?: string } | null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Proxies answer 413/502 with HTML; fall through to a status-based message.
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.ok && body.data?.[0]) {
        onProgress?.(100);
        return resolve(body.data[0]);
      }
      const fallback =
        xhr.status === 413 ? "The file is too large to upload."
        : xhr.status === 429 ? "Too many uploads right now. Wait a moment and retry."
        : `Upload failed (${xhr.status || "no response"}).`;
      reject(new ApiError(body?.error ?? fallback, xhr.status));
    };
    if (signal) {
      if (signal.aborted) return reject(new ApiError("Upload cancelled.", 0));
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
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

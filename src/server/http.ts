import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import type { ListOptions } from "./data/store";

// Uniform JSON envelope for the /api/v1 surface.

/** Maximum JSON/text request-body size (bytes). */
export const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1 MB

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(error: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

export type SortDirection = "asc" | "desc";

export interface PaginationOptions<K extends string> {
  defaultSortBy: K;
  allowedSortBy: readonly K[];
  defaultSortDir?: SortDirection;
  allowedSortDirs?: readonly SortDirection[];
  defaultPageSize?: number;
  maxPageSize?: number;
}

export interface ParsedPagination<K extends string> {
  page: number;
  pageSize: number;
  /** Backward-compatible alias for clients that still consume limit. */
  limit: number;
  skip: number;
  take: number;
  sortBy: K;
  sortDir: SortDirection;
}

export type PaginationParseResult<K extends string> =
  | { ok: true; value: ParsedPagination<K> }
  | { ok: false; response: NextResponse };

export function paginated<T, K extends string>(
  data: T,
  total: number,
  pagination: Pick<ParsedPagination<K>, "page" | "pageSize">
): NextResponse {
  const { page, pageSize } = pagination;
  const totalPages = Math.ceil(total / pageSize);
  return NextResponse.json({
    ok: true,
    data,
    meta: { total, page, pageSize, limit: pageSize, totalPages },
  });
}

function parsePositiveInteger(raw: string, name: string): number | NextResponse {
  if (!/^[1-9]\d*$/.test(raw)) return fail(name + " must be a positive integer.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return fail(name + " is too large.");
  return value;
}

export function parsePagination<K extends string>(
  req: Request,
  options: PaginationOptions<K>
): PaginationParseResult<K> {
  const url = new URL(req.url);
  const maxPageSize = options.maxPageSize ?? 100;
  const defaultPageSize = options.defaultPageSize ?? 50;
  const pageRaw = url.searchParams.get("page") ?? "1";
  const pageSizeRaw = url.searchParams.get("pageSize");
  const legacyLimitRaw = url.searchParams.get("limit");

  if (
    pageSizeRaw !== null &&
    legacyLimitRaw !== null &&
    pageSizeRaw !== legacyLimitRaw
  ) {
    return {
      ok: false,
      response: fail("pageSize and limit must match when both are provided."),
    };
  }

  const parsedPage = parsePositiveInteger(pageRaw, "page");
  if (parsedPage instanceof NextResponse) return { ok: false, response: parsedPage };

  const sizeRaw = pageSizeRaw ?? legacyLimitRaw ?? String(defaultPageSize);
  const parsedPageSize = parsePositiveInteger(sizeRaw, "pageSize");
  if (parsedPageSize instanceof NextResponse) return { ok: false, response: parsedPageSize };
  if (parsedPageSize > maxPageSize) {
    return { ok: false, response: fail("pageSize must be at most " + maxPageSize + ".") };
  }

  const sortByRaw = url.searchParams.get("sortBy") ?? options.defaultSortBy;
  if (!options.allowedSortBy.includes(sortByRaw as K)) {
    return {
      ok: false,
      response: fail("sortBy must be one of: " + options.allowedSortBy.join(", ") + "."),
    };
  }

  const sortDirRaw = url.searchParams.get("sortDir") ?? options.defaultSortDir ?? "desc";
  const allowedSortDirs = options.allowedSortDirs ?? (["asc", "desc"] as const);
  if (!allowedSortDirs.includes(sortDirRaw as SortDirection)) {
    return {
      ok: false,
      response: fail("sortDir must be one of: " + allowedSortDirs.join(", ") + "."),
    };
  }

  const skip = (parsedPage - 1) * parsedPageSize;
  if (!Number.isSafeInteger(skip)) {
    return { ok: false, response: fail("Requested page is too large.") };
  }

  return {
    ok: true,
    value: {
      page: parsedPage,
      pageSize: parsedPageSize,
      limit: parsedPageSize,
      skip,
      take: parsedPageSize,
      sortBy: sortByRaw as K,
      sortDir: sortDirRaw as SortDirection,
    },
  };
}

export function listOptionsFromPagination<T>(
  pagination: ParsedPagination<Extract<keyof T, string>>
): ListOptions<T> {
  return {
    skip: pagination.skip,
    take: pagination.take,
    orderBy: { field: pagination.sortBy, dir: pagination.sortDir },
  };
}

function declaredLengthExceeds(req: Request, maxBytes: number): boolean {
  const raw = req.headers.get("content-length")?.trim();
  if (!raw || !/^\d+$/.test(raw)) return false;
  try {
    return BigInt(raw) > BigInt(maxBytes);
  } catch {
    return false;
  }
}

/**
 * Read a request stream while enforcing the limit on bytes actually received.
 * Content-Length is only an early rejection optimization; it is never trusted
 * as the sole size check because chunked/omitted/understated lengths are valid.
 */
async function readBoundedBytes(
  req: Request,
  maxBytes = MAX_BODY_SIZE
): Promise<Uint8Array> {
  if (declaredLengthExceeds(req, maxBytes)) {
    throw new RequestBodyTooLargeError();
  }

  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readBoundedText(
  req: Request,
  maxBytes = MAX_BODY_SIZE
): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await readBoundedBytes(req, maxBytes)
  );
}

/** Read a bounded raw body for signature verification or non-JSON payloads. */
export async function readTextBody(
  req: Request,
  maxBytes = MAX_BODY_SIZE
): Promise<string | NextResponse> {
  try {
    return await readBoundedText(req, maxBytes);
  } catch (err) {
    return err instanceof RequestBodyTooLargeError
      ? fail("Request body too large.", 413)
      : fail("Invalid request body.");
  }
}

/**
 * Parse multipart form data only after bounding the bytes actually received.
 * Native Request.formData() buffers the entire stream and provides no size cap.
 */
export async function readMultipartFormData(
  req: Request,
  maxBytes: number
): Promise<FormData | NextResponse> {
  const contentType = req.headers.get("content-type")?.trim() ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    return fail('Expected multipart/form-data with a "file" field.');
  }

  try {
    const bytes = await readBoundedBytes(req, maxBytes);
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return await new Response(body, {
      headers: { "content-type": contentType },
    }).formData();
  } catch (err) {
    return err instanceof RequestBodyTooLargeError
      ? fail("Request body too large.", 413)
      : fail('Expected multipart/form-data with a "file" field.');
  }
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return JSON.parse(await readBoundedText(req)) as T;
  } catch {
    return null;
  }
}

/**
 * Narrow a row fetched by primary key to the caller's tenant.
 *
 * Returns the row when it belongs to `tenantId`, otherwise `null`. Callers
 * should answer 404 rather than 403 on a miss: telling an outsider that an id
 * exists in another tenant is itself a leak.
 */
export function assertTenant<T extends { tenantId: string }>(
  row: T | null | undefined,
  tenantId: string
): T | null {
  if (!row) return null;
  return row.tenantId === tenantId ? row : null;
}

/**
 * Parse + validate a JSON body against a zod schema. Returns the typed value,
 * or a `NextResponse` 400 carrying the first validation issue.
 */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T | NextResponse> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedText(req));
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return fail("Request body too large.", 413);
    }
    return fail("Invalid JSON body.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path?.length ? ` at "${issue.path.join(".")}"` : "";
    return fail(`Validation failed${where}: ${issue?.message ?? "invalid input"}.`);
  }
  return result.data;
}

import { NextResponse } from "next/server";
import type { ZodType } from "zod";

// Uniform JSON envelope for the /api/v1 surface.

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(error: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
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
    raw = await req.json();
  } catch {
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

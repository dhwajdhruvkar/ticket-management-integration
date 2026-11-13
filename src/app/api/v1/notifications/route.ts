import { fail, ok, paginated, parsePagination, readJson } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { getStore } from "@/server/data";
import { now } from "@/server/domain/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in user's notification feed (bell dropdown), newest first. */
export async function GET(req: Request) {
  const ctx = await requirePermission(req, "ticket.read");
  if (isResponse(ctx)) return ctx;
  const { actor, tenantId } = ctx;
  const parsed = parsePagination(req, {
    defaultSortBy: "createdAt",
    defaultSortDir: "desc",
    allowedSortBy: ["createdAt"] as const,
    defaultPageSize: 25,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  if (!actor.email) {
    return paginated({ items: [], unread: 0 }, 0, pagination);
  }

  const store = await getStore();
  const { items, total, unread } = await store.notificationsFor(tenantId, actor.email, {
    skip: pagination.skip,
    take: pagination.take,
    dir: pagination.sortDir,
  });
  return paginated({ items, unread }, total, pagination);
}

/** Mark the caller's notifications read: { op: "mark_read", id? } (no id = all). */
export async function POST(req: Request) {
  const ctx = await requirePermission(req, "ticket.read");
  if (isResponse(ctx)) return ctx;
  const { actor, tenantId } = ctx;
  if (!actor.email) return fail("No signed-in user.", 401);

  const body = await readJson<{ op?: string; id?: string }>(req);
  if (body?.op !== "mark_read") return fail("Unsupported op.");

  const store = await getStore();
  const marked = await store.markNotificationsRead(tenantId, actor.email, now(), body.id || undefined);
  return ok({ marked });
}

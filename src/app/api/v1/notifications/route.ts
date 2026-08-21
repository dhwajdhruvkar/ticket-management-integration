import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok, paginated, parsePagination, readJson } from "@/server/http";
import { getStore } from "@/server/data";
import { now } from "@/server/domain/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in user's notification feed (bell dropdown), newest first. */
export async function GET(req: Request) {
  const [actor, tenantId] = await Promise.all([currentActor(req), currentTenantId(req)]);
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
  const all = await store.notifications.list({ tenantId });
  const mine = all
    .filter((n) => n.toAddress.toLowerCase() === actor.email!.toLowerCase())
    .sort((a, b) => {
      const primary = a.createdAt.localeCompare(b.createdAt);
      if (primary !== 0) return pagination.sortDir === "asc" ? primary : -primary;
      return a.id.localeCompare(b.id);
    });

  return paginated(
    {
      items: mine.slice(pagination.skip, pagination.skip + pagination.take),
      unread: mine.filter((n) => !n.readAt).length,
    },
    mine.length,
    pagination
  );
}

/** Mark the caller's notifications read: { op: "mark_read", id? } (no id = all). */
export async function POST(req: Request) {
  const [actor, tenantId] = await Promise.all([currentActor(req), currentTenantId(req)]);
  if (!actor.email) return fail("No signed-in user.", 401);

  const body = await readJson<{ op?: string; id?: string }>(req);
  if (body?.op !== "mark_read") return fail("Unsupported op.");

  const store = await getStore();
  const all = await store.notifications.list({ tenantId });
  const targets = all.filter(
    (n) =>
      n.toAddress.toLowerCase() === actor.email!.toLowerCase() &&
      !n.readAt &&
      (!body.id || n.id === body.id)
  );
  for (const n of targets) {
    await store.notifications.update(n.id, { readAt: now() });
  }
  return ok({ marked: targets.length });
}

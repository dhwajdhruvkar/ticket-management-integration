import type { DataStore } from "../data/store";

/** Bounded cleanup of transient metadata, never tickets, messages or audit history. */
export async function cleanWorkflowMetadata(store: DataStore, at = Date.now(), deadline = Date.now() + 3000) {
  if (Date.now() >= deadline) return;
  const cutoff = new Date(at - 30 * 86400000).toISOString();
  const limits = await store.publicRateLimits.list(undefined, { take: 100, orderBy: { field: "resetAt", dir: "asc" } });
  for (const row of limits) {
    if (Date.now() >= deadline) return;
    if (Date.parse(row.resetAt) < at - 86400000) await store.transaction(async (tx) => {
      const fresh = await tx.publicRateLimits.get(row.id);
      if (fresh && Date.parse(fresh.resetAt) < at - 86400000) await tx.publicRateLimits.remove(row.id);
    });
  }
  if (Date.now() >= deadline) return;
  const links = await store.acknowledgements.list(undefined, { take: 100, orderBy: { field: "expiresAt", dir: "asc" } });
  for (const row of links) {
    if (Date.now() >= deadline) return;
    if (row.expiresAt < cutoff) await store.acknowledgements.remove(row.id);
  }
  for (const status of ["sent", "suppressed"] as const) {
    if (Date.now() >= deadline) return;
    const completed = await store.notificationDeliveries.list({ status }, { take: 100, orderBy: { field: "updatedAt", dir: "asc" } });
    for (const row of completed) {
      if (Date.now() >= deadline) return;
      if (row.updatedAt < cutoff) await store.notificationDeliveries.remove(row.id);
    }
  }
}

import { randomUUID } from "node:crypto";
import type { DataStore } from "../data/store";
import type { JobLeaseRow } from "../domain/models";

/** Row lease, not a session advisory lock: safe with transaction-pooling. */
export async function acquireLease(store: DataStore, id: string, at = Date.now(), ttlMs = 120_000): Promise<JobLeaseRow | null> {
  const current = await store.jobLeases.get(id);
  if (current && Date.parse(current.leaseUntil) > at) return null;
  const patch = { owner: randomUUID(), leaseUntil: new Date(at + ttlMs).toISOString(), lastRunAt: new Date(at).toISOString() };
  if (current) return store.jobLeases.updateIf(id, { owner: current.owner, leaseUntil: current.leaseUntil }, patch);
  try {
    return await store.jobLeases.create({ id, ...patch, cursor: null, lastSuccessAt: null, lastError: null });
  } catch (error) {
    // A competing creator is normal; connectivity/schema errors are not.
    if (await store.jobLeases.get(id)) return null;
    throw error;
  }
}

export async function finishLease(store: DataStore, lease: JobLeaseRow, patch: Partial<Pick<JobLeaseRow, "cursor" | "lastSuccessAt" | "lastError">>): Promise<boolean> {
  return !!await store.jobLeases.updateIf(lease.id, { owner: lease.owner, leaseUntil: lease.leaseUntil }, { ...patch, leaseUntil: new Date(0).toISOString() });
}

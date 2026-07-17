// =============================================================================
// Job execution hardening.
//
// withJobLock: prevents concurrent runs of the same job. In-process mutex on
// a single node; when the Prisma/Postgres driver is active it additionally
// takes a pg advisory lock, so multiple replicas sharing one database never
// double-run a sweep. (BullMQ on REDIS_URL remains the documented next step
// for true queue semantics; the job functions are already shaped for it.)
//
// runWithRetry: bounded retries with exponential backoff; the final failure is
// appended to the audit chain as job.failed — the dead-letter record.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { config } from "../config";
import { getStore } from "../data";
import { logger } from "../observability/logger";

interface PrismaLike {
  $queryRawUnsafe: (sql: string) => Promise<unknown>;
}

/** Stable 32-bit hash for pg_advisory_lock keys. */
function lockKey(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (Math.imul(hash, 31) + name.charCodeAt(i)) | 0;
  }
  return hash;
}

export async function withJobLock(name: string, fn: () => Promise<void>): Promise<boolean> {
  const g = globalThis as unknown as {
    __netlinkPrisma?: PrismaLike;
    __netlinkJobLocks?: Set<string>;
  };
  g.__netlinkJobLocks ??= new Set();
  if (g.__netlinkJobLocks.has(name)) return false;
  g.__netlinkJobLocks.add(name);

  try {
    const prisma = config.dataDriver === "prisma" ? g.__netlinkPrisma : undefined;
    if (prisma) {
      const key = lockKey(name);
      const rows = (await prisma.$queryRawUnsafe(
        `SELECT pg_try_advisory_lock(${key}) AS locked`
      )) as { locked: boolean }[];
      if (!rows?.[0]?.locked) {
        logger.debug("job lock held elsewhere, skipping", { job: name });
        return false;
      }
      try {
        await fn();
      } finally {
        await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${key})`).catch(() => undefined);
      }
      return true;
    }

    await fn();
    return true;
  } finally {
    g.__netlinkJobLocks.delete(name);
  }
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
}

/** Run a job with retries; the exhausted failure becomes a job.failed audit record. */
export async function runWithRetry(
  name: string,
  fn: () => Promise<void>,
  opts: RetryOptions = {}
): Promise<void> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 2000;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < attempts) {
        const delay = base * 2 ** (attempt - 1);
        logger.warn("job attempt failed, retrying", { job: name, attempt, delay, error: message });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      logger.error("job failed after retries (dead-lettered)", { job: name, attempts, error: message });
      try {
        const store = await getStore();
        const tenants = await store.tenants.list();
        if (tenants[0]) {
          await appendAudit({
            tenantId: tenants[0].id,
            actor: "scheduler",
            action: "job.failed",
            payload: { job: name, attempts, error: message },
          });
        }
      } catch {
        // Audit is best-effort here; the structured log above is the fallback.
      }
    }
  }
}

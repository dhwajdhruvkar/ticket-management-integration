// =============================================================================
// Retry with audit-backed dead-lettering.
//
// Post-create work (routing, automations, AI triage, approval notifications)
// used to be fired with `.catch(console.error)`. A transient failure there is
// invisible: the ticket exists but was never routed, and nobody finds out until
// the SLA breaches. `withRetry` gives those steps a couple of attempts and,
// when they still fail, writes the failure onto the tamper-evident audit chain
// where it shows up in the audit viewer.
// =============================================================================

import { appendAudit } from "./audit/auditChain";
import { logger } from "./observability/logger";

export interface RetryOptions {
  /** Short identifier for the step, e.g. "routing". Used in logs and audit. */
  step: string;
  tenantId: string;
  ticketId?: string;
  /** Total attempts including the first. */
  attempts?: number;
  /** Base delay; each retry waits baseDelayMs * 2^(attempt - 1). */
  baseDelayMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying transient failures. Returns the result, or `null` after
 * the final attempt fails — the failure is audited as `<step>.failed`, never
 * swallowed.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T | null> {
  const attempts = options.attempts ?? 3;
  const baseDelay = options.baseDelayMs ?? 150;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      logger.warn(`${options.step} attempt failed`, {
        step: options.step,
        attempt,
        attempts,
        ticketId: options.ticketId,
        error: err instanceof Error ? err.message : String(err),
      });
      if (attempt < attempts) await sleep(baseDelay * 2 ** (attempt - 1));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  logger.error(`${options.step} failed after ${attempts} attempts`, {
    step: options.step,
    ticketId: options.ticketId,
    error: message,
  });
  // Best-effort: if even the audit write fails there is nothing left to do but
  // log, and throwing here would take down the caller's happy path.
  try {
    await appendAudit({
      tenantId: options.tenantId,
      actor: "system",
      action: "ticket.pipeline.failed",
      ticketId: options.ticketId,
      payload: { step: options.step, attempts, error: message },
    });
  } catch (auditErr) {
    logger.error("could not audit pipeline failure", {
      step: options.step,
      error: auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
  }
  return null;
}

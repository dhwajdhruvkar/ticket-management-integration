// =============================================================================
// Tamper-evident audit chain (server-side, per tenant).
//
// Identical hashing semantics to the original browser implementation, ported to
// Node's crypto and backed by the DataStore. Each block stores SHA-256 of its
// payload AND the previous block's hash, so any retroactive edit breaks the
// chain from that point on. verifyChain() recomputes and reports the first
// broken link — the compliance differentiator, preserved exactly.
// =============================================================================

import { createHash } from "node:crypto";
import { getStore } from "../data";
import { newId, now } from "../domain/ids";
import type { AuditRow } from "../domain/models";

const GENESIS_HASH = "0".repeat(64);

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function hashPayload(payload: Record<string, unknown>): string {
  return sha256(stableStringify(payload));
}

function blockHash(
  index: number,
  timestamp: string,
  actor: string,
  action: string,
  payloadHash: string,
  prevHash: string
): string {
  return sha256(`${index}|${timestamp}|${actor}|${action}|${payloadHash}|${prevHash}`);
}

export interface AppendAuditInput {
  tenantId: string;
  actor: string;
  action: string;
  ticketId?: string;
  payload?: Record<string, unknown>;
}

export async function appendAudit(input: AppendAuditInput): Promise<AuditRow> {
  const store = await getStore();

  // Index allocation is read-then-write; under concurrent writers on Postgres
  // two appends can race for the same index. The @@unique([tenantId, index])
  // constraint rejects the loser, and this bounded retry re-reads and re-links
  // the chain — a lock-free optimistic append.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await store.audit.list({ tenantId: input.tenantId });
    const index = existing.length;
    const prevHash =
      index === 0 ? GENESIS_HASH : existing.sort((a, b) => a.index - b.index)[index - 1].hash;

    const timestamp = now();
    const payload = input.payload ?? {};
    const payloadHash = hashPayload(payload);
    const hash = blockHash(index, timestamp, input.actor, input.action, payloadHash, prevHash);

    const record: AuditRow = {
      id: newId("aud"),
      tenantId: input.tenantId,
      index,
      timestamp,
      actor: input.actor,
      action: input.action,
      ticketId: input.ticketId ?? null,
      payload,
      payloadHash,
      prevHash,
      hash,
    };
    try {
      return await store.audit.create(record);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("audit append failed after retries");
}

export interface AuditVerification {
  valid: boolean;
  length: number;
  brokenAt: number | null;
  reason: string | null;
}

export async function verifyChain(tenantId: string): Promise<AuditVerification> {
  const store = await getStore();
  const records = (await store.audit.list({ tenantId })).sort((a, b) => a.index - b.index);

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const expectedPrev = i === 0 ? GENESIS_HASH : records[i - 1].hash;
    if (r.prevHash !== expectedPrev) {
      return { valid: false, length: records.length, brokenAt: i, reason: `Block #${i} prevHash does not match block #${i - 1}.` };
    }
    if (r.payloadHash !== hashPayload(r.payload)) {
      return { valid: false, length: records.length, brokenAt: i, reason: `Block #${i} payload was modified after the fact.` };
    }
    const expectedHash = blockHash(r.index, r.timestamp, r.actor, r.action, r.payloadHash, r.prevHash);
    if (r.hash !== expectedHash) {
      return { valid: false, length: records.length, brokenAt: i, reason: `Block #${i} hash is inconsistent with its contents.` };
    }
  }
  return { valid: true, length: records.length, brokenAt: null, reason: null };
}

import { pageCollection, type ListOptions, type PageResult } from "../data/store";

/** Newest-first audit records for a tenant, optionally filtered to one ticket. */
export async function getAudit(
  tenantId: string,
  ticketId?: string,
  options?: ListOptions<AuditRow>
): Promise<PageResult<AuditRow>> {
  const store = await getStore();
  const where: Partial<AuditRow> = { tenantId };
  if (ticketId) where.ticketId = ticketId;
  const opt = options ?? { orderBy: { field: "index", dir: "desc" } };

  return pageCollection(store.audit, where, opt);
}

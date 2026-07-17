// =============================================================================
// Machine-to-machine API keys.
//
// Keys look like "nlk_<43 chars base64url>" and are shown ONCE at creation;
// only the SHA-256 hash is persisted. Requests authenticate with
// "Authorization: Bearer nlk_..." or "x-api-key: nlk_...", and act with the
// key's configured role inside the key's tenant. Creation/revocation are
// audited; verification is constant-time on the hash comparison.
// =============================================================================

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { newId, now } from "../domain/ids";
import type { ApiKeyRow, Role } from "../domain/models";

export const API_KEY_PREFIX = "nlk_";

function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Extract a candidate API key from Authorization: Bearer or x-api-key. */
export function extractApiKey(req: Request): string | null {
  const bearer = req.headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    const token = bearer.slice(7).trim();
    if (token.startsWith(API_KEY_PREFIX)) return token;
  }
  const header = req.headers.get("x-api-key")?.trim();
  if (header?.startsWith(API_KEY_PREFIX)) return header;
  return null;
}

export interface CreatedApiKey {
  record: ApiKeyRow;
  /** The full key — returned exactly once, never persisted. */
  key: string;
}

export async function createApiKey(
  tenantId: string,
  input: {
    name: string;
    role?: Role;
    expiresAt?: string | null;
    createdBy?: string;
    agentIds?: string[];
    description?: string | null;
  },
  actor = "system"
): Promise<CreatedApiKey> {
  const store = await getStore();

  // Keep only agent ids that actually belong to this tenant.
  let agentIds: string[] = [];
  if (input.agentIds?.length) {
    const users = await store.users.list({ tenantId });
    const valid = new Set(users.map((u) => u.id));
    agentIds = [...new Set(input.agentIds)].filter((id) => valid.has(id));
  }

  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const record: ApiKeyRow = {
    id: newId("key"),
    tenantId,
    name: input.name.trim(),
    prefix: key.slice(0, API_KEY_PREFIX.length + 6),
    keyHash: hashKey(key),
    role: input.role ?? "agent",
    agentIds,
    description: input.description?.trim() || null,
    active: true,
    lastUsedAt: null,
    expiresAt: input.expiresAt ?? null,
    createdBy: input.createdBy ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.apiKeys.create(record);
  await appendAudit({
    tenantId,
    actor,
    action: "auth.key_created",
    payload: { name: record.name, prefix: record.prefix, role: record.role, agents: agentIds.length },
  });
  return { record, key };
}

export async function listApiKeys(tenantId: string): Promise<ApiKeyRow[]> {
  const store = await getStore();
  return (await store.apiKeys.list({ tenantId })).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

export async function revokeApiKey(tenantId: string, id: string, actor = "system"): Promise<boolean> {
  const store = await getStore();
  const existing = await store.apiKeys.get(id);
  if (!existing || existing.tenantId !== tenantId) return false;
  await store.apiKeys.update(id, { active: false, updatedAt: now() });
  await appendAudit({
    tenantId,
    actor,
    action: "auth.key_revoked",
    payload: { name: existing.name, prefix: existing.prefix },
  });
  return true;
}

export interface VerifiedKey {
  tenantId: string;
  role: Role;
  name: string;
  keyId: string;
}

/** Validate a presented key. Returns null for unknown/inactive/expired keys. */
export async function verifyApiKey(presented: string): Promise<VerifiedKey | null> {
  const store = await getStore();
  const presentedHash = hashKey(presented);
  // Lookup by hash; the timing-safe comparison guards against near-miss
  // hashes even though a SHA-256 preimage is already infeasible.
  const rows = await store.apiKeys.list({ keyHash: presentedHash } as Partial<ApiKeyRow>);
  const row = rows[0];
  if (!row || !row.active) return null;
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) return null;

  const a = Buffer.from(row.keyHash, "hex");
  const b = Buffer.from(presentedHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Best-effort usage stamp (throttled to once a minute to limit writes).
  const last = row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : 0;
  if (Date.now() - last > 60_000) {
    await store.apiKeys.update(row.id, { lastUsedAt: now() }).catch(() => null);
  }

  return { tenantId: row.tenantId, role: row.role, name: `api-key:${row.name}`, keyId: row.id };
}

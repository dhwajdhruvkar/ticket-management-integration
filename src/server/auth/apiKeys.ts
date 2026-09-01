// =============================================================================
// Machine-to-machine API keys.
//
// Keys look like "nlk_<43 chars base64url>" and are shown ONCE at creation;
// only the SHA-256 hash is persisted. Requests authenticate with
// "Authorization: Bearer nlk_..." or "x-api-key: nlk_...", and act with the
// key's configured role inside the key's tenant. Creation/deletion are
// audited; verification is constant-time on the hash comparison.
// =============================================================================

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { pageCollection, type ListOptions, type PageResult } from "../data/store";
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

export const REQUESTER_SCOPED_API_ROLES = new Set<Role>([
  "requester",
  "ticket_submitter",
]);

export async function createApiKey(
  tenantId: string,
  input: {
    name: string;
    role?: Role;
    expiresAt?: string | null;
    createdBy?: string;
    agentIds?: string[];
    description?: string | null;
    requesterId?: string | null;
    webhookUrl?: string | null;
    webhookEvents?: string[];
  },
  actor = "system"
): Promise<CreatedApiKey> {
  const store = await getStore();

  const users = await store.users.list({ tenantId });

  // Keep only agent ids that actually belong to this tenant.
  let agentIds: string[] = [];
  if (input.agentIds?.length) {
    const valid = new Set(users.map((u) => u.id));
    agentIds = [...new Set(input.agentIds)].filter((id) => valid.has(id));
  }

  const role = input.role ?? "agent";
  const scoped = REQUESTER_SCOPED_API_ROLES.has(role);
  const requester = input.requesterId
    ? users.find((user) => user.id === input.requesterId && user.active)
    : null;
  if (scoped && !requester) {
    throw new Error("A requester-scoped integration requires an active requester identity from this organization.");
  }

  const webhookUrl = input.webhookUrl?.trim() || null;
  const webhookEvents = webhookUrl
    ? [...new Set(input.webhookEvents?.length ? input.webhookEvents : ["ticket.created", "ticket.updated"])]
    : [];

  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const record: ApiKeyRow = {
    id: newId("key"),
    tenantId,
    name: input.name.trim(),
    prefix: key.slice(0, API_KEY_PREFIX.length + 6),
    keyHash: hashKey(key),
    role,
    requesterId: scoped ? requester!.id : null,
    agentIds,
    description: input.description?.trim() || null,
    active: true,
    lastUsedAt: null,
    lastTestedAt: null,
    lastTestStatus: null,
    expiresAt: input.expiresAt ?? null,
    rotatedAt: null,
    webhookUrl,
    webhookEvents,
    webhookActive: !!webhookUrl,
    webhookSecretSalt: webhookUrl ? randomBytes(24).toString("base64url") : null,
    webhookLastDeliveredAt: null,
    webhookLastStatus: null,
    webhookLastError: null,
    createdBy: input.createdBy ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.apiKeys.create(record);
  await appendAudit({
    tenantId,
    actor,
    action: "auth.key_created",
    payload: {
      name: record.name,
      prefix: record.prefix,
      role: record.role,
      requesterId: record.requesterId,
      agents: agentIds.length,
      webhook: !!record.webhookUrl,
    },
  });
  return { record, key };
}

export async function listApiKeys(
  tenantId: string,
  options: ListOptions<ApiKeyRow> = { orderBy: { field: "createdAt", dir: "desc" } }
): Promise<PageResult<ApiKeyRow>> {
  const store = await getStore();
  return pageCollection(store.apiKeys, { tenantId }, options);
}

export async function deleteApiKey(tenantId: string, id: string, actor = "system"): Promise<boolean> {
  const store = await getStore();
  const existing = await store.apiKeys.get(id);
  if (!existing || existing.tenantId !== tenantId) return false;
  const deleted = await store.apiKeys.remove(id);
  if (!deleted) return false;
  await appendAudit({
    tenantId,
    actor,
    action: "auth.key_deleted",
    payload: { name: existing.name, prefix: existing.prefix },
  });
  return true;
}

export interface VerifiedKey {
  tenantId: string;
  role: Role;
  name: string;
  keyId: string;
  requesterId?: string;
  requesterEmail?: string;
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

  let requesterId: string | undefined;
  let requesterEmail: string | undefined;
  if (REQUESTER_SCOPED_API_ROLES.has(row.role)) {
    if (!row.requesterId) return null;
    const requester = await store.users.get(row.requesterId);
    if (!requester || !requester.active || requester.tenantId !== row.tenantId) return null;
    requesterId = requester.id;
    requesterEmail = requester.email;
  }

  // Best-effort usage stamp (throttled to once a minute to limit writes).
  const last = row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : 0;
  if (Date.now() - last > 60_000) {
    await store.apiKeys.update(row.id, { lastUsedAt: now() }).catch(() => null);
  }

  return {
    tenantId: row.tenantId,
    role: row.role,
    name: `api-key:${row.name}`,
    keyId: row.id,
    requesterId,
    requesterEmail,
  };
}

/** Replace a credential in-place so tenant, requester and callback mappings remain stable. */
export async function rotateApiKey(
  tenantId: string,
  id: string,
  actor = "system"
): Promise<CreatedApiKey | null> {
  const store = await getStore();
  const existing = await store.apiKeys.get(id);
  if (!existing || existing.tenantId !== tenantId || !existing.active) return null;

  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const rotatedAt = now();
  const record = await store.apiKeys.update(id, {
    keyHash: hashKey(key),
    prefix: key.slice(0, API_KEY_PREFIX.length + 6),
    rotatedAt,
    lastUsedAt: null,
    lastTestedAt: null,
    lastTestStatus: null,
    updatedAt: rotatedAt,
  });
  if (!record) return null;
  await appendAudit({
    tenantId,
    actor,
    action: "auth.key_rotated",
    payload: { name: record.name, prefix: record.prefix },
  });
  return { record, key };
}

export async function markApiKeyTested(
  id: string,
  status: "success" | "failed"
): Promise<void> {
  const store = await getStore();
  await store.apiKeys.update(id, {
    lastTestedAt: now(),
    lastTestStatus: status,
    updatedAt: now(),
  });
}

// =============================================================================
// Request context.
//
// Resolves the active tenant and acting user, in order of trust:
//   1. Auth.js session (Entra ID SSO or demo credentials)
//   2. API key (Authorization: Bearer nlk_... / x-api-key) — machine access
//   3. Demo-mode fallbacks (x-actor / x-tenant headers, seeded admin)
//
// The fallbacks in (3) exist so the zero-infra demo and local tests stay
// frictionless; they are DISABLED when config.demoMode is false (production).
// In production an unauthenticated API request resolves to an inert "anonymous"
// actor whose role holds no RBAC permissions, so every guarded route returns
// 403 (the middleware already returns 401 for /api/v1 without credentials).
// =============================================================================

import { auth } from "@/auth";
import { config } from "./config";
import { extractApiKey, verifyApiKey } from "./auth/apiKeys";
import { getStore } from "./data";
import { NETLINK_TENANT_ID } from "./data/seed";

async function session() {
  try {
    return await auth();
  } catch {
    return null;
  }
}

export interface ActingUser {
  id?: string;
  name: string;
  role: string;
  email?: string;
  impersonating?: boolean;
  /** Set when the request authenticated with an API key. */
  apiKeyId?: string;
}

/** Inert actor for unauthenticated production requests: no RBAC permissions. */
const ANONYMOUS: ActingUser = { name: "anonymous", role: "none" };

const ADMIN_ROLES = new Set(["tenant_admin", "super_admin", "manager"]);

export async function currentTenantId(req?: Request): Promise<string> {
  const store = await getStore();

  const s = await session();
  if (s?.user?.tenantId) {
    const t = await store.tenants.get(s.user.tenantId);
    if (t) return t.id;
  }

  // API-key tenant binding.
  if (req) {
    const presented = extractApiKey(req);
    if (presented) {
      const verified = await verifyApiKey(presented);
      if (verified) return verified.tenantId;
    }
  }

  // Demo-mode conveniences only.
  if (config.demoMode) {
    const header = req?.headers.get("x-tenant")?.trim();
    if (header) {
      const t = await store.tenants.get(header);
      if (t) return t.id;
    }
  }

  const tenants = await store.tenants.list();
  return tenants[0]?.id ?? NETLINK_TENANT_ID;
}

export async function currentActor(req?: Request): Promise<ActingUser> {
  const base = await baseActor(req);

  // Admin impersonation: act as another user for support/testing. Requires a
  // real admin identity; the audit trail records the impersonated identity.
  const impersonate = req?.headers.get("x-impersonate")?.trim();
  if (impersonate && ADMIN_ROLES.has(base.role)) {
    const store = await getStore();
    const target =
      (await store.users.get(impersonate)) ??
      (await store.users.list()).find((u) => u.email.toLowerCase() === impersonate.toLowerCase());
    if (target) {
      return { id: target.id, name: target.name, role: target.role, email: target.email, impersonating: true };
    }
  }
  return base;
}

async function baseActor(req?: Request): Promise<ActingUser> {
  const s = await session();
  if (s?.user) {
    return {
      id: s.user.id,
      name: s.user.name ?? s.user.email ?? "User",
      role: s.user.role ?? "agent",
      email: s.user.email ?? undefined,
    };
  }

  // Machine access via API key: acts with the key's configured role.
  if (req) {
    const presented = extractApiKey(req);
    if (presented) {
      const verified = await verifyApiKey(presented);
      if (verified) {
        return { name: verified.name, role: verified.role, apiKeyId: verified.keyId };
      }
      // A presented-but-invalid key never falls back to a privileged identity.
      return ANONYMOUS;
    }
  }

  // Everything below is demo-mode convenience only.
  if (!config.demoMode) return ANONYMOUS;

  // Headless demo/tests: x-actor is a user email/name/id; when it matches a
  // user, act with that user's real role so RBAC and record security apply.
  const name = req?.headers.get("x-actor")?.trim();
  if (name) {
    const store = await getStore();
    const users = await store.users.list();
    const match = users.find(
      (u) =>
        u.id === name ||
        u.email.toLowerCase() === name.toLowerCase() ||
        u.name.toLowerCase() === name.toLowerCase()
    );
    if (match) return { id: match.id, name: match.name, role: match.role, email: match.email };
    return { name, role: "agent" };
  }

  const store = await getStore();
  const users = await store.users.list();
  const admin = users.find((u) => u.role === "tenant_admin") ?? users[0];
  return admin
    ? { id: admin.id, name: admin.name, role: admin.role, email: admin.email }
    : { name: "System", role: "agent" };
}

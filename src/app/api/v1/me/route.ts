import { fail, ok, readJson } from "@/server/http";
import { can, type Permission } from "@/server/auth/rbac";
import { isResponse, requirePermission } from "@/server/guards";
import { config } from "@/server/config";
import { getStore } from "@/server/data";
import { appendAudit } from "@/server/audit/auditChain";
import { now } from "@/server/domain/ids";
import type { Role, UserPreferences, UserRow } from "@/server/domain/models";
import { markApiKeyTested } from "@/server/auth/apiKeys";

// =============================================================================
// /api/v1/me — the signed-in user's own profile.
//
// GET returns the full profile + effective permissions; PATCH updates self-
// service fields (name, contact, bio) and notification preferences, audited.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALL_PERMISSIONS: Permission[] = [
  "ticket.read", "ticket.create", "ticket.write", "ticket.assign", "ticket.resolve",
  "kb.read", "kb.write", "problem.write", "change.write", "change.approve",
  "asset.write", "automation.write", "report.read", "audit.read", "admin",
];

export async function GET(req: Request) {
  // Every supported interactive or machine identity can create tickets. Using
  // this permission lets least-privilege ticket_submitter keys discover their
  // authoritative organization without accepting a caller-controlled tenant.
  const ctx = await requirePermission(req, "ticket.create");
  if (isResponse(ctx)) return ctx;
  const { actor, tenantId } = ctx;
  const role = actor.role as Role;
  const permissions = ALL_PERMISSIONS.filter((p) => can(role, p));

  const store = await getStore();
  const [user, tenant] = await Promise.all([
    actor.id ? store.users.get(actor.id) : Promise.resolve(null),
    store.tenants.get(tenantId),
  ]);
  if (actor.apiKeyId) {
    await markApiKeyTested(actor.apiKeyId, "success").catch(() => undefined);
  }

  return ok({
    id: actor.id ?? null,
    name: user?.name ?? actor.name,
    email: user?.email ?? actor.email ?? null,
    role: actor.role,
    title: user?.title ?? null,
    department: user?.department ?? null,
    initials: user?.initials ?? null,
    phone: user?.phone ?? null,
    location: user?.location ?? null,
    timezone: user?.timezone ?? null,
    bio: user?.bio ?? null,
    preferences: user?.preferences ?? null,
    memberSince: user?.createdAt ?? null,
    impersonating: !!actor.impersonating,
    tenantId,
    organization: tenant
      ? { id: tenant.id, name: tenant.name, code: tenant.slug }
      : { id: tenantId, name: null, code: null },
    permissions,
    // Agent availability for dispatch (defaults available when unset).
    available: user?.available !== false,
    // Lets the UI hide demo-only affordances (persona switcher) in production.
    demoMode: config.demoMode,
  });
}

interface ProfilePatch {
  name?: string;
  title?: string | null;
  department?: string | null;
  phone?: string | null;
  location?: string | null;
  timezone?: string | null;
  bio?: string | null;
  preferences?: UserPreferences;
  available?: boolean;
}

/** Self-service profile update: users can only edit their own record. */
export async function PATCH(req: Request) {
  const ctx = await requirePermission(req, "ticket.read");
  if (isResponse(ctx)) return ctx;
  const { actor, tenantId } = ctx;
  if (actor.apiKeyId) return fail("Machine credentials cannot edit user profiles.", 403);
  if (!actor.id) return fail("No signed-in user to update.", 401);

  const body = await readJson<ProfilePatch>(req);
  if (!body) return fail("Invalid body.");
  if (body.name !== undefined && !body.name.trim()) return fail("Name cannot be empty.");

  const patch: Partial<UserRow> = { updatedAt: now() };
  if (body.name !== undefined) patch.name = body.name.trim();
  for (const key of ["title", "department", "phone", "location", "timezone", "bio"] as const) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (body.preferences !== undefined) patch.preferences = body.preferences;
  if (body.available !== undefined) patch.available = body.available;

  const store = await getStore();
  const updated = await store.users.update(actor.id, patch);
  if (!updated) return fail("User not found.", 404);

  await appendAudit({
    tenantId,
    actor: `user:${updated.email}`,
    action: "user.profile.updated",
    payload: { fields: Object.keys(body) },
  });
  return ok(updated);
}

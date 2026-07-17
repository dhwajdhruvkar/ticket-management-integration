import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can, type Permission } from "@/server/auth/rbac";
import { config } from "@/server/config";
import { getStore } from "@/server/data";
import { appendAudit } from "@/server/audit/auditChain";
import { now } from "@/server/domain/ids";
import type { Role, UserPreferences, UserRow } from "@/server/domain/models";

// =============================================================================
// /api/v1/me — the signed-in user's own profile.
//
// GET returns the full profile + effective permissions; PATCH updates self-
// service fields (name, contact, bio) and notification preferences, audited.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALL_PERMISSIONS: Permission[] = [
  "ticket.read", "ticket.write", "ticket.assign", "ticket.resolve",
  "kb.read", "kb.write", "problem.write", "change.write", "change.approve",
  "asset.write", "automation.write", "report.read", "audit.read", "admin",
];

export async function GET(req: Request) {
  const [actor, tenantId] = await Promise.all([currentActor(req), currentTenantId(req)]);
  const role = actor.role as Role;
  const permissions = ALL_PERMISSIONS.filter((p) => can(role, p));

  const store = await getStore();
  const user = actor.id ? await store.users.get(actor.id) : null;

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
  const [actor, tenantId] = await Promise.all([currentActor(req), currentTenantId(req)]);
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

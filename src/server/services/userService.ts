// =============================================================================
// User management service (admin).
//
// Create/update/deactivate users with tenant-scoped email uniqueness, a
// role-escalation guard (who may grant/manage which role), department linkage
// (departmentId is authoritative; the `department` label is kept in sync for
// display/back-compat), and audit-chain entries for every lifecycle change.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { newId, now } from "../domain/ids";
import type { Role, UserRow } from "../domain/models";

export class UserServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "UserServiceError";
  }
}

// Which roles each actor role is allowed to grant / manage. tenant_admin can
// manage the workforce but never mint or edit other admins; only super_admin
// can create/modify tenant_admin and super_admin accounts.
const ASSIGNABLE_BY: Record<string, Role[]> = {
  super_admin: ["requester", "agent", "manager", "tenant_admin", "super_admin"],
  tenant_admin: ["requester", "agent", "manager"],
};

/** Roles the given actor role is permitted to grant/manage (drives the UI too). */
export function assignableRoles(actorRole: string): Role[] {
  return ASSIGNABLE_BY[actorRole] ?? [];
}

/** Throws 403 unless the actor may manage the target role (escalation guard). */
function assertCanManageRole(actorRole: string, targetRole: Role): void {
  if (!assignableRoles(actorRole).includes(targetRole)) {
    throw new UserServiceError(`Your role cannot manage the "${targetRole}" role.`, 403);
  }
}

/** Derive avatar initials from a display name (first+last, else first two chars). */
function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return chars.toUpperCase();
}

// Validate a department belongs to the tenant and return its display name.
async function resolveDepartmentName(
  tenantId: string,
  departmentId?: string | null
): Promise<string | null> {
  if (!departmentId) return null;
  const store = await getStore();
  const dept = await store.departments.get(departmentId);
  if (!dept || dept.tenantId !== tenantId) throw new UserServiceError("Department not found.");
  return dept.name;
}

/** List tenant users (optionally filtered), sorted by display name. */
export async function listUsers(
  tenantId: string,
  where: Partial<UserRow> = {}
): Promise<UserRow[]> {
  const store = await getStore();
  return (await store.users.list({ tenantId, ...where })).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

export interface CreateUserInput {
  name: string;
  email: string;
  role: Role;
  title?: string | null;
  departmentId?: string | null;
  phone?: string | null;
  location?: string | null;
  timezone?: string | null;
}

/**
 * Create a user: validates name/email, enforces the role-escalation guard and
 * tenant-scoped email uniqueness, links the department, seeds default
 * notification preferences, and audits the creation.
 */
export async function createUser(
  tenantId: string,
  input: CreateUserInput,
  actorRole: string,
  actor = "system"
): Promise<UserRow> {
  const name = input.name?.trim();
  const email = input.email?.trim().toLowerCase();
  if (!name) throw new UserServiceError("Name is required.");
  if (!email || !email.includes("@")) throw new UserServiceError("A valid email is required.");
  assertCanManageRole(actorRole, input.role);

  const store = await getStore();
  const existing = (await store.users.list({ tenantId })).find(
    (u) => u.email.toLowerCase() === email
  );
  if (existing) throw new UserServiceError("A user with that email already exists.", 409);

  const departmentName = await resolveDepartmentName(tenantId, input.departmentId);
  const user: UserRow = {
    id: newId("user"),
    tenantId,
    email,
    name,
    role: input.role,
    title: input.title?.trim() || null,
    department: departmentName,
    departmentId: input.departmentId ?? null,
    initials: initialsFrom(name),
    active: true,
    externalId: null,
    phone: input.phone?.trim() || null,
    location: input.location?.trim() || null,
    timezone: input.timezone?.trim() || null,
    bio: null,
    preferences: {
      emailNotifications: true,
      desktopNotifications: false,
      weeklyDigest: true,
      mentionAlerts: true,
    },
    available: true,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.users.create(user);
  await appendAudit({
    tenantId,
    actor,
    action: "user.created",
    payload: { email: user.email, name: user.name, role: user.role },
  });
  return user;
}

export interface UpdateUserInput {
  name?: string;
  title?: string | null;
  role?: Role;
  departmentId?: string | null;
  active?: boolean;
  phone?: string | null;
  location?: string | null;
  timezone?: string | null;
}

/**
 * Update a user's profile/role/department. Requires permission to manage both
 * the current and (if changing) the new role; keeps the department label in
 * sync and audits role changes distinctly from ordinary edits.
 */
export async function updateUser(
  tenantId: string,
  id: string,
  input: UpdateUserInput,
  actorRole: string,
  actor = "system"
): Promise<UserRow> {
  const store = await getStore();
  const before = await store.users.get(id);
  if (!before || before.tenantId !== tenantId) throw new UserServiceError("User not found.", 404);

  // Must be allowed to manage the target's current role.
  assertCanManageRole(actorRole, before.role);

  const patch: Partial<UserRow> = { updatedAt: now() };
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) throw new UserServiceError("Name cannot be empty.");
    patch.name = n;
    patch.initials = initialsFrom(n);
  }
  if (input.title !== undefined) patch.title = input.title?.trim() || null;
  if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
  if (input.location !== undefined) patch.location = input.location?.trim() || null;
  if (input.timezone !== undefined) patch.timezone = input.timezone?.trim() || null;
  if (input.active !== undefined) patch.active = input.active;

  const roleChanged = input.role !== undefined && input.role !== before.role;
  if (roleChanged) {
    // Must also be allowed to grant the new role.
    assertCanManageRole(actorRole, input.role!);
    patch.role = input.role;
  }
  if (input.departmentId !== undefined) {
    patch.departmentId = input.departmentId ?? null;
    patch.department = await resolveDepartmentName(tenantId, input.departmentId);
  }

  const updated = await store.users.update(id, patch);
  if (!updated) throw new UserServiceError("User not found.", 404);
  await appendAudit({
    tenantId,
    actor,
    action: roleChanged ? "user.role_updated" : "user.updated",
    payload: {
      email: updated.email,
      ...(roleChanged ? { role: patch.role, from: before.role } : {}),
      fields: Object.keys(input),
    },
  });
  return updated;
}

/** Soft-deactivate a user (active=false) after the role-management check; audited. */
export async function deactivateUser(
  tenantId: string,
  id: string,
  actorRole: string,
  actor = "system"
): Promise<UserRow> {
  const store = await getStore();
  const before = await store.users.get(id);
  if (!before || before.tenantId !== tenantId) throw new UserServiceError("User not found.", 404);
  assertCanManageRole(actorRole, before.role);

  const updated = await store.users.update(id, { active: false, updatedAt: now() });
  if (!updated) throw new UserServiceError("User not found.", 404);
  await appendAudit({
    tenantId,
    actor,
    action: "user.deactivated",
    payload: { email: updated.email },
  });
  return updated;
}

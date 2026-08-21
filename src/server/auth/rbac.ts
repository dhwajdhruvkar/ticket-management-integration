// =============================================================================
// Role-based access control.
//
// A small permission matrix keyed by role. Services and API routes call can()
// to authorize an action. Roles escalate: requester < agent < manager <
// tenant_admin < super_admin.
// =============================================================================

import type { Role } from "../domain/models";
export { DISPATCH_ROLES } from "../../shared/rbac";

export type Permission =
  | "ticket.read"
  | "ticket.write"
  | "ticket.delete"
  | "ticket.assign"
  | "ticket.dispatch"
  | "ticket.resolve"
  | "kb.read"
  | "kb.write"
  | "problem.read"
  | "problem.write"
  | "change.read"
  | "change.write"
  | "change.approve"
  | "asset.read"
  | "asset.write"
  | "automation.read"
  | "automation.write"
  | "report.read"
  | "audit.read"
  | "admin";

const REQUESTER: Permission[] = ["ticket.read", "kb.read"];
const AGENT: Permission[] = [
  ...REQUESTER,
  "ticket.write",
  "ticket.assign",
  "ticket.resolve",
  "kb.write",
  "problem.read",
  "problem.write",
  "change.read",
  "change.write",
  "asset.read",
  "asset.write",
  "automation.read",
  "audit.read",
  "report.read",
];
const MANAGER: Permission[] = [...AGENT, "change.approve", "ticket.dispatch", "ticket.delete"];
const TENANT_ADMIN: Permission[] = [...MANAGER, "automation.write", "admin"];

const MATRIX: Record<Role, Permission[] | "*"> = {
  requester: REQUESTER,
  agent: AGENT,
  manager: MANAGER,
  tenant_admin: TENANT_ADMIN,
  super_admin: "*",
};

export function can(role: Role | string | undefined, permission: Permission): boolean {
  if (!role) return false;
  // Unknown roles (e.g. a rejected API key's sentinel actor) have no permissions.
  const perms = MATRIX[role as Role];
  if (!perms) return false;
  if (perms === "*") return true;
  return perms.includes(permission);
}

export function isAgentRole(role: Role | undefined): boolean {
  return !!role && role !== "requester";
}

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Forbidden: missing permission "${permission}".`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: Role | undefined, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}

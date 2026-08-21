// =============================================================================
// Route guards.
//
// Every `/api/v1/<thing>/[id]` route needs the same three checks before it does
// anything: is the caller allowed to perform this kind of action, does the row
// exist, and does it belong to the caller's tenant. Doing that inline in ~25
// route files invited the omissions this module exists to prevent.
//
// Tenant mismatches answer 404, never 403: confirming that an id exists in some
// other tenant is itself a disclosure.
// =============================================================================

import type { NextResponse } from "next/server";
import { currentActor, currentTenantId, type ActingUser } from "./context";
import { assertTenant, fail } from "./http";
import { can, isAgentRole, type Permission } from "./auth/rbac";
import { getStore } from "./data";
import { getTicket } from "./services/ticketService";
import type { Role, TicketRow } from "./domain/models";

export interface ActorContext {
  actor: ActingUser;
  role: Role;
  tenantId: string;
}

/** Resolve the acting user plus their tenant in one round trip. */
export async function actorContext(req: Request): Promise<ActorContext> {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  return { actor, role: actor.role as Role, tenantId };
}

/**
 * Resolve the actor and check a permission. Returns a 403 response instead of
 * the context when the actor lacks the permission.
 */
export async function requirePermission(
  req: Request,
  permission: Permission
): Promise<ActorContext | NextResponse> {
  const ctx = await actorContext(req);
  if (!can(ctx.role, permission)) return fail("Forbidden.", 403);
  return ctx;
}

export function isResponse(value: unknown): value is NextResponse {
  return typeof value === "object" && value !== null && "headers" in value && "status" in value;
}

/**
 * Load a ticket for this request: tenant-scoped, and for requesters also
 * restricted to tickets they raised themselves.
 */
export async function loadTicket(
  ctx: ActorContext,
  ticketId: string
): Promise<TicketRow | NextResponse> {
  const ticket = await getTicket(ticketId, ctx.tenantId);
  if (!ticket) return fail("Ticket not found.", 404);
  if (
    !isAgentRole(ctx.role) &&
    ticket.requesterEmail.toLowerCase() !== (ctx.actor.email ?? "").toLowerCase()
  ) {
    return fail("Ticket not found.", 404);
  }
  return ticket;
}

type TenantScoped = { id: string; tenantId: string };

/** DataStore collections whose rows carry a tenantId. */
export type OwnedCollection =
  | "departments"
  | "users"
  | "groups"
  | "articles"
  | "problems"
  | "changes"
  | "assets"
  | "cis"
  | "catalogItems"
  | "slaPolicies"
  | "automations"
  | "macros"
  | "customFieldDefs"
  | "apiKeys"
  | "calendars";

/**
 * Assert that a row exists and belongs to the caller's tenant, answering 404
 * when either is false. `label` is used in the error copy, e.g. "Macro".
 */
export async function loadOwned(
  ctx: ActorContext,
  collection: OwnedCollection,
  id: string,
  label: string
): Promise<TenantScoped | NextResponse> {
  const store = await getStore();
  const coll = store[collection] as unknown as { get(id: string): Promise<TenantScoped | null> };
  const row = assertTenant(await coll.get(id), ctx.tenantId);
  return row ?? fail(`${label} not found.`, 404);
}

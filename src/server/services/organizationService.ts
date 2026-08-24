// =============================================================================
// Organization service (super-admin).
//
// An "organization" is a tenant. super_admin can provision additional
// organizations; users are then created within a chosen organization. Creation
// is recorded on the new organization's audit chain.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { pageCollection, type ListOptions, type PageResult } from "../data/store";
import { newId, now } from "../domain/ids";
import type { TenantRow } from "../domain/models";

export class OrganizationServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "OrganizationServiceError";
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "org"
  );
}

/**
 * List organizations. Pass `onlyId` for a tenant admin: they administer one
 * organization and have no business enumerating the others on the deployment.
 */
export async function listOrganizations(
  onlyId?: string,
  options: ListOptions<TenantRow> = { orderBy: { field: "name", dir: "asc" } }
): Promise<PageResult<TenantRow>> {
  const store = await getStore();
  return pageCollection(store.tenants, onlyId ? { id: onlyId } : undefined, options);
}

export interface OrganizationInput {
  name: string;
  brand?: string | null;
  isInternal?: boolean;
}

export type OrganizationPatch = Partial<OrganizationInput>;

export async function createOrganization(
  input: OrganizationInput,
  actor = "system"
): Promise<TenantRow> {
  const name = input.name?.trim();
  if (!name) throw new OrganizationServiceError("Name is required.");
  const store = await getStore();

  const duplicate = (await store.tenants.list()).find(
    (tenant) => tenant.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    throw new OrganizationServiceError('An organization with that name already exists.', 409);
  }

  const base = slugify(name);
  const all = await store.tenants.list();
  const slug = all.some((t) => t.slug === base) ? `${base}-${newId().slice(0, 6)}` : base;

  const tenant: TenantRow = {
    id: newId("tenant"),
    name,
    slug,
    brand: input.brand?.trim() || name,
    isInternal: input.isInternal ?? false,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.tenants.create(tenant);
  await appendAudit({
    tenantId: tenant.id,
    actor,
    action: "organization.created",
    payload: { name, slug },
  });
  return tenant;
}

export async function updateOrganization(
  id: string,
  input: OrganizationPatch,
  actor = 'system'
): Promise<TenantRow> {
  const store = await getStore();
  const before = await store.tenants.get(id);
  if (!before) throw new OrganizationServiceError('Organization not found.', 404);

  const patch: Partial<TenantRow> = { updatedAt: now() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new OrganizationServiceError('Name cannot be empty.');
    const duplicate = (await store.tenants.list()).find(
      (tenant) => tenant.id !== id && tenant.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      throw new OrganizationServiceError('An organization with that name already exists.', 409);
    }
    patch.name = name;
  }
  if (input.brand !== undefined) {
    patch.brand = input.brand?.trim() || patch.name || before.name;
  } else if (patch.name && before.brand === before.name) {
    // Keep the default brand aligned when it was never customised.
    patch.brand = patch.name;
  }
  if (input.isInternal !== undefined) patch.isInternal = input.isInternal;

  const updated = await store.tenants.update(id, patch);
  if (!updated) throw new OrganizationServiceError('Organization not found.', 404);
  await appendAudit({
    tenantId: id,
    actor,
    action: 'organization.updated',
    payload: {
      name: updated.name,
      brand: updated.brand ?? null,
      isInternal: updated.isInternal,
    },
  });
  return updated;
}

/**
 * Discard a provisioned-but-unused organization. This deliberately refuses to
 * cascade-delete tenant data: once an organization contains business records,
 * it must be retained or handled through a dedicated migration/offboarding
 * process. The actor's own tenant receives the surviving audit event.
 */
export async function deleteOrganization(
  id: string,
  actorTenantId: string,
  actor = 'system'
): Promise<boolean> {
  const store = await getStore();
  const organization = await store.tenants.get(id);
  if (!organization) return false;
  if (id === actorTenantId) {
    throw new OrganizationServiceError(
      'You cannot discard the organization you are currently signed into.',
      409
    );
  }
  if (organization.isInternal) {
    throw new OrganizationServiceError('Internal organizations cannot be discarded.', 409);
  }

  const ownedCollections = [
    store.departments,
    store.users,
    store.groups,
    store.tickets,
    store.articles,
    store.problems,
    store.changes,
    store.assets,
    store.cis,
    store.catalogItems,
    store.slaPolicies,
    store.calendars,
    store.automations,
    store.macros,
    store.customFieldDefs,
    store.notifications,
    store.apiKeys,
    store.emails,
  ] as const;
  const counts = await Promise.all(
    ownedCollections.map((collection) => collection.count({ tenantId: id } as never))
  );
  if (counts.some((count) => count > 0)) {
    throw new OrganizationServiceError(
      'This organization contains users, tickets, or settings and cannot be discarded.',
      409
    );
  }

  await appendAudit({
    tenantId: actorTenantId,
    actor,
    action: 'organization.deleted',
    payload: { organizationId: organization.id, name: organization.name, slug: organization.slug },
  });
  return store.tenants.remove(id);
}

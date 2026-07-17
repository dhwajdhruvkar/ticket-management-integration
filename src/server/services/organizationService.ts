// =============================================================================
// Organization service (super-admin).
//
// An "organization" is a tenant. super_admin can provision additional
// organizations; users are then created within a chosen organization. Creation
// is recorded on the new organization's audit chain.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
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

export async function listOrganizations(): Promise<TenantRow[]> {
  const store = await getStore();
  return (await store.tenants.list()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createOrganization(
  input: { name: string; brand?: string | null; isInternal?: boolean },
  actor = "system"
): Promise<TenantRow> {
  const name = input.name?.trim();
  if (!name) throw new OrganizationServiceError("Name is required.");
  const store = await getStore();

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

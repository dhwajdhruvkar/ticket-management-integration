// =============================================================================
// Organization service (super-admin).
//
// An "organization" is a tenant. super_admin can provision additional
// organizations; users are then created within a chosen organization. Creation
// is recorded on the new organization's audit chain.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { logger } from "../observability/logger";
import { getStore } from "../data";
import {
  pageCollection,
  type DataStore,
  type ListOptions,
  type PageResult,
} from "../data/store";
import { newId, now } from "../domain/ids";
import type { TenantRow } from "../domain/models";
import { getBlobStore, type BlobStore } from "../storage/blobStore";
import {
  deliverAccessLink,
  issueUserAccessLinkInStore,
  toUserAccessView,
  type AccessLinkView,
  type UserAccessView,
} from "./accountAccessService";
import { createUser } from "./userService";

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

export interface OrganizationAdminInput {
  name: string;
  email: string;
}

export interface ProvisionOrganizationInput extends OrganizationInput {
  admin: OrganizationAdminInput;
}

export interface ProvisionOrganizationResult {
  organization: TenantRow;
  admin: UserAccessView;
  invitation: AccessLinkView;
}

export interface OrganizationView extends TenantRow {
  onboardingStatus: "pending" | "active" | "locked";
  admin: UserAccessView | null;
}

export async function organizationViews(
  organizations: TenantRow[]
): Promise<OrganizationView[]> {
  const store = await getStore();
  const ids = new Set(organizations.map((organization) => organization.id));
  const users = (await store.users.list()).filter((user) => ids.has(user.tenantId));
  const invitations = (await store.invitations.list()).filter((invitation) =>
    ids.has(invitation.tenantId)
  );
  return organizations.map((organization) => {
    const firstAdmin = users
      .filter(
        (user) =>
          user.tenantId === organization.id && user.role === "tenant_admin"
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )[0];
    const admin = firstAdmin
      ? toUserAccessView(firstAdmin, invitations)
      : null;
    return {
      ...organization,
      admin,
      onboardingStatus:
        admin?.accessStatus === "locked"
          ? "locked"
          : admin?.accessStatus === "active"
            ? "active"
            : "pending",
    };
  });
}

export type OrganizationPatch = Partial<OrganizationInput>;

export async function createOrganization(
  input: OrganizationInput,
  actor = "system",
  storeOverride?: DataStore
): Promise<TenantRow> {
  const name = input.name?.trim();
  if (!name) throw new OrganizationServiceError("Name is required.");
  const store = storeOverride ?? (await getStore());

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
  await appendAudit(
    {
      tenantId: tenant.id,
      actor,
      action: "organization.created",
      payload: { name, slug },
    },
    store
  );
  return tenant;
}

export async function provisionOrganization(
  input: ProvisionOrganizationInput,
  actor: string,
  baseUrl: string
): Promise<ProvisionOrganizationResult> {
  const store = await getStore();
  const result = await store.transaction(async (tx) => {
    const organization = await createOrganization(input, actor, tx);
    const admin = await createUser(
      organization.id,
      {
        name: input.admin.name,
        email: input.admin.email,
        role: "tenant_admin",
      },
      "super_admin",
      actor,
      { store: tx, active: false }
    );
    const issued = await issueUserAccessLinkInStore(
      tx,
      organization,
      admin,
      "activate",
      actor,
      baseUrl
    );
    return { organization, admin, issued };
  });
  return {
    organization: result.organization,
    admin: toUserAccessView(result.admin, [result.issued.invitation]),
    invitation: await deliverAccessLink(
      result.organization,
      result.admin,
      result.issued
    ),
  };
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

export interface OrganizationDeletionSummary {
  users: number;
  invitations: number;
  tickets: number;
  attachments: number;
  apiKeys: number;
  departments: number;
  settingsAndBusinessRecords: number;
}

export interface OrganizationDeletionResult {
  deleted: true;
  organization: Pick<TenantRow, "id" | "name" | "slug">;
  deletedRecords: OrganizationDeletionSummary;
  attachmentCleanup: {
    attempted: number;
    deleted: number;
    failed: number;
  };
}

export interface OrganizationDeletionDependencies {
  blobStore?: BlobStore;
}

async function cleanupAttachmentBlobs(
  attachmentIds: string[],
  dependencies: OrganizationDeletionDependencies
): Promise<OrganizationDeletionResult["attachmentCleanup"]> {
  if (attachmentIds.length === 0) return { attempted: 0, deleted: 0, failed: 0 };

  let blobStore: BlobStore;
  try {
    blobStore = dependencies.blobStore ?? getBlobStore();
  } catch (error) {
    logger.error("organization attachment cleanup unavailable", {
      attachmentCount: attachmentIds.length,
      error,
    });
    return { attempted: attachmentIds.length, deleted: 0, failed: attachmentIds.length };
  }

  let deleted = 0;
  let failed = 0;
  for (const attachmentId of attachmentIds) {
    try {
      if (await blobStore.delete(attachmentId)) deleted += 1;
    } catch (error) {
      failed += 1;
      logger.error("organization attachment blob cleanup failed", {
        attachmentId,
        error,
      });
    }
  }
  return { attempted: attachmentIds.length, deleted, failed };
}

/**
 * Permanently delete a non-internal organization and everything it owns.
 * The immutable organization code is required as a server-side confirmation;
 * the current tenant remains protected. Database cleanup is atomic and the
 * actor's own tenant receives the surviving audit event.
 */
export async function deleteOrganization(
  id: string,
  actorTenantId: string,
  confirmation: string,
  actor = 'system',
  dependencies: OrganizationDeletionDependencies = {}
): Promise<OrganizationDeletionResult | null> {
  const store = await getStore();
  const deleted = await store.transaction(async (tx) => {
    const organization = await tx.tenants.get(id);
    if (!organization) return null;
    if (id === actorTenantId) {
      throw new OrganizationServiceError(
        'You cannot delete the organization you are currently signed into.',
        409
      );
    }
    if (organization.isInternal) {
      throw new OrganizationServiceError('Internal organizations cannot be deleted.', 409);
    }
    if (confirmation.trim() !== organization.slug) {
      throw new OrganizationServiceError('Organization code does not match.', 400);
    }

    const [
      users,
      invitations,
      tickets,
      apiKeys,
      departments,
      groups,
      articles,
      problems,
      changes,
      assets,
      cis,
      catalogItems,
      slaPolicies,
      calendars,
      automations,
      macros,
      customFieldDefs,
      notifications,
      emails,
    ] = await Promise.all([
      tx.users.list({ tenantId: id }),
      tx.invitations.list({ tenantId: id }),
      tx.tickets.list({ tenantId: id }),
      tx.apiKeys.list({ tenantId: id }),
      tx.departments.list({ tenantId: id }),
      tx.groups.list({ tenantId: id }),
      tx.articles.list({ tenantId: id }),
      tx.problems.list({ tenantId: id }),
      tx.changes.list({ tenantId: id }),
      tx.assets.list({ tenantId: id }),
      tx.cis.list({ tenantId: id }),
      tx.catalogItems.list({ tenantId: id }),
      tx.slaPolicies.list({ tenantId: id }),
      tx.calendars.list({ tenantId: id }),
      tx.automations.list({ tenantId: id }),
      tx.macros.list({ tenantId: id }),
      tx.customFieldDefs.list({ tenantId: id }),
      tx.notifications.list({ tenantId: id }),
      tx.emails.list({ tenantId: id }),
    ]);
    const ticketIds = new Set(tickets.map((ticket) => ticket.id));
    const attachments = (await tx.attachments.list()).filter((attachment) =>
      ticketIds.has(attachment.ticketId)
    );
    const summary: OrganizationDeletionSummary = {
      users: users.length,
      invitations: invitations.length,
      tickets: tickets.length,
      attachments: attachments.length,
      apiKeys: apiKeys.length,
      departments: departments.length,
      settingsAndBusinessRecords:
        groups.length +
        articles.length +
        problems.length +
        changes.length +
        assets.length +
        cis.length +
        catalogItems.length +
        slaPolicies.length +
        calendars.length +
        automations.length +
        macros.length +
        customFieldDefs.length +
        notifications.length +
        emails.length,
    };

    await appendAudit({
      tenantId: actorTenantId,
      actor,
      action: 'organization.deleted',
      payload: {
        organizationId: organization.id,
        name: organization.name,
        slug: organization.slug,
        deletedRecords: summary,
      },
    }, tx);

    const removed = await tx.tenants.remove(id);
    if (!removed) {
      throw new OrganizationServiceError('Organization could not be deleted safely.', 409);
    }

    // Compatibility cleanup for deployments upgrading from schemas where
    // these tenantId columns did not yet have Tenant foreign keys.
    for (const row of [...notifications, ...emails, ...calendars]) {
      const collection =
        "channel" in row
          ? tx.notifications
          : "direction" in row
            ? tx.emails
            : tx.calendars;
      await collection.remove(row.id);
    }

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      summary,
      attachmentIds: attachments.map((attachment) => attachment.id),
    };
  });
  if (!deleted) return null;

  return {
    deleted: true,
    organization: deleted.organization,
    deletedRecords: deleted.summary,
    attachmentCleanup: await cleanupAttachmentBlobs(deleted.attachmentIds, dependencies),
  };
}

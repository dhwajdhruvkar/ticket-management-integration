import { afterEach, describe, expect, it } from "vitest";
import { getStore } from "@/server/data";
import {
  AccountAccessError,
  authenticateOrganizationUser,
  changeOwnPassword,
  completeAccountSetup,
  generateUserAccessLink,
  inviteUser,
} from "@/server/services/accountAccessService";
import { provisionOrganization } from "@/server/services/organizationService";
import { intakeTicket } from "@/server/services/intake";
import { updateUser, UserServiceError } from "@/server/services/userService";

const createdTenantIds = new Set<string>();
const ORIGIN = "https://phase15.test";
const SHARED_EMAIL = "same-admin@example.com";

function rawToken(setupUrl: string): string {
  return new URLSearchParams(new URL(setupUrl).hash.slice(1)).get("token") ?? "";
}

async function provision(name: string, email = SHARED_EMAIL) {
  const result = await provisionOrganization(
    { name, admin: { name: "Tenant Admin", email } },
    "Platform Admin",
    ORIGIN
  );
  createdTenantIds.add(result.organization.id);
  return result;
}

afterEach(async () => {
  const store = await getStore();
  for (const id of createdTenantIds) await store.tenants.remove(id);
  createdTenantIds.clear();
});

describe("Phase 15 organization account access", () => {
  it("selects the correct tenant when the same email belongs to two organizations", async () => {
    const alpha = await provision("Phase 15 Alpha");
    const beta = await provision("Phase 15 Beta");
    const alphaToken = rawToken(alpha.invitation.setupUrl);
    const betaToken = rawToken(beta.invitation.setupUrl);

    expect(alphaToken).toHaveLength(43);
    expect(betaToken).toHaveLength(43);
    expect(alphaToken).not.toBe(betaToken);
    await expect(completeAccountSetup(alphaToken, "Alpha-password-2026")).resolves.toEqual({
      organizationCode: alpha.organization.slug,
      email: SHARED_EMAIL,
    });
    await completeAccountSetup(betaToken, "Beta-password-2026");

    await expect(
      authenticateOrganizationUser(alpha.organization.slug, SHARED_EMAIL, "Alpha-password-2026")
    ).resolves.toMatchObject({ id: alpha.admin.id, tenantId: alpha.organization.id });
    await expect(
      authenticateOrganizationUser(beta.organization.slug, SHARED_EMAIL, "Beta-password-2026")
    ).resolves.toMatchObject({ id: beta.admin.id, tenantId: beta.organization.id });

    for (const credentials of [
      ["missing-organization", SHARED_EMAIL, "Alpha-password-2026"],
      [alpha.organization.slug, "missing@example.com", "Alpha-password-2026"],
      [alpha.organization.slug, SHARED_EMAIL, "wrong-password"],
    ] as const) {
      await expect(authenticateOrganizationUser(credentials[0], credentials[1], credentials[2])).rejects.toMatchObject({
        status: 401,
        message: "Invalid organization code, email, or password.",
      });
    }

    const store = await getStore();
    expect(await store.tickets.count({ tenantId: alpha.organization.id })).toBe(0);
    expect(await store.departments.count({ tenantId: alpha.organization.id })).toBe(0);
    expect(await store.groups.count({ tenantId: alpha.organization.id })).toBe(0);
    expect(await store.catalogItems.count({ tenantId: alpha.organization.id })).toBe(0);
    expect(await store.automations.count({ tenantId: alpha.organization.id })).toBe(0);
    expect(await store.slaPolicies.count({ tenantId: alpha.organization.id })).toBe(0);

    const ticket = await intakeTicket(alpha.organization.id, {
      subject: "First fresh tenant ticket",
      body: "Created without copied tenant settings.",
      requesterEmail: SHARED_EMAIL,
      category: "Other",
      impact: "medium",
      urgency: "medium",
      priority: "medium",
      channel: "portal",
    });
    expect(ticket.tenantId).toBe(alpha.organization.id);
    expect(ticket.slaPolicyId).toBeNull();
    expect(await store.tickets.count({ tenantId: beta.organization.id })).toBe(0);
  });

  it("stores only token hashes and rejects revoked, reused, expired, and weak setup links", async () => {
    const tenant = await provision("Phase 15 Tokens", "tokens@example.com");
    const firstToken = rawToken(tenant.invitation.setupUrl);
    const regenerated = await generateUserAccessLink(
      tenant.organization.id,
      tenant.admin.id,
      "super_admin",
      "Platform Admin",
      ORIGIN
    );
    const secondToken = rawToken(regenerated.invitation.setupUrl);
    const store = await getStore();
    const invitations = await store.invitations.list({ userId: tenant.admin.id });

    expect(invitations).toHaveLength(2);
    expect(invitations.every((invitation) => invitation.tokenHash.length === 64)).toBe(true);
    expect(JSON.stringify(invitations)).not.toContain(firstToken);
    expect(JSON.stringify(await store.audit.list({ tenantId: tenant.organization.id }))).not.toContain(secondToken);
    await expect(completeAccountSetup(firstToken, "Valid-password-2026")).rejects.toBeInstanceOf(AccountAccessError);
    await expect(completeAccountSetup(secondToken, "short")).rejects.toMatchObject({ status: 400 });
    await expect(completeAccountSetup(secondToken, "Valid-password-2026")).resolves.toMatchObject({
      organizationCode: tenant.organization.slug,
    });
    await expect(completeAccountSetup(secondToken, "Valid-password-2026")).rejects.toMatchObject({
      message: "This setup link is invalid or expired.",
    });

    const expiredTenant = await provision("Phase 15 Expired", "expired@example.com");
    const expiredToken = rawToken(expiredTenant.invitation.setupUrl);
    const invitation = (await store.invitations.list({ userId: expiredTenant.admin.id }))[0];
    await store.invitations.update(invitation.id, { expiresAt: new Date(Date.now() - 1_000).toISOString() });
    await expect(completeAccountSetup(expiredToken, "Valid-password-2026")).rejects.toMatchObject({
      message: "This setup link is invalid or expired.",
    });
  });

  it("locks an account for fifteen minutes after five failed passwords", async () => {
    const tenant = await provision("Phase 15 Lock", "locked@example.com");
    await completeAccountSetup(rawToken(tenant.invitation.setupUrl), "Correct-password-2026");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        authenticateOrganizationUser(tenant.organization.slug, tenant.admin.email, "Incorrect-password")
      ).rejects.toMatchObject({ status: 401 });
    }

    const locked = await (await getStore()).users.get(tenant.admin.id);
    expect(locked?.failedLoginAttempts).toBe(5);
    expect(new Date(locked?.lockedUntil ?? 0).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    await expect(
      authenticateOrganizationUser(tenant.organization.slug, tenant.admin.email, "Correct-password-2026")
    ).rejects.toMatchObject({
      status: 401,
      message: "Invalid organization code, email, or password.",
    });
  });

  it("rolls back orphan tenant records and protects the last active tenant admin", async () => {
    const store = await getStore();
    const failedName = "Phase 15 Invalid Admin";
    await expect(
      provisionOrganization(
        { name: failedName, admin: { name: "", email: "invalid-admin@example.com" } },
        "Platform Admin",
        ORIGIN
      )
    ).rejects.toBeInstanceOf(UserServiceError);
    expect((await store.tenants.list()).some((tenant) => tenant.name === failedName)).toBe(false);

    const invitationCreate = store.invitations.create.bind(store.invitations);
    store.invitations.create = async () => {
      throw new Error("injected invitation failure");
    };
    try {
      await expect(provision("Phase 15 Invitation Rollback", "rollback@example.com")).rejects.toThrow(
        "injected invitation failure"
      );
    } finally {
      store.invitations.create = invitationCreate;
    }
    expect((await store.tenants.list()).some((tenant) => tenant.name === "Phase 15 Invitation Rollback")).toBe(false);

    const auditCreate = store.audit.create.bind(store.audit);
    store.audit.create = async () => {
      throw new Error("injected audit failure");
    };
    try {
      await expect(provision("Phase 15 Audit Rollback", "audit-rollback@example.com")).rejects.toThrow(
        "injected audit failure"
      );
    } finally {
      store.audit.create = auditCreate;
    }
    expect((await store.tenants.list()).some((candidate) => candidate.name === "Phase 15 Audit Rollback")).toBe(false);

    const tenant = await provision("Phase 15 Last Admin", "last-admin@example.com");
    await completeAccountSetup(rawToken(tenant.invitation.setupUrl), "Admin-password-2026");
    await expect(
      updateUser(tenant.organization.id, tenant.admin.id, { role: "manager" }, "super_admin", "Platform Admin")
    ).rejects.toMatchObject({
      status: 409,
      message: "Assign another active tenant admin before removing the last administrator.",
    });
  });

  it("supports password changes, authorized resets, tenant-admin promotion, and safe self-demotion", async () => {
    const tenant = await provision("Phase 15 Admin Lifecycle", "first-admin@example.com");
    await completeAccountSetup(rawToken(tenant.invitation.setupUrl), "First-password-2026");
    await changeOwnPassword(
      tenant.organization.id,
      tenant.admin.id,
      "First-password-2026",
      "Changed-password-2026",
      tenant.admin.email
    );
    await expect(
      authenticateOrganizationUser(tenant.organization.slug, tenant.admin.email, "First-password-2026")
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateOrganizationUser(tenant.organization.slug, tenant.admin.email, "Changed-password-2026")
    ).resolves.toMatchObject({ id: tenant.admin.id });

    const reset = await generateUserAccessLink(
      tenant.organization.id,
      tenant.admin.id,
      "tenant_admin",
      tenant.admin.email,
      ORIGIN
    );
    expect(reset.invitation.purpose).toBe("reset");
    await completeAccountSetup(rawToken(reset.invitation.setupUrl), "Reset-password-2026");

    const second = await inviteUser(
      tenant.organization.id,
      { name: "Second Admin", email: "second-admin@example.com", role: "tenant_admin" },
      "tenant_admin",
      tenant.admin.email,
      ORIGIN
    );
    await completeAccountSetup(rawToken(second.invitation.setupUrl), "Second-password-2026");
    await expect(
      updateUser(
        tenant.organization.id,
        tenant.admin.id,
        { role: "manager" },
        "tenant_admin",
        tenant.admin.email
      )
    ).resolves.toMatchObject({ role: "manager" });

    await expect(
      inviteUser(
        tenant.organization.id,
        { name: "Forbidden Super", email: "forbidden-super@example.com", role: "super_admin" },
        "tenant_admin",
        second.user.email,
        ORIGIN
      )
    ).rejects.toMatchObject({ status: 403 });
  });
});

import { appendAudit } from "../audit/auditChain";
import {
  hashAccessToken,
  hashPassword,
  newAccessToken,
  passwordValidationError,
  verifyPassword,
} from "../auth/passwords";
import { getStore } from "../data";
import type { DataStore } from "../data/store";
import { newId, now } from "../domain/ids";
import type {
  Role,
  TenantRow,
  UserInvitationPurpose,
  UserInvitationRow,
  UserRow,
} from "../domain/models";
import { sendSensitiveEmail } from "../notify/notifier";
import {
  createUser,
  type CreateUserInput,
  UserServiceError,
} from "./userService";

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
const LOCK_AFTER_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const GENERIC_LOGIN_ERROR = "Invalid organization code, email, or password.";
const GENERIC_LINK_ERROR = "This setup link is invalid or expired.";

const dummyHash = hashPassword("not-a-real-account-password");

export type UserAccessStatus = "invited" | "active" | "locked" | "disabled";

export type UserAccessView = Omit<
  UserRow,
  "passwordHash" | "failedLoginAttempts" | "lockedUntil"
> & {
  accessStatus: UserAccessStatus;
  pendingInvitationExpiresAt: string | null;
  hasLocalPassword: boolean;
};

export interface AccessLinkView {
  status: "pending";
  purpose: UserInvitationPurpose;
  expiresAt: string;
  delivery: "email_sent" | "copy_required";
  setupUrl: string;
}

export interface IssuedAccessLink {
  invitation: UserInvitationRow;
  rawToken: string;
  setupUrl: string;
}

export interface InvitedUserResult {
  user: UserAccessView;
  invitation: AccessLinkView;
}

export class AccountAccessError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "AccountAccessError";
  }
}

function isPending(invitation: UserInvitationRow, at = Date.now()): boolean {
  return (
    !invitation.acceptedAt &&
    !invitation.revokedAt &&
    new Date(invitation.expiresAt).getTime() > at
  );
}

export function toUserAccessView(
  user: UserRow,
  invitations: UserInvitationRow[] = [],
  at = Date.now()
): UserAccessView {
  const {
    passwordHash,
    failedLoginAttempts: _failedLoginAttempts,
    lockedUntil,
    ...safe
  } = user;
  void _failedLoginAttempts;
  const pending = invitations
    .filter((invitation) => invitation.userId === user.id && isPending(invitation, at))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  const locked = !!lockedUntil && new Date(lockedUntil).getTime() > at;
  const accessStatus: UserAccessStatus = locked
    ? "locked"
    : !user.active && pending?.purpose === "activate"
      ? "invited"
      : user.active
        ? "active"
        : "disabled";
  return {
    ...safe,
    accessStatus,
    pendingInvitationExpiresAt: pending?.expiresAt ?? null,
    hasLocalPassword: !!passwordHash,
  };
}

export async function userAccessViews(
  users: UserRow[],
  storeOverride?: DataStore
): Promise<UserAccessView[]> {
  const store = storeOverride ?? (await getStore());
  const tenantIds = new Set(users.map((user) => user.tenantId));
  const invitations = (await store.invitations.list()).filter((invitation) =>
    tenantIds.has(invitation.tenantId)
  );
  return users.map((user) => toUserAccessView(user, invitations));
}

function buildSetupUrl(baseUrl: string, rawToken: string): string {
  const url = new URL("/setup-account", baseUrl);
  url.hash = "token=" + encodeURIComponent(rawToken);
  return url.toString();
}

export async function issueUserAccessLinkInStore(
  store: DataStore,
  tenant: TenantRow,
  user: UserRow,
  purpose: UserInvitationPurpose,
  actor: string,
  baseUrl: string
): Promise<IssuedAccessLink> {
  const timestamp = now();
  const existing = await store.invitations.list({
    tenantId: tenant.id,
    userId: user.id,
  });
  for (const invitation of existing) {
    if (isPending(invitation)) {
      await store.invitations.update(invitation.id, {
        revokedAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  const rawToken = newAccessToken();
  const invitation: UserInvitationRow = {
    id: newId("invite"),
    tenantId: tenant.id,
    userId: user.id,
    tokenHash: hashAccessToken(rawToken),
    purpose,
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
    acceptedAt: null,
    revokedAt: null,
    createdBy: actor,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await store.invitations.create(invitation);
  await appendAudit(
    {
      tenantId: tenant.id,
      actor,
      action: purpose === "activate" ? "user.invited" : "user.access_reset_issued",
      payload: { userId: user.id, email: user.email, expiresAt: invitation.expiresAt },
    },
    store
  );
  return {
    invitation,
    rawToken,
    setupUrl: buildSetupUrl(baseUrl, rawToken),
  };
}

export async function deliverAccessLink(
  tenant: TenantRow,
  user: UserRow,
  issued: IssuedAccessLink
): Promise<AccessLinkView> {
  const sent = await sendSensitiveEmail(
    user.email,
    issued.invitation.purpose === "activate"
      ? "Set up your " + tenant.name + " support account"
      : "Reset your " + tenant.name + " support account",
    [
      "Hello " + user.name + ",",
      "",
      "Organization code: " + tenant.slug,
      "Use this one-time link within 24 hours: " + issued.setupUrl,
      "",
      "If you were not expecting this message, contact your organization administrator.",
    ].join("\n")
  );
  return {
    status: "pending",
    purpose: issued.invitation.purpose,
    expiresAt: issued.invitation.expiresAt,
    delivery: sent ? "email_sent" : "copy_required",
    setupUrl: issued.setupUrl,
  };
}

export async function inviteUser(
  tenantId: string,
  input: CreateUserInput,
  actorRole: string,
  actor: string,
  baseUrl: string
): Promise<InvitedUserResult> {
  const store = await getStore();
  const result = await store.transaction(async (tx) => {
    const tenant = await tx.tenants.get(tenantId);
    if (!tenant) throw new AccountAccessError("Organization not found.", 404);
    const user = await createUser(tenantId, input, actorRole, actor, {
      store: tx,
      active: false,
    });
    const issued = await issueUserAccessLinkInStore(
      tx,
      tenant,
      user,
      "activate",
      actor,
      baseUrl
    );
    return { tenant, user, issued };
  });
  return {
    user: toUserAccessView(result.user, [result.issued.invitation]),
    invitation: await deliverAccessLink(result.tenant, result.user, result.issued),
  };
}

export async function generateUserAccessLink(
  tenantId: string,
  userId: string,
  actorRole: string,
  actor: string,
  baseUrl: string
): Promise<InvitedUserResult> {
  const store = await getStore();
  const result = await store.transaction(async (tx) => {
    const [tenant, user] = await Promise.all([
      tx.tenants.get(tenantId),
      tx.users.get(userId),
    ]);
    if (!tenant || !user || user.tenantId !== tenantId) {
      throw new AccountAccessError("User not found.", 404);
    }
    if (user.role === "super_admin" && actorRole !== "super_admin") {
      throw new AccountAccessError("Forbidden.", 403);
    }
    if (user.role === "tenant_admin" && actorRole !== "tenant_admin" && actorRole !== "super_admin") {
      throw new AccountAccessError("Forbidden.", 403);
    }
    if (!new Set<Role>(["tenant_admin", "super_admin"]).has(actorRole as Role)) {
      throw new AccountAccessError("Forbidden.", 403);
    }
    const purpose: UserInvitationPurpose =
      user.active && !!user.passwordHash ? "reset" : "activate";
    const issued = await issueUserAccessLinkInStore(
      tx,
      tenant,
      user,
      purpose,
      actor,
      baseUrl
    );
    return { tenant, user, issued };
  });
  return {
    user: toUserAccessView(result.user, [result.issued.invitation]),
    invitation: await deliverAccessLink(result.tenant, result.user, result.issued),
  };
}

function assertUsableInvitation(invitation: UserInvitationRow | undefined): UserInvitationRow {
  if (!invitation || !isPending(invitation)) {
    throw new AccountAccessError(GENERIC_LINK_ERROR, 400);
  }
  return invitation;
}

export async function completeAccountSetup(
  rawToken: string,
  password: string
): Promise<{ organizationCode: string; email: string }> {
  if (!rawToken || rawToken.length > 256) {
    throw new AccountAccessError(GENERIC_LINK_ERROR, 400);
  }
  const validation = passwordValidationError(password);
  if (validation) throw new AccountAccessError(validation, 400);

  const store = await getStore();
  const tokenHash = hashAccessToken(rawToken);
  return store.transaction(async (tx) => {
    const invitation = assertUsableInvitation(
      (await tx.invitations.list({ tokenHash }))[0]
    );
    const [user, tenant] = await Promise.all([
      tx.users.get(invitation.userId),
      tx.tenants.get(invitation.tenantId),
    ]);
    if (!user || !tenant || user.tenantId !== tenant.id) {
      throw new AccountAccessError(GENERIC_LINK_ERROR, 400);
    }
    if (invitation.purpose === "reset" && !user.active) {
      throw new AccountAccessError(GENERIC_LINK_ERROR, 400);
    }

    const timestamp = now();
    const passwordHash = await hashPassword(password);
    const updated = await tx.users.update(user.id, {
      passwordHash,
      passwordChangedAt: timestamp,
      failedLoginAttempts: 0,
      lockedUntil: null,
      active: true,
      updatedAt: timestamp,
    });
    if (!updated) throw new AccountAccessError(GENERIC_LINK_ERROR, 400);
    await tx.invitations.update(invitation.id, {
      acceptedAt: timestamp,
      updatedAt: timestamp,
    });
    const otherInvitations = await tx.invitations.list({
      tenantId: tenant.id,
      userId: user.id,
    });
    for (const other of otherInvitations) {
      if (other.id !== invitation.id && isPending(other)) {
        await tx.invitations.update(other.id, {
          revokedAt: timestamp,
          updatedAt: timestamp,
        });
      }
    }
    await appendAudit(
      {
        tenantId: tenant.id,
        actor: user.email,
        action:
          invitation.purpose === "activate"
            ? "user.account_activated"
            : "user.password_reset",
        payload: { userId: user.id },
      },
      tx
    );
    return { organizationCode: tenant.slug, email: user.email };
  });
}

export async function authenticateOrganizationUser(
  organizationCode: string,
  emailInput: string,
  password: string
): Promise<UserRow> {
  const slug = organizationCode.trim().toLowerCase();
  const email = emailInput.trim().toLowerCase();
  const store = await getStore();
  const tenant = (await store.tenants.list({ slug }))[0];
  const user = tenant
    ? (await store.users.list({ tenantId: tenant.id })).find(
        (candidate) => candidate.email.toLowerCase() === email
      )
    : undefined;

  if (!user?.passwordHash || !user.active) {
    await verifyPassword(password, await dummyHash);
    throw new AccountAccessError(GENERIC_LOGIN_ERROR, 401);
  }

  const currentTime = Date.now();
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > currentTime) {
    throw new AccountAccessError(GENERIC_LOGIN_ERROR, 401);
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const previousFailures =
      user.lockedUntil && new Date(user.lockedUntil).getTime() <= currentTime
        ? 0
        : (user.failedLoginAttempts ?? 0);
    const failedLoginAttempts = previousFailures + 1;
    await store.users.update(user.id, {
      failedLoginAttempts,
      lockedUntil:
        failedLoginAttempts >= LOCK_AFTER_FAILURES
          ? new Date(currentTime + LOCK_DURATION_MS).toISOString()
          : null,
      updatedAt: now(),
    });
    throw new AccountAccessError(GENERIC_LOGIN_ERROR, 401);
  }

  await store.users.update(user.id, {
    failedLoginAttempts: 0,
    lockedUntil: null,
    updatedAt: now(),
  });
  return user;
}

export async function changeOwnPassword(
  tenantId: string,
  userId: string,
  currentPassword: string,
  newPassword: string,
  actor: string
): Promise<void> {
  const validation = passwordValidationError(newPassword);
  if (validation) throw new AccountAccessError(validation, 400);
  const store = await getStore();
  const user = await store.users.get(userId);
  if (!user || user.tenantId !== tenantId || !user.active || !user.passwordHash) {
    throw new AccountAccessError("Local password authentication is not enabled for this account.", 409);
  }
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AccountAccessError("Current password is incorrect.", 400);
  }
  const passwordHash = await hashPassword(newPassword);
  const timestamp = now();
  await store.users.update(user.id, {
    passwordHash,
    passwordChangedAt: timestamp,
    failedLoginAttempts: 0,
    lockedUntil: null,
    updatedAt: timestamp,
  });
  await appendAudit({
    tenantId,
    actor,
    action: "user.password_changed",
    payload: { userId },
  });
}

export function accountAccessError(error: unknown): AccountAccessError | UserServiceError | null {
  return error instanceof AccountAccessError || error instanceof UserServiceError
    ? error
    : null;
}

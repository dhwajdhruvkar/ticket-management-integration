import type { DataStore } from "../data/store";
import type { UserRow } from "../domain/models";

/**
 * Find one user by email inside a tenant with an equality query instead of
 * loading the tenant's users. Emails are stored lowercase (createUser, SSO
 * provisioning, seed), so the lookup is case-insensitive for callers.
 */
export async function findUserByEmail(store: DataStore, tenantId: string, email: string): Promise<UserRow | null> {
  return (await store.users.list({ tenantId, email: email.trim().toLowerCase() }, { take: 1 }))[0] ?? null;
}

import { getStore } from "../data";

export interface RequesterChoice { id: string; name: string; email: string; department: string | null; location: string | null }
export interface RequesterSearchResult { items: RequesterChoice[]; hasMore: boolean }

/**
 * Active users of the organization, alphabetical. An empty term browses the first
 * page; a term filters name, email, department and location before pagination.
 */
export async function searchRequesters(tenantId: string, query: string, limit = 20): Promise<RequesterSearchResult> {
  const term = query.trim().toLowerCase();
  const take = Math.max(1, Math.min(50, limit));
  const store = await getStore();
  // Filter before pagination: matches outside the first users page remain searchable.
  const matches = (await store.users.list({ tenantId, active: true }))
    .filter((user) => !term || `${user.name} ${user.email} ${user.department ?? ""} ${user.location ?? ""}`.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {
    items: matches.slice(0, take).map(({ id, name, email, department, location }) => ({
      id, name, email, department: department ?? null, location: location ?? null,
    })),
    hasMore: matches.length > take,
  };
}

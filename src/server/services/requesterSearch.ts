import { getStore } from "../data";

export interface RequesterChoice { id: string; name: string; email: string; department: string | null }
export interface RequesterSearchResult { items: RequesterChoice[]; hasMore: boolean }

export async function searchRequesters(tenantId: string, query: string, limit = 20): Promise<RequesterSearchResult> {
  const term = query.trim().toLowerCase();
  if (!term) return { items: [], hasMore: false };
  const take = Math.max(1, Math.min(50, limit));
  const store = await getStore();
  // Filter before pagination: matches outside the first users page remain searchable.
  const matches = (await store.users.list({ tenantId, active: true }))
    .filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {
    items: matches.slice(0, take).map(({ id, name, email, department }) => ({ id, name, email, department: department ?? null })),
    hasMore: matches.length > take,
  };
}

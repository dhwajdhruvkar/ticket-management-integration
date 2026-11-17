"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { apiGetAll } from "@/lib/api";
import { createReferenceCache, type ReferenceCache } from "@/lib/referenceCache";
import type { AssignmentGroupRow, CIRow, UserRow } from "@/server/domain/models";

// =============================================================================
// Per-tab cache for slow-changing lists (users, groups, CIs).
//
// Stale-while-revalidate with a 30 s freshness window (see referenceCache.ts):
// a mounting component gets the cached list at once and triggers a refresh only
// when it is older, so moving between tickets does not re-download the same
// lists. Entries are keyed by persona and read through useSyncExternalStore, so
// the rows returned for a render always belong to that render's persona; a
// persona switch can never show another identity's lists, not even for a frame.
// =============================================================================

const EMPTY: never[] = [];

const usersCache = createReferenceCache<UserRow>(() => apiGetAll<UserRow>("/users"));
const groupsCache = createReferenceCache<AssignmentGroupRow>(() => apiGetAll<AssignmentGroupRow>("/groups"));
const cisCache = createReferenceCache<CIRow>(() => apiGetAll<CIRow>("/cis"));

function useCached<T>(cache: ReferenceCache<T>, persona: string, enabled: boolean): T[] {
  const subscribe = useCallback((notify: () => void) => cache.subscribe(persona, notify), [cache, persona]);
  const getSnapshot = useCallback(() => (enabled ? cache.get(persona) : undefined) ?? (EMPTY as T[]), [cache, persona, enabled]);
  const rows = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY as T[]);
  useEffect(() => {
    if (enabled) cache.revalidate(persona).catch(() => undefined);
  }, [cache, persona, enabled]);
  return rows;
}

/** Users and assignment groups for staff screens (pass `enabled=false` for requesters). */
export function useReferenceData(personaId: string, enabled = true): { users: UserRow[]; groups: AssignmentGroupRow[] } {
  return { users: useCached(usersCache, personaId, enabled), groups: useCached(groupsCache, personaId, enabled) };
}

/** Configuration items; only call where the CI section is actually shown. */
export function useConfigurationItems(personaId: string, enabled = true): CIRow[] {
  return useCached(cisCache, personaId, enabled);
}

/** Drop cached lists (e.g. after editing users or groups); mounted screens refetch at once, others on next use. */
export function invalidateReferenceData(): void {
  usersCache.invalidate();
  groupsCache.invalidate();
  cisCache.invalidate();
}

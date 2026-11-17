"use client";

import { useEffect, useState } from "react";
import { apiGetAll } from "@/lib/api";
import type { AssignmentGroupRow, CIRow, UserRow } from "@/server/domain/models";

// =============================================================================
// Per-tab cache for slow-changing lists (users, groups, CIs).
//
// Stale-while-revalidate: a mounting component gets the cached list at once and
// triggers a refresh only when it is older than STALE_MS, so moving between
// tickets does not re-download the same lists. The cache is keyed by the signed-in
// persona, so a persona switch never shows another identity's lists.
// =============================================================================

const STALE_MS = 30_000;

interface Entry<T> {
  persona: string;
  data: T[] | undefined;
  fetchedAt: number;
  inflight?: Promise<T[]>;
}

function makeStore<T>(path: string) {
  const entry: Entry<T> = { persona: "", data: undefined, fetchedAt: 0 };
  const listeners = new Set<(rows: T[]) => void>();
  return {
    peek(persona: string): T[] | undefined {
      return entry.persona === persona ? entry.data : undefined;
    },
    /** Refreshes when missing or older than STALE_MS; concurrent callers share one request. */
    async revalidate(persona: string): Promise<void> {
      if (entry.persona !== persona) Object.assign(entry, { persona, data: undefined, fetchedAt: 0, inflight: undefined });
      if (entry.inflight || (entry.data && Date.now() - entry.fetchedAt < STALE_MS)) return void (await entry.inflight);
      const mine = (entry.inflight = apiGetAll<T>(path));
      try {
        const rows = await mine;
        if (entry.persona !== persona) return;
        entry.data = rows;
        entry.fetchedAt = Date.now();
        listeners.forEach((notify) => notify(rows));
      } finally {
        if (entry.inflight === mine) entry.inflight = undefined;
      }
    },
    subscribe(notify: (rows: T[]) => void) {
      listeners.add(notify);
      return () => void listeners.delete(notify);
    },
    clear() {
      Object.assign(entry, { persona: "", data: undefined, fetchedAt: 0, inflight: undefined });
    },
  };
}

const usersStore = makeStore<UserRow>("/users");
const groupsStore = makeStore<AssignmentGroupRow>("/groups");
const cisStore = makeStore<CIRow>("/cis");

function useCached<T>(store: ReturnType<typeof makeStore<T>>, persona: string, enabled: boolean): T[] {
  const [rows, setRows] = useState<T[]>(() => store.peek(persona) ?? []);
  useEffect(() => {
    if (!enabled) return;
    setRows(store.peek(persona) ?? []);
    const off = store.subscribe(setRows);
    store.revalidate(persona).catch(() => {});
    return off;
  }, [store, persona, enabled]);
  return rows;
}

/** Users and assignment groups for staff screens (pass `enabled=false` for requesters). */
export function useReferenceData(personaId: string, enabled = true): { users: UserRow[]; groups: AssignmentGroupRow[] } {
  return { users: useCached(usersStore, personaId, enabled), groups: useCached(groupsStore, personaId, enabled) };
}

/** Configuration items; only call where the CI section is actually shown. */
export function useConfigurationItems(personaId: string, enabled = true): CIRow[] {
  return useCached(cisStore, personaId, enabled);
}

/** Drop cached lists (e.g. after editing users or groups) so the next screen refetches. */
export function invalidateReferenceData(): void {
  usersStore.clear();
  groupsStore.clear();
  cisStore.clear();
}

// Framework-free stale-while-revalidate cache for slow-changing lists, keyed by
// persona. Kept separate from React so its rules are unit-testable:
//   - entries, in-flight requests and subscribers are all per persona;
//   - concurrent callers for one persona share one request;
//   - invalidation bumps a generation, so a request started before it can never
//     write its (older) result afterwards;
//   - a failed refresh keeps the last good data and is retried on the next call.

export interface ReferenceCache<T> {
  /** Cached rows for the persona, or undefined when nothing valid is cached. The same array instance is returned until the data changes. */
  get(persona: string): T[] | undefined;
  /** Calls `notify` when this persona's data changes. Other personas' updates never reach it. */
  subscribe(persona: string, notify: () => void): () => void;
  /** Refreshes when missing or older than the freshness window. Rejects when the request fails (cached data is kept). */
  revalidate(persona: string): Promise<void>;
  /** Drops cached data (one persona, or all) and refetches for personas that still have subscribers. */
  invalidate(persona?: string): void;
}

interface Entry<T> {
  data: T[] | undefined;
  fetchedAt: number;
  generation: number;
  inflight?: Promise<void>;
  listeners: Set<() => void>;
}

export function createReferenceCache<T>(
  fetcher: (persona: string) => Promise<T[]>,
  options: { staleMs?: number; now?: () => number } = {}
): ReferenceCache<T> {
  const staleMs = options.staleMs ?? 30_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry<T>>();

  const entryFor = (persona: string): Entry<T> => {
    let entry = entries.get(persona);
    if (!entry) entries.set(persona, (entry = { data: undefined, fetchedAt: 0, generation: 0, listeners: new Set() }));
    return entry;
  };
  const emit = (entry: Entry<T>) => entry.listeners.forEach((notify) => notify());

  function revalidate(persona: string): Promise<void> {
    const entry = entryFor(persona);
    if (entry.inflight) return entry.inflight;
    if (entry.data && now() - entry.fetchedAt < staleMs) return Promise.resolve();
    const generation = entry.generation;
    const request: Promise<void> = fetcher(persona).then(
      (rows) => {
        // Invalidated while in flight: this result is older than the invalidation, so it is discarded.
        if (entry.generation === generation) {
          entry.data = rows;
          entry.fetchedAt = now();
          emit(entry);
        }
      },
      (error) => {
        throw error; // cached data stays as it was
      }
    ).finally(() => {
      if (entry.inflight === request) entry.inflight = undefined;
    });
    entry.inflight = request;
    return request;
  }

  return {
    get: (persona) => entries.get(persona)?.data,
    subscribe(persona, notify) {
      const entry = entryFor(persona);
      entry.listeners.add(notify);
      return () => void entry.listeners.delete(notify);
    },
    revalidate,
    invalidate(persona) {
      for (const [key, entry] of persona === undefined ? [...entries] : ([[persona, entries.get(persona)]] as const)) {
        if (!entry) continue;
        entry.generation += 1;
        entry.data = undefined;
        entry.fetchedAt = 0;
        entry.inflight = undefined; // the superseded request is ignored by its generation check
        emit(entry);
        if (entry.listeners.size) revalidate(key).catch(() => undefined);
      }
    },
  };
}

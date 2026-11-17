// Framework-free "type to search" coordinator: debounces input, aborts the
// previous request, and drops any response that is no longer the latest query,
// so older results can never overwrite newer ones. Covered by
// tests/latestSearch.test.ts; the Help Center page (app/portal) binds it.

type SearchStatus = "idle" | "loading" | "done" | "error";

export interface SearchState<T> {
  query: string;
  status: SearchStatus;
  results: T[];
  error: string | null;
}

export interface LatestSearchOptions<T> {
  /** Runs the request; must honour `signal` where it can. */
  fetcher: (query: string, signal: AbortSignal) => Promise<T[]>;
  onChange: (state: SearchState<T>) => void;
  debounceMs?: number;
  minLength?: number;
}

export interface LatestSearch {
  /** Record the latest input. Short input clears at once; longer input searches after the debounce. */
  input(value: string): void;
  /** Search the value right away (quick-search chips), skipping the debounce. */
  now(value: string): void;
  /** Cancel timers and in-flight work; call on unmount. */
  dispose(): void;
}

export function createLatestSearch<T>({ fetcher, onChange, debounceMs = 300, minLength = 3 }: LatestSearchOptions<T>): LatestSearch {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let sequence = 0;
  let disposed = false;

  const emit = (state: SearchState<T>) => { if (!disposed) onChange(state); };
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  };

  async function run(query: string, mine: number) {
    const ctl = (controller = new AbortController());
    try {
      const results = await fetcher(query, ctl.signal);
      if (mine === sequence) emit({ query, status: "done", results, error: null });
    } catch (error) {
      if (mine !== sequence || ctl.signal.aborted) return; // superseded: say nothing
      emit({ query, status: "error", results: [], error: error instanceof Error && error.message ? error.message : "Search failed." });
    } finally {
      if (controller === ctl) controller = undefined;
    }
  }

  function start(value: string, delay: number) {
    cancel();
    const mine = ++sequence;
    const query = value.trim();
    if (query.length < minLength) return emit({ query: value, status: "idle", results: [], error: null });
    emit({ query, status: "loading", results: [], error: null }); // never leave the previous query's results on screen
    if (delay <= 0) void run(query, mine);
    else timer = setTimeout(() => { timer = undefined; void run(query, mine); }, delay);
  }

  return {
    input: (value) => start(value, debounceMs),
    now: (value) => start(value, 0),
    dispose() { disposed = true; sequence++; cancel(); },
  };
}

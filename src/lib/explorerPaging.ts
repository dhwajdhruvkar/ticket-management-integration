// =============================================================================
// Framework-free state machine behind the ticket explorer's server-side paging.
//
// Guarantees (each covered by tests/explorerPaging.test.ts):
//   - The displayed rows, total and view always belong together: they change in
//     one step, only after the request for them succeeded.
//   - A failed view/filter switch keeps the previous view and its rows and
//     reports an error instead of showing old rows under a new heading.
//   - Load more fetches exactly the next page, never refetches loaded pages,
//     ignores clicks while a request is pending, and appends without duplicates.
//   - Out-of-order or late responses can never overwrite a newer state.
// =============================================================================

export interface PageResult<R> {
  data: R[];
  meta: { total: number; totalPages: number; counts?: Record<string, number> };
}

export interface ExplorerSnapshot<R, S> {
  key: string;
  /** What the rows were loaded for (view, filters, search), kept for display. */
  spec: S;
  rows: R[];
  total: number;
  counts: Record<string, number>;
  loadedPages: number;
  totalPages: number;
}

export interface ExplorerError {
  kind: "initial" | "switch" | "more";
  message: string;
}

export interface ExplorerState<R, S> {
  committed: ExplorerSnapshot<R, S> | null;
  /** Key of a view/filter/search switch that is still loading (the committed view stays on screen meanwhile). */
  pendingKey: string | null;
  loadingMore: boolean;
  error: ExplorerError | null;
}

export type FetchPage<R> = (key: string, page: number) => Promise<PageResult<R>>;

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : "The request failed.");

export function appendUnique<R extends { id: string }>(existing: R[], incoming: R[]): R[] {
  const seen = new Set(existing.map((row) => row.id));
  const out = [...existing];
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export class ExplorerController<R extends { id: string }, S> {
  private state: ExplorerState<R, S> = { committed: null, pendingKey: null, loadingMore: false, error: null };
  /** Bumped by every switch; responses from an older epoch are discarded. */
  private epoch = 0;
  private refreshing = false;
  private lastSwitch: { key: string; spec: S } | null = null;

  constructor(
    private readonly fetchPage: FetchPage<R>,
    private readonly onChange: (state: ExplorerState<R, S>) => void = () => {}
  ) {}

  getState(): ExplorerState<R, S> {
    return this.state;
  }

  private set(patch: Partial<ExplorerState<R, S>>) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  /** Load page 1 of a new view/filter/search and commit it atomically on success. */
  async select(key: string, spec: S): Promise<void> {
    const epoch = ++this.epoch;
    this.lastSwitch = { key, spec };
    this.set({ pendingKey: key, loadingMore: false, error: null });
    try {
      const page = await this.fetchPage(key, 1);
      if (epoch !== this.epoch) return; // a newer switch superseded this one
      this.set({
        committed: { key, spec, rows: appendUnique([], page.data), total: page.meta.total, counts: page.meta.counts ?? {}, loadedPages: 1, totalPages: page.meta.totalPages },
        pendingKey: null,
      });
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.set({ pendingKey: null, error: { kind: this.state.committed ? "switch" : "initial", message: messageOf(error) } });
    }
  }

  /** Fetch only the next page and append it. No-op while anything else is loading. */
  async loadMore(): Promise<void> {
    const snapshot = this.state.committed;
    if (!snapshot || this.state.loadingMore || this.state.pendingKey || snapshot.loadedPages >= snapshot.totalPages) return;
    const epoch = this.epoch;
    const page = snapshot.loadedPages + 1;
    this.set({ loadingMore: true, error: null });
    try {
      const result = await this.fetchPage(snapshot.key, page);
      if (epoch !== this.epoch || this.state.committed !== snapshot) return; // view changed or was refreshed meanwhile
      const emptyBeyondEnd = result.data.length === 0; // offset past the available records
      this.set({
        committed: {
          ...snapshot,
          rows: appendUnique(snapshot.rows, result.data),
          total: result.meta.total,
          counts: result.meta.counts ?? snapshot.counts,
          loadedPages: page,
          totalPages: emptyBeyondEnd ? page : result.meta.totalPages,
        },
        loadingMore: false,
      });
    } catch (error) {
      if (epoch !== this.epoch || this.state.committed !== snapshot) return;
      this.set({ loadingMore: false, error: { kind: "more", message: messageOf(error) } });
    }
  }

  /**
   * Live refresh: re-read the pages already loaded so the list and counts stay
   * current. Skipped while a switch or Load more is in flight, and failures are
   * silent (the last good data stays).
   */
  async refresh(): Promise<void> {
    const snapshot = this.state.committed;
    if (!snapshot || this.refreshing || this.state.loadingMore || this.state.pendingKey) return;
    this.refreshing = true;
    const epoch = this.epoch;
    try {
      const results = await Promise.all(Array.from({ length: snapshot.loadedPages }, (_, i) => this.fetchPage(snapshot.key, i + 1)));
      if (epoch !== this.epoch || this.state.committed !== snapshot) return;
      const rows = results.reduce<R[]>((all, r) => appendUnique(all, r.data), []);
      this.set({
        committed: { ...snapshot, rows, total: results[0].meta.total, counts: results[0].meta.counts ?? snapshot.counts, totalPages: results[0].meta.totalPages },
      });
    } catch {
      // Keep the last good data; the next refresh or a user action reports problems.
    } finally {
      this.refreshing = false;
    }
  }

  /** Re-run whatever failed last. */
  async retry(): Promise<void> {
    const error = this.state.error;
    if (!error) return;
    if (error.kind === "more") return this.loadMore();
    if (this.lastSwitch) return this.select(this.lastSwitch.key, this.lastSwitch.spec);
  }
}

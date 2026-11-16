import { describe, expect, it } from "vitest";
import { ExplorerController, appendUnique, type PageResult } from "@/lib/explorerPaging";

interface Row { id: string }
interface Spec { view: string }

/** A fake API whose responses are released by the test, so races can be staged. */
function harness(dataset: Record<string, Row[]>, pageSize = 3) {
  const calls: { key: string; page: number }[] = [];
  const pending: { key: string; page: number; resolve: () => void; reject: (e: Error) => void }[] = [];
  const auto = { value: true };
  const fetchPage = (key: string, page: number) => {
    calls.push({ key, page });
    const all = dataset[key] ?? [];
    const result: PageResult<Row> = { data: all.slice((page - 1) * pageSize, page * pageSize), meta: { total: all.length, totalPages: Math.ceil(all.length / pageSize), counts: { all: all.length } } };
    if (auto.value) return Promise.resolve(result);
    return new Promise<PageResult<Row>>((resolve, reject) => pending.push({ key, page, resolve: () => resolve(result), reject }));
  };
  const states: unknown[] = [];
  const ctrl = new ExplorerController<Row, Spec>(fetchPage, (s) => states.push(s));
  return { ctrl, calls, pending, auto, states };
}
const rows = (prefix: string, n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${String(i + 1).padStart(2, "0")}` }));
const ids = (c: ExplorerController<Row, Spec>) => c.getState().committed?.rows.map((r) => r.id);

describe("view switching (F1)", () => {
  it("commits rows, total, counts and spec together after a successful switch", async () => {
    const h = harness({ a: rows("a", 5), b: rows("b", 2) });
    await h.ctrl.select("a", { view: "a" });
    expect(h.ctrl.getState()).toMatchObject({ pendingKey: null, error: null, committed: { total: 5, spec: { view: "a" }, counts: { all: 5 } } });
    await h.ctrl.select("b", { view: "b" });
    expect(ids(h.ctrl)).toEqual(["b01", "b02"]);
    expect(h.ctrl.getState().committed).toMatchObject({ total: 2, spec: { view: "b" }, key: "b" });
  });

  it("keeps the previous view, its rows and total while the next one is loading", async () => {
    const h = harness({ a: rows("a", 5), b: rows("b", 2) });
    await h.ctrl.select("a", { view: "a" });
    h.auto.value = false;
    const switching = h.ctrl.select("b", { view: "b" });
    expect(h.ctrl.getState()).toMatchObject({ pendingKey: "b", committed: { key: "a", total: 5, spec: { view: "a" } } });
    expect(ids(h.ctrl)).toEqual(["a01", "a02", "a03"]);
    h.pending[0].resolve();
    await switching;
    expect(h.ctrl.getState().committed?.key).toBe("b");
  });

  it("on failure retains the previous view with its records and reports an error", async () => {
    const h = harness({ a: rows("a", 5), b: rows("b", 2) });
    await h.ctrl.select("a", { view: "a" });
    h.auto.value = false;
    const switching = h.ctrl.select("b", { view: "b" });
    h.pending[0].reject(new Error("boom"));
    await switching;
    const s = h.ctrl.getState();
    expect(s.committed).toMatchObject({ key: "a", total: 5, spec: { view: "a" } });
    expect(ids(h.ctrl)).toEqual(["a01", "a02", "a03"]);
    expect(s.pendingKey).toBeNull();
    expect(s.error).toEqual({ kind: "switch", message: "boom" });
  });

  it("reports an initial failure without inventing data, and retry recovers", async () => {
    const h = harness({ a: rows("a", 2) });
    h.auto.value = false;
    const first = h.ctrl.select("a", { view: "a" });
    h.pending[0].reject(new Error("down"));
    await first;
    expect(h.ctrl.getState()).toMatchObject({ committed: null, error: { kind: "initial", message: "down" } });
    h.auto.value = true;
    await h.ctrl.retry();
    expect(h.ctrl.getState()).toMatchObject({ error: null, committed: { key: "a", total: 2 } });
  });

  it("retry after a failed switch re-requests that switch and clears the error", async () => {
    const h = harness({ a: rows("a", 5), b: rows("b", 2) });
    await h.ctrl.select("a", { view: "a" });
    h.auto.value = false;
    const failed = h.ctrl.select("b", { view: "b" });
    h.pending[0].reject(new Error("boom"));
    await failed;
    h.auto.value = true;
    await h.ctrl.retry();
    expect(h.ctrl.getState()).toMatchObject({ error: null, committed: { key: "b", total: 2 } });
  });

  it("rapid switches: only the latest result is committed, whatever order responses arrive in", async () => {
    const h = harness({ a: rows("a", 2), b: rows("b", 2), c: rows("c", 2) });
    h.auto.value = false;
    const sa = h.ctrl.select("a", { view: "a" });
    const sb = h.ctrl.select("b", { view: "b" });
    const sc = h.ctrl.select("c", { view: "c" });
    // Responses arrive newest-first, then the stale ones.
    h.pending[2].resolve(); await sc;
    expect(h.ctrl.getState().committed?.key).toBe("c");
    h.pending[0].resolve(); h.pending[1].resolve(); await Promise.all([sa, sb]);
    expect(h.ctrl.getState().committed?.key).toBe("c");
    expect(ids(h.ctrl)).toEqual(["c01", "c02"]);
  });

  it("a stale failure cannot raise an error over a newer successful switch", async () => {
    const h = harness({ a: rows("a", 2), b: rows("b", 2) });
    h.auto.value = false;
    const sa = h.ctrl.select("a", { view: "a" });
    const sb = h.ctrl.select("b", { view: "b" });
    h.pending[1].resolve(); await sb;
    h.pending[0].reject(new Error("late failure")); await sa;
    expect(h.ctrl.getState()).toMatchObject({ error: null, committed: { key: "b" } });
  });

  it("an empty view is a valid committed state", async () => {
    const h = harness({ empty: [] });
    await h.ctrl.select("empty", { view: "empty" });
    expect(h.ctrl.getState().committed).toMatchObject({ rows: [], total: 0, totalPages: 0 });
    h.ctrl.loadMore();
    expect(h.calls).toHaveLength(1); // nothing further to load
  });
});

describe("incremental paging (F2)", () => {
  it("initial load requests page 1 only; each Load more requests exactly the next page", async () => {
    const h = harness({ a: rows("a", 10) }); // 4 pages of 3
    await h.ctrl.select("a", { view: "a" });
    expect(h.calls).toEqual([{ key: "a", page: 1 }]);
    await h.ctrl.loadMore();
    await h.ctrl.loadMore();
    await h.ctrl.loadMore();
    expect(h.calls.map((c) => c.page)).toEqual([1, 2, 3, 4]); // before the fix this was 1,1,2,1,2,3,...
    expect(ids(h.ctrl)).toEqual(rows("a", 10).map((r) => r.id));
    expect(h.ctrl.getState().committed).toMatchObject({ total: 10, loadedPages: 4, totalPages: 4 });
  });

  it("loading five pages costs five requests in total, not fifteen", async () => {
    const h = harness({ a: rows("a", 15) }, 3);
    await h.ctrl.select("a", { view: "a" });
    for (let i = 0; i < 4; i++) await h.ctrl.loadMore();
    expect(h.calls).toHaveLength(5);
  });

  it("does nothing once every page is loaded (final page shorter than the page size)", async () => {
    const h = harness({ a: rows("a", 4) });
    await h.ctrl.select("a", { view: "a" });
    await h.ctrl.loadMore();
    const before = h.calls.length;
    await h.ctrl.loadMore();
    await h.ctrl.loadMore();
    expect(h.calls).toHaveLength(before);
    expect(ids(h.ctrl)).toHaveLength(4);
  });

  it("ignores Load more clicks while one is pending (no duplicate page request)", async () => {
    const h = harness({ a: rows("a", 12) });
    await h.ctrl.select("a", { view: "a" });
    h.auto.value = false;
    const first = h.ctrl.loadMore();
    void h.ctrl.loadMore(); void h.ctrl.loadMore();
    expect(h.ctrl.getState().loadingMore).toBe(true);
    expect(h.pending).toHaveLength(1);
    h.pending[0].resolve(); await first;
    expect(h.calls.filter((c) => c.page === 2)).toHaveLength(1);
    expect(h.ctrl.getState().loadingMore).toBe(false);
    expect(ids(h.ctrl)).toHaveLength(6);
  });

  it("appends without duplicates when the list shifted between pages, and keeps order", async () => {
    expect(appendUnique([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }, { id: "c" }]).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps loaded records when a Load more fails, and retry fetches that same page", async () => {
    const h = harness({ a: rows("a", 9) });
    await h.ctrl.select("a", { view: "a" });
    h.auto.value = false;
    const failing = h.ctrl.loadMore();
    h.pending[0].reject(new Error("page 2 failed"));
    await failing;
    expect(ids(h.ctrl)).toEqual(["a01", "a02", "a03"]);
    expect(h.ctrl.getState()).toMatchObject({ loadingMore: false, error: { kind: "more", message: "page 2 failed" }, committed: { loadedPages: 1, key: "a" } });
    h.auto.value = true;
    await h.ctrl.retry();
    expect(h.calls.filter((c) => c.page === 2)).toHaveLength(2);
    expect(ids(h.ctrl)).toHaveLength(6);
    expect(h.ctrl.getState().error).toBeNull();
  });

  it("a response for an older view never lands on a newer view (filter changed during Load more)", async () => {
    const h = harness({ a: rows("a", 9), b: rows("b", 9) });
    await h.ctrl.select("a", { view: "a" });
    h.auto.value = false;
    const more = h.ctrl.loadMore(); // page 2 of "a" pending
    const swap = h.ctrl.select("b", { view: "b" }); // user changes the filter
    h.pending[1].resolve(); await swap;
    h.pending[0].resolve(); await more; // late page 2 of "a"
    expect(h.ctrl.getState().committed?.key).toBe("b");
    expect(ids(h.ctrl)).toEqual(["b01", "b02", "b03"]);
    expect(h.ctrl.getState().loadingMore).toBe(false);
  });

  it("pagination resets to page 1 whenever the view, filters, search or sort key changes", async () => {
    const h = harness({ a: rows("a", 9), "a&q=x": rows("ax", 9), "a&sort=y": rows("ay", 9) });
    await h.ctrl.select("a", { view: "a" });
    await h.ctrl.loadMore();
    await h.ctrl.select("a&q=x", { view: "a" });
    expect(h.ctrl.getState().committed).toMatchObject({ loadedPages: 1 });
    expect(h.calls.at(-1)).toEqual({ key: "a&q=x", page: 1 });
    await h.ctrl.loadMore();
    await h.ctrl.select("a&sort=y", { view: "a" });
    expect(h.calls.at(-1)).toEqual({ key: "a&sort=y", page: 1 });
    expect(ids(h.ctrl)).toEqual(["ay01", "ay02", "ay03"]);
  });

  it("an offset beyond the available records (empty page) ends pagination instead of looping", async () => {
    const calls: number[] = [];
    const ctrl = new ExplorerController<Row, Spec>(async (_k, page) => {
      calls.push(page);
      // The server reports 3 pages but the third has been emptied by deletions.
      return { data: page === 1 ? rows("a", 3) : page === 2 ? rows("b", 3) : [], meta: { total: 6, totalPages: 3 } };
    });
    await ctrl.select("a", { view: "a" });
    await ctrl.loadMore(); await ctrl.loadMore(); await ctrl.loadMore(); await ctrl.loadMore();
    expect(calls).toEqual([1, 2, 3]);
    expect(ctrl.getState().committed).toMatchObject({ loadedPages: 3, totalPages: 3 });
  });

  it("the server total stays the server's number across pages", async () => {
    const h = harness({ a: rows("a", 10) });
    await h.ctrl.select("a", { view: "a" });
    const totals = [h.ctrl.getState().committed?.total];
    await h.ctrl.loadMore(); totals.push(h.ctrl.getState().committed?.total);
    await h.ctrl.loadMore(); totals.push(h.ctrl.getState().committed?.total);
    expect(totals).toEqual([10, 10, 10]);
  });
});

describe("live refresh", () => {
  it("re-reads exactly the loaded pages, keeps order, and never overlaps itself", async () => {
    const h = harness({ a: rows("a", 9) });
    await h.ctrl.select("a", { view: "a" });
    await h.ctrl.loadMore();
    const before = h.calls.length;
    h.auto.value = false;
    const first = h.ctrl.refresh();
    void h.ctrl.refresh();
    expect(h.calls.length - before).toBe(2); // pages 1 and 2, once
    h.pending.forEach((p) => p.resolve()); await first;
    expect(ids(h.ctrl)).toEqual(rows("a", 6).map((r) => r.id));
  });

  it("is skipped while a switch or Load more is pending, and a failed refresh is silent", async () => {
    const h = harness({ a: rows("a", 9), b: rows("b", 3) });
    await h.ctrl.select("a", { view: "a" });
    h.auto.value = false;
    const more = h.ctrl.loadMore();
    const n = h.calls.length;
    await h.ctrl.refresh();
    expect(h.calls).toHaveLength(n);
    h.pending[0].resolve(); await more;
    h.auto.value = false;
    const refreshing = h.ctrl.refresh();
    h.pending.at(-1)!.reject(new Error("x")); h.pending.at(-2)!.reject(new Error("x"));
    await refreshing;
    expect(h.ctrl.getState().error).toBeNull();
    expect(ids(h.ctrl)).toHaveLength(6);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLatestSearch, type SearchState } from "@/lib/latestSearch";

interface Call { query: string; signal: AbortSignal; resolve: (rows: string[]) => void; reject: (e: unknown) => void }

function setup(opts: { debounceMs?: number; minLength?: number } = {}) {
  const calls: Call[] = [];
  const states: SearchState<string>[] = [];
  const search = createLatestSearch<string>({
    fetcher: (query, signal) => new Promise((resolve, reject) => { calls.push({ query, signal, resolve, reject }); }),
    onChange: (state) => states.push(state),
    ...opts,
  });
  return { search, calls, states, last: () => states.at(-1)! };
}
const tick = () => vi.advanceTimersByTimeAsync(0);

describe("createLatestSearch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces typing: one request after a pause, not one per keystroke", async () => {
    const { search, calls } = setup({ debounceMs: 300 });
    for (const text of ["vpn", "vpn a", "vpn ac", "vpn acc"]) { search.input(text); await vi.advanceTimersByTimeAsync(100); }
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(calls.map((c) => c.query)).toEqual(["vpn acc"]);
  });

  it("clears results immediately below the minimum length and makes no request", async () => {
    const { search, calls, last } = setup();
    search.input("vpn");
    await vi.advanceTimersByTimeAsync(300);
    calls[0].resolve(["a"]);
    await tick();
    expect(last()).toMatchObject({ status: "done", results: ["a"] });
    search.input("vp");
    expect(last()).toMatchObject({ status: "idle", results: [] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
  });

  it("aborts the previous request and ignores its late response", async () => {
    const { search, calls, last } = setup({ debounceMs: 0 });
    search.now("first query");
    search.now("second query");
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
    calls[1].resolve(["new"]);
    await tick();
    calls[0].resolve(["old"]); // older request finishes last
    await tick();
    expect(last()).toMatchObject({ query: "second query", status: "done", results: ["new"] });
  });

  it("never leaves the previous query's results visible while a new search is loading", async () => {
    const { search, calls, last } = setup({ debounceMs: 0 });
    search.now("alpha");
    calls[0].resolve(["alpha-hit"]);
    await tick();
    search.now("beta");
    expect(last()).toMatchObject({ query: "beta", status: "loading", results: [] });
  });

  it("reports a failure for the latest query, but stays silent for a superseded or aborted one", async () => {
    const { search, calls, states, last } = setup({ debounceMs: 0 });
    search.now("one");
    search.now("two");
    calls[0].reject(new DOMException("aborted", "AbortError"));
    await tick();
    expect(states.some((s) => s.status === "error")).toBe(false);
    calls[1].reject(new Error("Server exploded"));
    await tick();
    expect(last()).toMatchObject({ query: "two", status: "error", results: [], error: "Server exploded" });
  });

  it("a quick-search chip searches at once and cancels a pending debounce", async () => {
    const { search, calls } = setup({ debounceMs: 300 });
    search.input("vp");
    search.input("typing in progress");
    search.now("reset password");
    expect(calls.map((c) => c.query)).toEqual(["reset password"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1); // the typed text's timer was cancelled
  });

  it("dispose cancels timers and in-flight requests and silences later responses", async () => {
    const { search, calls, states } = setup({ debounceMs: 300 });
    search.input("pending text");
    search.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(0);
    const inflight = setup({ debounceMs: 0 });
    inflight.search.now("running");
    const count = inflight.states.length;
    inflight.search.dispose();
    expect(inflight.calls[0].signal.aborted).toBe(true);
    inflight.calls[0].resolve(["late"]);
    await tick();
    expect(inflight.states).toHaveLength(count);
    expect(states).toHaveLength(1);
  });
});

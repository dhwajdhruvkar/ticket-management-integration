import { describe, expect, it, vi } from "vitest";
import { createReferenceCache } from "@/lib/referenceCache";

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  let clock = 1_000;
  const calls: { persona: string; d: Deferred<string[]> }[] = [];
  const fetcher = vi.fn((persona: string) => { const d = defer<string[]>(); calls.push({ persona, d }); return d.promise; });
  const cache = createReferenceCache<string>(fetcher, { staleMs: 30_000, now: () => clock });
  return { cache, fetcher, calls, advance: (ms: number) => { clock += ms; } };
}

describe("reference cache", () => {
  it("returns nothing before the first load, then the cached rows", async () => {
    const { cache, calls } = setup();
    expect(cache.get("dana")).toBeUndefined();
    const load = cache.revalidate("dana");
    calls[0].d.resolve(["a"]);
    await load;
    expect(cache.get("dana")).toEqual(["a"]);
    expect(cache.get("dana")).toBe(cache.get("dana")); // stable snapshot identity
  });

  it("does not refetch inside the 30 s window and refetches after it, keeping old rows meanwhile", async () => {
    const { cache, fetcher, calls, advance } = setup();
    const first = cache.revalidate("dana");
    calls[0].d.resolve(["a"]);
    await first;
    advance(29_999);
    await cache.revalidate("dana");
    expect(fetcher).toHaveBeenCalledTimes(1);
    advance(2);
    const refresh = cache.revalidate("dana");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cache.get("dana")).toEqual(["a"]); // stale rows stay visible while refreshing
    calls[1].d.resolve(["b"]);
    await refresh;
    expect(cache.get("dana")).toEqual(["b"]);
  });

  it("shares one request between concurrent callers of the same persona", async () => {
    const { cache, fetcher, calls } = setup();
    const a = cache.revalidate("dana");
    const b = cache.revalidate("dana");
    expect(fetcher).toHaveBeenCalledTimes(1);
    calls[0].d.resolve(["a"]);
    await Promise.all([a, b]);
    expect(cache.get("dana")).toEqual(["a"]);
  });

  it("keeps personas separate: data, requests and subscribers", async () => {
    const { cache, fetcher, calls } = setup();
    const danaSeen = vi.fn();
    const sam = vi.fn();
    cache.subscribe("dana", danaSeen);
    cache.subscribe("sam", sam);
    const a = cache.revalidate("dana");
    const b = cache.revalidate("sam");
    expect(fetcher).toHaveBeenCalledTimes(2);
    calls[0].d.resolve(["dana-row"]);
    await a;
    expect(danaSeen).toHaveBeenCalledTimes(1);
    expect(sam).not.toHaveBeenCalled(); // no cross-persona notification
    expect(cache.get("sam")).toBeUndefined(); // never another identity's rows
    calls[1].d.resolve(["sam-row"]);
    await b;
    expect(cache.get("dana")).toEqual(["dana-row"]);
    expect(cache.get("sam")).toEqual(["sam-row"]);
    expect(danaSeen).toHaveBeenCalledTimes(1);
  });

  it("a persona switch is immediate: the new persona reads empty while the old persona's request resolves late", async () => {
    const { cache, calls } = setup();
    const oldLoad = cache.revalidate("dana");
    expect(cache.get("sam")).toBeUndefined(); // switched to sam before dana's request returned
    const newLoad = cache.revalidate("sam");
    calls[1].d.resolve(["sam-row"]);
    await newLoad;
    calls[0].d.resolve(["dana-row"]); // old request resolves after the switch
    await oldLoad;
    expect(cache.get("sam")).toEqual(["sam-row"]);
    expect(cache.get("dana")).toEqual(["dana-row"]); // lands under its own persona only
  });

  it("an invalidated in-flight request cannot overwrite newer data", async () => {
    const { cache, calls } = setup();
    const stale = cache.revalidate("dana");
    cache.invalidate("dana");
    const fresh = cache.revalidate("dana");
    expect(calls).toHaveLength(2);
    calls[1].d.resolve(["new"]);
    await fresh;
    calls[0].d.resolve(["old"]); // older request finishes last
    await stale;
    expect(cache.get("dana")).toEqual(["new"]);
  });

  it("invalidate drops data, notifies subscribers and refetches for mounted personas only", async () => {
    const { cache, fetcher, calls } = setup();
    const first = cache.revalidate("dana");
    calls[0].d.resolve(["a"]);
    await first;
    const other = cache.revalidate("sam");
    calls[1].d.resolve(["s"]);
    await other;
    const seen = vi.fn();
    cache.subscribe("dana", seen);
    cache.invalidate();
    expect(cache.get("dana")).toBeUndefined();
    expect(cache.get("sam")).toBeUndefined();
    expect(seen).toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(3); // dana has a subscriber, sam does not
    expect(calls[2].persona).toBe("dana");
    calls[2].d.resolve(["a2"]);
    await flush();
    expect(cache.get("dana")).toEqual(["a2"]);
    void cache.revalidate("sam");
    expect(fetcher).toHaveBeenCalledTimes(4); // sam refetches lazily on next use
  });

  it("a failed refresh keeps valid cached data and is retried next time", async () => {
    const { cache, fetcher, calls, advance } = setup();
    const first = cache.revalidate("dana");
    calls[0].d.resolve(["good"]);
    await first;
    advance(31_000);
    const failing = cache.revalidate("dana");
    calls[1].d.reject(new Error("network"));
    await expect(failing).rejects.toThrow("network");
    expect(cache.get("dana")).toEqual(["good"]);
    const retry = cache.revalidate("dana");
    expect(fetcher).toHaveBeenCalledTimes(3); // not stuck behind the failed request
    calls[2].d.resolve(["better"]);
    await retry;
    expect(cache.get("dana")).toEqual(["better"]);
  });

  it("a failed first load leaves the cache empty and retryable", async () => {
    const { cache, fetcher, calls } = setup();
    const failing = cache.revalidate("dana");
    calls[0].d.reject(new Error("boom"));
    await expect(failing).rejects.toThrow("boom");
    expect(cache.get("dana")).toBeUndefined();
    void cache.revalidate("dana");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("unsubscribed listeners are not notified", async () => {
    const { cache, calls } = setup();
    const seen = vi.fn();
    const off = cache.subscribe("dana", seen);
    off();
    const load = cache.revalidate("dana");
    calls[0].d.resolve(["a"]);
    await load;
    expect(seen).not.toHaveBeenCalled();
  });
});

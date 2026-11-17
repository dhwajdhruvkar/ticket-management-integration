import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGraphTokenCache, getGraphToken, GraphTokenError } from "@/server/integrations/graphToken";

const creds = { tenantId: "t1", clientId: "c1", clientSecret: "s1" };
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("getGraphToken: concurrency, validation and failures", () => {
  beforeEach(() => clearGraphTokenCache());
  afterEach(() => vi.unstubAllGlobals());

  it("shares one request between concurrent callers with the same credentials", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchMock = vi.fn().mockImplementation(async () => { await gate; return ok({ access_token: "shared", expires_in: 3600 }); });
    vi.stubGlobal("fetch", fetchMock);
    const calls = [getGraphToken(creds, 1), getGraphToken(creds, 1), getGraphToken(creds, 1)];
    release();
    expect(await Promise.all(calls)).toEqual(["shared", "shared", "shared"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not share requests or tokens between different credential sets", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { body: URLSearchParams }) => ok({ access_token: `for-${init.body.get("client_id")}`, expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    const [a, b, c] = await Promise.all([getGraphToken(creds, 1), getGraphToken({ ...creds, clientId: "c2" }, 1), getGraphToken({ ...creds, clientSecret: "s2" }, 1)]);
    expect([a, b, c]).toEqual(["for-c1", "for-c2", "for-c1"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("a failed request is not cached and not left in flight: the next call retries", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok({ error: "x" }, 500)).mockResolvedValueOnce(ok({ access_token: "recovered", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    const [first, second] = await Promise.allSettled([getGraphToken(creds, 1), getGraphToken(creds, 1)]);
    expect(first.status).toBe("rejected"); // both concurrent callers see the one failure
    expect(second.status).toBe("rejected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getGraphToken(creds, 2)).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a network error or timeout rejects and is not cached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new DOMException("timed out", "TimeoutError")).mockResolvedValueOnce(ok({ access_token: "ok", expires_in: 3600 })));
    await expect(getGraphToken(creds, 1)).rejects.toThrow("timed out");
    expect(await getGraphToken(creds, 2)).toBe("ok");
  });

  it("refreshes an expired token once, even when several callers arrive together", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ok({ access_token: `tok-${fetchMock.mock.calls.length}`, expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    await getGraphToken(creds, 0);
    const later = 3_600_000;
    expect(await Promise.all([getGraphToken(creds, later), getGraphToken(creds, later)])).toEqual(["tok-2", "tok-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects missing or malformed credentials before any network call, without echoing them", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const secret = "super-secret-value";
    for (const bad of [
      { tenantId: undefined, clientId: "c", clientSecret: secret },
      { tenantId: "t", clientId: "", clientSecret: secret },
      { tenantId: "t", clientId: "c", clientSecret: undefined },
      { tenantId: "../evil", clientId: "c", clientSecret: secret },
      { tenantId: "t/oauth2?x=", clientId: "c", clientSecret: secret },
    ]) {
      const error = await getGraphToken(bad).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GraphTokenError);
      expect(String((error as Error).message)).not.toContain(secret);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never writes credentials or tokens to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ access_token: "tok-secret", expires_in: 3600 })).mockResolvedValueOnce(ok({}, 401)));
    await getGraphToken(creds, 1);
    await getGraphToken({ ...creds, clientId: "c9" }, 1).catch(() => undefined);
    const output = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    for (const secret of ["s1", "tok-secret"]) expect(output).not.toContain(secret);
    spies.forEach((spy) => spy.mockRestore());
  });

  it("encodes the tenant in the token URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ access_token: "t", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    await getGraphToken({ ...creds, tenantId: "contoso.onmicrosoft.com" }, 1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token");
  });
});

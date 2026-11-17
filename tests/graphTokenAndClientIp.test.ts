import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGraphTokenCache, getGraphToken, GraphTokenError } from "@/server/integrations/graphToken";
import { clientIp } from "@/server/clientIp";
import { clientKey } from "@/server/rateLimit";

const creds = { tenantId: "t1", clientId: "c1", clientSecret: "s1" };
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("getGraphToken", () => {
  beforeEach(() => clearGraphTokenCache());
  afterEach(() => vi.unstubAllGlobals());

  it("caches until expiry minus 60s, then fetches again", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ok({ access_token: `tok-${fetchMock.mock.calls.length}`, expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    const t0 = 1_000_000;
    expect(await getGraphToken(creds, t0)).toBe("tok-1");
    expect(await getGraphToken(creds, t0 + 3_000_000)).toBe("tok-1"); // 50 min: cached
    expect(await getGraphToken(creds, t0 + 3_550_000)).toBe("tok-2"); // inside the last 60 s: refreshed
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://login.microsoftonline.com/t1/oauth2/v2.0/token");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("keeps separate tokens per credentials and never caches without a lifetime", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ok({ access_token: "t" }));
    vi.stubGlobal("fetch", fetchMock);
    await getGraphToken(creds, 1);
    await getGraphToken(creds, 2);
    await getGraphToken({ ...creds, tenantId: "t2" }, 3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("throws GraphTokenError with the status, as the callers' old message did", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ error: "invalid_client" }, 401)));
    await expect(getGraphToken(creds)).rejects.toThrow("Graph token 401");
    await expect(getGraphToken(creds)).rejects.toBeInstanceOf(GraphTokenError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({})));
    await expect(getGraphToken(creds)).rejects.toBeInstanceOf(GraphTokenError);
  });
});

describe("clientIp / clientKey", () => {
  const req = (headers: Record<string, string>) => new Request("http://x.test/", { headers });
  it("uses the first x-forwarded-for entry, then x-real-ip, then 'local'", () => {
    expect(clientIp(req({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(req({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(req({ "x-forwarded-for": "", "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(req({}))).toBe("local");
  });
  it("keeps rate-limit keys exactly as before", () => {
    expect(clientKey(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), "webhook")).toBe("webhook:203.0.113.9");
    expect(clientKey(req({}), "attachments")).toBe("attachments:local");
  });
});

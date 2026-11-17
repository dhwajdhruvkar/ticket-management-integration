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
  afterEach(() => vi.unstubAllEnvs());

  describe("on Vercel (forwarded headers are rewritten by the platform)", () => {
    beforeEach(() => { vi.stubEnv("VERCEL", "1"); vi.stubEnv("TRUST_PROXY_HEADERS", ""); });
    it("prefers x-vercel-forwarded-for, then x-forwarded-for, then x-real-ip, then 'local'", () => {
      expect(clientIp(req({ "x-vercel-forwarded-for": "203.0.113.5", "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.5");
      expect(clientIp(req({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" }))).toBe("203.0.113.9");
      expect(clientIp(req({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
      expect(clientIp(req({ "x-forwarded-for": "", "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
      expect(clientIp(req({}))).toBe("local");
    });
    it("accepts IPv6 and rejects malformed values instead of keying on them", () => {
      expect(clientIp(req({ "x-forwarded-for": "2001:DB8::1" }))).toBe("2001:db8::1");
      for (const bad of ["not-an-ip", "999.1.1.1", "1.2.3", "a".repeat(200), "<script>", "1.2.3.4:80"]) {
        expect(clientIp(req({ "x-forwarded-for": bad })), bad).toBe("local");
      }
      expect(clientIp(req({ "x-forwarded-for": "garbage", "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    });
    it("keeps rate-limit keys in the same shape", () => {
      expect(clientKey(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), "webhook")).toBe("webhook:203.0.113.9");
      expect(clientKey(req({}), "attachments")).toBe("attachments:local");
    });
  });

  describe("elsewhere (no trusted proxy): spoofed headers cannot choose the key", () => {
    beforeEach(() => { vi.stubEnv("VERCEL", ""); vi.stubEnv("TRUST_PROXY_HEADERS", ""); });
    it("ignores x-forwarded-for, x-real-ip and x-vercel-forwarded-for", () => {
      for (const header of ["x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for"]) {
        expect(clientIp(req({ [header]: "203.0.113.9" })), header).toBe("local");
      }
      expect(clientKey(req({ "x-forwarded-for": "1.1.1.1" }), "tickets")).toBe(clientKey(req({ "x-forwarded-for": "2.2.2.2" }), "tickets"));
    });
    it("honours the headers only when TRUST_PROXY_HEADERS=1 is set explicitly", () => {
      vi.stubEnv("TRUST_PROXY_HEADERS", "1");
      expect(clientIp(req({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    });
  });
});

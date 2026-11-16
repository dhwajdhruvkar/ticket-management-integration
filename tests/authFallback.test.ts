// Verification: how DEMO_MODE is resolved, what the credential-less fallback does,
// and which layers still deny requests when demo mode is off. Runs against the
// in-memory store with the config module re-evaluated per scenario; no source
// code or real environment is modified.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { decideApiV1Access } from "@/server/auth/apiGateway";

const require = createRequire(import.meta.url);
const { validateProductionSecurityEnv } = require("../scripts/check-production-security.cjs") as {
  validateProductionSecurityEnv: (env: Record<string, string | undefined>) => { ok: boolean; errors: string[] };
};

const ENTRA = { AUTH_MICROSOFT_ENTRA_ID_ID: "id", AUTH_MICROSOFT_ENTRA_ID_SECRET: "secret", AUTH_MICROSOFT_ENTRA_ID_ISSUER: "https://issuer.example/v2.0" };

async function configFor(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of ["DEMO_MODE", "PUBLIC_DEMO_AUTH", ...Object.keys(ENTRA)]) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v ?? "");
  return (await import("@/server/config")).config;
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock("@/server/config"); vi.doUnmock("@/auth"); });

describe("DEMO_MODE resolution (config.ts:113-114, proxy.ts:23-29 use the same rule)", () => {
  const cases: [string, Record<string, string | undefined>, boolean][] = [
    ["unset, Entra not configured  -> demo ON (dangerous default)", {}, true],
    ["unset, Entra configured      -> demo OFF", ENTRA, false],
    ["DEMO_MODE=false              -> OFF", { DEMO_MODE: "false" }, false],
    ["DEMO_MODE=false + Entra      -> OFF", { DEMO_MODE: "false", ...ENTRA }, false],
    ["DEMO_MODE=true  + Entra      -> ON (explicit value always wins)", { DEMO_MODE: "true", ...ENTRA }, true],
    ["DEMO_MODE=' true ' (trimmed) -> ON", { DEMO_MODE: " true " }, true],
    ["DEMO_MODE=TRUE (case)        -> OFF (only the exact word 'true' enables)", { DEMO_MODE: "TRUE" }, false],
    ["DEMO_MODE=1                  -> OFF", { DEMO_MODE: "1" }, false],
    ["DEMO_MODE=yes                -> OFF", { DEMO_MODE: "yes" }, false],
    ["DEMO_MODE='' (blank)         -> treated as unset -> ON w/o Entra", { DEMO_MODE: "" }, true],
    ["PUBLIC_DEMO_AUTH=true, DEMO_MODE=false -> OFF (does not enable fallback)", { DEMO_MODE: "false", PUBLIC_DEMO_AUTH: "true" }, false],
  ];
  it.each(cases)("%s", async (_label, env, expected) => {
    expect((await configFor(env)).demoMode).toBe(expected);
  });

  it("the production environment check (run by vercel-build and prestart) accepts only DEMO_MODE=false", () => {
    const secret = "k9Q2v7X1m4Z8c3B6n0L5s2W9d4F7h1J3"; // random-looking 32+ chars, test only
    const check = (demo: string | undefined) => validateProductionSecurityEnv({ DEMO_MODE: demo, AUTH_SECRET: secret });
    expect(check("false").ok).toBe(true);
    for (const bad of [undefined, "", "true", "TRUE", "0", "False", " false"]) expect(check(bad).ok, String(bad)).toBe(bad === " false" ? true : false);
  });
});

describe("edge API gateway (src/server/auth/apiGateway.ts)", () => {
  const h = (init: Record<string, string> = {}) => new Headers(init);
  const req = (over: Partial<Parameters<typeof decideApiV1Access>[0]>) =>
    decideApiV1Access({ pathname: "/api/v1/tickets", method: "GET", headers: h(), hasSession: false, demoMode: false, ...over });
  it("denies credential-less /api/v1 traffic when demo mode is off, allows session or nlk_ key, keeps health open", () => {
    expect(req({})).toMatchObject({ allowed: false, status: 401 });
    expect(req({ hasSession: true })).toEqual({ allowed: true });
    expect(req({ headers: h({ authorization: "Bearer nlk_abc" }) })).toEqual({ allowed: true });
    expect(req({ headers: h({ "x-api-key": "nlk_abc" }) })).toEqual({ allowed: true });
    expect(req({ headers: h({ authorization: "Bearer something_else" }) })).toMatchObject({ allowed: false });
    expect(req({ headers: h({ "x-actor": "user_priya" }) })).toMatchObject({ allowed: false });
    expect(req({ pathname: "/api/v1/health" })).toEqual({ allowed: true });
  });
  it("lets everything through when demo mode is on (the route layer is then the only guard)", () => {
    expect(req({ demoMode: true })).toEqual({ allowed: true });
  });
});

describe.sequential("route layer: credential-less and credentialed requests, demo OFF vs ON", () => {
  const BASE = "http://auth-fallback.test/api/v1";
  const T1 = "tenant_netlink";
  const mockAuth = vi.fn();
  let keys: string[] = [];

  async function boot(demoMode: boolean) {
    vi.resetModules();
    vi.doMock("@/auth", () => ({ auth: mockAuth }));
    vi.doMock("@/server/config", async (orig) => {
      const mod = await orig<typeof import("@/server/config")>();
      return { ...mod, config: { ...mod.config, demoMode } };
    });
    // Sequential on purpose: parallel dynamic imports raced the module mocks.
    const tickets = await import("@/app/api/v1/tickets/route");
    const metrics = await import("@/app/api/v1/metrics/route");
    const apiKeys = await import("@/app/api/v1/api-keys/route");
    const apiKeysLib = await import("@/server/auth/apiKeys");
    const store = await import("@/server/data");
    return { tickets: tickets.GET, metrics: metrics.GET, apiKeys: apiKeys.GET, createApiKey: apiKeysLib.createApiKey, getStore: store.getStore };
  }
  const get = (path: string, headers: Record<string, string> = {}) => new Request(`${BASE}${path}`, { headers });
  const sess = (id: string, role: string, email: string) => ({ user: { id, name: id, role, email, tenantId: T1 } });
  const status = async (fn: (r: Request) => Promise<Response>, path: string, headers?: Record<string, string>) => (await fn(get(path, headers))).status;

  beforeAll(() => { mockAuth.mockResolvedValue(null); });
  afterAll(async () => {
    const { getStore } = await boot(false);
    const store = await getStore();
    for (const id of keys) await store.apiKeys.remove(id);
  });

  it("demo OFF: no session / no key is denied everywhere, x-actor and x-tenant headers are ignored", async () => {
    const r = await boot(false);
    mockAuth.mockResolvedValue(null);
    expect(await status(r.tickets, "/tickets?view=all")).toBe(403);
    expect(await status(r.metrics, "/metrics")).toBe(403);
    expect(await status(r.apiKeys, "/api-keys")).toBe(403);
    expect(await status(r.tickets, "/tickets?view=all", { "x-actor": "user_priya" })).toBe(403);
    expect(await status(r.metrics, "/metrics", { "x-actor": "priya.sharma@netlink.com", "x-tenant": T1 })).toBe(403);
  });

  it("demo ON: the same credential-less requests act as a tenant administrator (documented hazard)", async () => {
    const r = await boot(true);
    mockAuth.mockResolvedValue(null);
    expect(await status(r.tickets, "/tickets?view=all")).toBe(200);
    expect(await status(r.metrics, "/metrics")).toBe(200);
    expect(await status(r.apiKeys, "/api-keys")).toBe(200); // admin-only route reachable without any credential
    // The x-actor header lets the caller choose any seeded identity, e.g. a requester or a super admin.
    const asRequester = await (await r.tickets(get("/tickets?view=all&pageSize=100", { "x-actor": "dana.lee@netlink.com" }))).json() as { data: { requesterEmail: string }[] };
    expect(asRequester.data.every((t) => t.requesterEmail.toLowerCase() === "dana.lee@netlink.com")).toBe(true);
    expect(await status(r.metrics, "/metrics", { "x-actor": "dana.lee@netlink.com" })).toBe(403);
  });

  for (const demo of [false, true]) {
    it(`demo ${demo ? "ON" : "OFF"}: role-based access for sessions, inactive users and invalid keys`, async () => {
      const r = await boot(demo);
      mockAuth.mockResolvedValue(sess("user_arjun", "agent", "arjun.mehta@netlink.com"));
      expect(await status(r.tickets, "/tickets?view=all")).toBe(200);
      expect(await status(r.metrics, "/metrics")).toBe(200);
      expect(await status(r.apiKeys, "/api-keys")).toBe(403); // agent lacks "admin"
      mockAuth.mockResolvedValue(sess("user_priya", "tenant_admin", "priya.sharma@netlink.com"));
      expect(await status(r.apiKeys, "/api-keys")).toBe(200);
      mockAuth.mockResolvedValue(sess("user_dana", "requester", "dana.lee@netlink.com"));
      expect(await status(r.metrics, "/metrics")).toBe(403);
      expect(await status(r.tickets, "/tickets?view=all")).toBe(200);
      mockAuth.mockResolvedValue(sess("user_arjun", "none", "arjun.mehta@netlink.com")); // what auth.ts:191 yields for an inactive user
      expect(await status(r.tickets, "/tickets?view=all")).toBe(403);
      mockAuth.mockResolvedValue(null);
      expect(await status(r.tickets, "/tickets?view=all", { authorization: "Bearer nlk_not_a_real_key_000000" })).toBe(401);
      // /metrics checks the role directly instead of requirePermission(), so a bad key is a plain 403 there (still denied).
      expect(await status(r.metrics, "/metrics", { "x-api-key": "nlk_not_a_real_key_000000" })).toBe(403);
    });
  }

  it("valid API keys act with their configured role only (demo OFF)", async () => {
    const r = await boot(false);
    mockAuth.mockResolvedValue(null);
    const agent = await r.createApiKey(T1, { name: "verify-agent-key", role: "agent" });
    const requester = await r.createApiKey(T1, { name: "verify-requester-key", role: "requester", requesterId: "user_dana" });
    keys = [agent.record.id, requester.record.id];
    const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
    expect(await status(r.tickets, "/tickets?view=all", bearer(agent.key))).toBe(200);
    expect(await status(r.metrics, "/metrics", bearer(agent.key))).toBe(200);
    expect(await status(r.apiKeys, "/api-keys", bearer(agent.key))).toBe(403);
    expect(await status(r.metrics, "/metrics", bearer(requester.key))).toBe(403);
    const mine = await (await r.tickets(get("/tickets?view=all&pageSize=100", bearer(requester.key)))).json() as { data: { requesterEmail: string }[] };
    expect(mine.data.every((t) => t.requesterEmail.toLowerCase() === "dana.lee@netlink.com")).toBe(true);
  });
});

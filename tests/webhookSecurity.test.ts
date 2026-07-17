import { beforeEach, describe, expect, it, vi } from "vitest";

// config reads env at import time — reset modules per test to vary secrets.

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("@/server/channels/webhookSecurity");
}

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/webhooks/generic", {
    method: "POST",
    headers,
  });
}

describe("verifyWebhookRequest", () => {
  beforeEach(() => {
    delete process.env.WEBHOOK_SECRET;
    delete process.env.DEMO_MODE;
  });

  it("accepts a correctly signed request", async () => {
    const mod = await load({ WEBHOOK_SECRET: "s3cret" });
    const body = JSON.stringify({ subject: "x" });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = mod.signWebhookPayload("s3cret", ts, body);
    const verdict = mod.verifyWebhookRequest(
      "generic",
      reqWith({ "x-webhook-timestamp": ts, "x-webhook-signature": `sha256=${sig}` }),
      body
    );
    expect(verdict.ok).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const mod = await load({ WEBHOOK_SECRET: "s3cret" });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = mod.signWebhookPayload("s3cret", ts, "original");
    const verdict = mod.verifyWebhookRequest(
      "generic",
      reqWith({ "x-webhook-timestamp": ts, "x-webhook-signature": `sha256=${sig}` }),
      "tampered"
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/mismatch/i);
  });

  it("rejects stale timestamps (replay window)", async () => {
    const mod = await load({ WEBHOOK_SECRET: "s3cret" });
    const body = "{}";
    const ts = String(Math.floor(Date.now() / 1000) - 3600);
    const sig = mod.signWebhookPayload("s3cret", ts, body);
    const verdict = mod.verifyWebhookRequest(
      "generic",
      reqWith({ "x-webhook-timestamp": ts, "x-webhook-signature": `sha256=${sig}` }),
      body
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/window/i);
  });

  it("rejects missing headers when a secret is configured", async () => {
    const mod = await load({ WEBHOOK_SECRET: "s3cret" });
    const verdict = mod.verifyWebhookRequest("generic", reqWith({}), "{}");
    expect(verdict.ok).toBe(false);
  });

  it("allows unsigned requests in demo mode when no secret is set", async () => {
    const mod = await load({ WEBHOOK_SECRET: undefined, DEMO_MODE: "true" });
    const verdict = mod.verifyWebhookRequest("generic", reqWith({}), "{}");
    expect(verdict.ok).toBe(true);
  });

  it("rejects unsigned requests in production mode when no secret is set", async () => {
    const mod = await load({ WEBHOOK_SECRET: undefined, DEMO_MODE: "false" });
    const verdict = mod.verifyWebhookRequest("generic", reqWith({}), "{}");
    expect(verdict.ok).toBe(false);
  });
});

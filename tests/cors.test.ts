import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decideApiV1Access } from "@/server/auth/apiGateway";

function request(
  method: string,
  options: {
    origin?: string;
    authorization?: string;
    apiKey?: string;
    session?: boolean;
  } = {}
) {
  const headers = new Headers();
  if (options.origin) headers.set("origin", options.origin);
  if (options.authorization) {
    headers.set("authorization", options.authorization);
  }
  if (options.apiKey) headers.set("x-api-key", options.apiKey);

  return {
    pathname: "/api/v1/tickets",
    headers,
    method,
    hasSession: options.session ?? false,
    demoMode: false,
  };
}

describe("Phase 7 server-to-server origin policy", () => {
  it.each(["GET", "POST", "PATCH"])(
    "keeps authenticated %s requests origin-independent",
    (method) => {
      const decision = decideApiV1Access(
        request(method, {
          authorization: "Bearer nlk_test-key",
        })
      );

      expect(decision).toEqual({ allowed: true });
    }
  );

  it("does not trust or reflect an arbitrary browser origin", () => {
    const decision = decideApiV1Access(
      request("GET", {
        origin: "https://untrusted.example",
        authorization: "Bearer nlk_test-key",
      })
    );

    expect(decision).toEqual({ allowed: true });
  });

  it("does not add CORS even when a legacy wildcard environment value exists", () => {
    const previous = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = "*";
    try {
      const decision = decideApiV1Access(
        request("POST", {
          origin: "https://friend.example.com",
          apiKey: "nlk_test-key",
        })
      );

      expect(decision).toEqual({ allowed: true });
    } finally {
      if (previous === undefined) delete process.env.ALLOWED_ORIGINS;
      else process.env.ALLOWED_ORIGINS = previous;
    }
  });

  it("does not let OPTIONS bypass production authentication", () => {
    const decision = decideApiV1Access(
      request("OPTIONS", {
        origin: "https://friend.example.com",
      })
    );

    expect(decision).toEqual({
      allowed: false,
      status: 401,
      body: {
        ok: false,
        error: "Authentication required (session or API key).",
      },
    });
  });

  it("preserves same-origin session access without CORS headers", () => {
    const decision = decideApiV1Access(
      request("PATCH", {
        origin: "https://support.netlink.com",
        session: true,
      })
    );

    expect(decision).toEqual({ allowed: true });
  });

  it("keeps browser CORS headers and wildcard configuration out of the network proxy", () => {
    const proxy = readFileSync(
      resolve(process.cwd(), "src/proxy.ts"),
      "utf8"
    );
    const envExample = readFileSync(
      resolve(process.cwd(), ".env.example"),
      "utf8"
    );

    expect(proxy).not.toContain("Access-Control-Allow");
    expect(proxy).not.toMatch(/(?:API_CORS_ORIGINS|ALLOWED_ORIGINS)/);
    expect(proxy).not.toMatch(/method\s*===\s*["']OPTIONS["']/);
    expect(envExample).not.toMatch(/(?:API_CORS_ORIGINS|ALLOWED_ORIGINS)/);
  });
});

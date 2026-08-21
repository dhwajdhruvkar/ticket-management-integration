import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  MAX_BODY_SIZE,
  parseBody,
  readJson,
  readTextBody,
} from "@/server/http";
import {
  logger,
  redactLogMeta,
} from "@/server/observability/logger";

interface ProductionSecurityResult {
  ok: boolean;
  errors: string[];
}

const require = createRequire(import.meta.url);
const { validateProductionSecurityEnv } = require(
  "../scripts/check-production-security.cjs"
) as {
  validateProductionSecurityEnv: (
    env: Record<string, string | undefined>
  ) => ProductionSecurityResult;
};

function request(
  body: string,
  contentLength?: string
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (contentLength !== undefined) {
    headers.set("content-length", contentLength);
  }
  return new Request("http://security.test/api", {
    method: "POST",
    headers,
    body,
  });
}

async function responseBody(response: Response) {
  return (await response.json()) as { ok: boolean; error: string };
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx|mjs)$/.test(entry)) files.push(path);
  }
  return files;
}

describe("Phase 8 production configuration", () => {
  it("accepts an explicit non-demo deployment with a strong secret", () => {
    expect(
      validateProductionSecurityEnv({
        DEMO_MODE: "false",
        AUTH_SECRET: "R7k2V9m4Q1x8C6n3B5z0L2p7W4d9F1s8H6j3K5q2",
      })
    ).toEqual({ ok: true, errors: [] });
  });

  it.each([
    [{}, "DEMO_MODE"],
    [{ DEMO_MODE: "true", AUTH_SECRET: "R7k2V9m4Q1x8C6n3B5z0L2p7W4d9F1s8" }, "DEMO_MODE"],
    [{ DEMO_MODE: "false", AUTH_SECRET: "too-short" }, "at least 32"],
    [
      {
        DEMO_MODE: "false",
        AUTH_SECRET: "replace-this-example-secret-before-production",
      },
      "placeholder",
    ],
    [{ DEMO_MODE: "false", AUTH_SECRET: "a".repeat(40) }, "diversity"],
  ] as const)("rejects unsafe production environment %#", (env, message) => {
    const result = validateProductionSecurityEnv(env);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain(message);
  });
});

describe("Phase 8 bounded request bodies", () => {
  const schema = z.object({ value: z.string() });
  const oversized = JSON.stringify({ value: "x".repeat(MAX_BODY_SIZE) });

  it("rejects an oversized chunked-style body with no Content-Length", async () => {
    const result = await parseBody(request(oversized), schema);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(413);
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      error: "Request body too large.",
    });
  });

  it("rejects an actual oversized body when Content-Length is understated", async () => {
    const result = await parseBody(request(oversized, "16"), schema);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });

  it("rejects a declared oversized body before JSON parsing", async () => {
    const result = await parseBody(
      request('{"value":"small"}', String(MAX_BODY_SIZE + 1)),
      schema
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });

  it("keeps normal JSON parsing and validation behavior", async () => {
    await expect(
      parseBody(request('{"value":"safe"}'), schema)
    ).resolves.toEqual({ value: "safe" });

    const invalid = await parseBody(request("not-json"), schema);
    expect(invalid).toBeInstanceOf(Response);
    expect((invalid as Response).status).toBe(400);
  });

  it("enforces the same stream limit for legacy JSON and raw webhooks", async () => {
    await expect(readJson(request(oversized))).resolves.toBeNull();

    const raw = await readTextBody(request(oversized));
    expect(raw).toBeInstanceOf(Response);
    expect((raw as Response).status).toBe(413);
  });
});

describe("Phase 8 sensitive logging", () => {
  it("redacts nested credentials, token-shaped strings, URLs, and errors", () => {
    const safe = redactLogMeta({
      authorization: "Bearer nlk_full-secret-value",
      nested: {
        apiKey: "provider-secret-key",
        accountKey: "azure-account-key",
        databaseUrl: "postgresql://user:password@db.example/app",
        note:
          "failed for nlk_leaked-key at https://user:pass@host/path?token=abc123",
      },
      error: new Error("Bearer jwt.secret.value AccountKey=azure-secret"),
    });
    const serialized = JSON.stringify(safe);

    expect(serialized).not.toContain("nlk_full-secret-value");
    expect(serialized).not.toContain("provider-secret-key");
    expect(serialized).not.toContain("azure-account-key");
    expect(serialized).not.toContain("user:password");
    expect(serialized).not.toContain("nlk_leaked-key");
    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain("azure-secret");
    expect(serialized).toContain("[REDACTED]");
  });

  it("prevents metadata from overriding the structured log envelope", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      logger.info("safe event", {
        level: "attacker",
        msg: "forged message",
        apiKey: "nlk_should-not-print",
      });
      const entry = JSON.parse(String(spy.mock.calls[0]?.[0])) as {
        level: string;
        msg: string;
        apiKey: string;
      };
      expect(entry.level).toBe("info");
      expect(entry.msg).toBe("safe event");
      expect(entry.apiKey).toBe("[REDACTED]");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Phase 8 repository security boundaries", () => {
  it("wires the production check into npm and Docker startup", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    const dockerfile = readFileSync(
      resolve(process.cwd(), "Dockerfile"),
      "utf8"
    );
    const authSource = readFileSync(
      resolve(process.cwd(), "src/auth.ts"),
      "utf8"
    );

    expect(packageJson.scripts["security:check"]).toContain(
      "check-production-security.cjs"
    );
    expect(packageJson.scripts.prestart).toBe("npm run environment:check");
    expect(packageJson.scripts["environment:check"]).toContain(
      "check-production-environment.cjs"
    );
    expect(dockerfile).toMatch(
      /check-production-environment\.cjs\s+&&\s+exec node server\.js/
    );
    expect(authSource).not.toContain("dev-insecure-secret");
    expect(authSource).toContain("randomBytes(32)");
  });

  it("keeps runtime server modules out of client component bundles", () => {
    const files = sourceFiles(resolve(process.cwd(), "src"));
    const offenders: string[] = [];
    const importStatement = /import[\s\S]*?from\s+["'][^"']+["'];?/g;

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/.test(source)) continue;
      for (const statement of source.match(importStatement) ?? []) {
        if (
          statement.includes('"@/server/') ||
          statement.includes("'@/server/")
        ) {
          if (!/^import\s+type\b/.test(statement)) offenders.push(file);
        }
      }
      if (/import\s*\(\s*["']@\/server\//.test(source)) offenders.push(file);
    }

    expect([...new Set(offenders)]).toEqual([]);
  });

  it("does not expose secrets through NEXT_PUBLIC variables", () => {
    const files = [
      ...sourceFiles(resolve(process.cwd(), "src")),
      resolve(process.cwd(), ".env.example"),
      resolve(process.cwd(), "next.config.mjs"),
    ];
    const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");

    expect(combined).not.toMatch(
      /NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|DATABASE|AUTH)/
    );
  });

  it("keeps direct unbounded JSON/text readers out of API routes", () => {
    const routeFiles = sourceFiles(resolve(process.cwd(), "src/app/api"));
    const offenders = routeFiles.filter((file) =>
      /await\s+(?:req|request)\.(?:json|text|arrayBuffer)\(/.test(
        readFileSync(file, "utf8")
      )
    );
    expect(offenders).toEqual([]);
  });
});

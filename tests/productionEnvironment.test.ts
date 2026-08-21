import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface ProductionEnvironmentResult {
  ok: boolean;
  errors: string[];
}

const require = createRequire(import.meta.url);
const { validateProductionEnvironmentEnv } = require(
  "../scripts/check-production-environment.cjs"
) as {
  validateProductionEnvironmentEnv: (
    env: Record<string, string | undefined>
  ) => ProductionEnvironmentResult;
};

const VALID_ENV = {
  DATA_DRIVER: "prisma",
  DATABASE_URL:
    "postgresql://app_role:S7r0ngDbCreds%21@ep-blue-haze-pooler.ap-southeast-1.aws.neon.tech/netlink?sslmode=require",
  DIRECT_URL:
    "postgresql://app_role:S7r0ngDbCreds%21@ep-blue-haze.ap-southeast-1.aws.neon.tech/netlink?sslmode=require",
  AUTH_SECRET: "R7k2V9m4Q1x8C6n3B5z0L2p7W4d9F1s8H6j3K5q2",
  DEMO_MODE: "false",
  AUTH_MICROSOFT_ENTRA_ID_ID: "123e4567-e89b-42d3-a456-426614174000",
  AUTH_MICROSOFT_ENTRA_ID_SECRET: "T8r4Q2m9V6k1N7z5B3x0",
  AUTH_MICROSOFT_ENTRA_ID_ISSUER:
    "https://login.microsoftonline.com/223e4567-e89b-42d3-a456-426614174000/v2.0",
  AZURE_STORAGE_CONNECTION_STRING:
    "DefaultEndpointsProtocol=https;AccountName=netlinksupportprod;AccountKey=UHJvZHVjdGlvblN0b3JhZ2VLZXlNYXRlcmlhbDMydGVzdA==;EndpointSuffix=core.windows.net",
} satisfies Record<string, string>;

function validate(overrides: Record<string, string | undefined> = {}) {
  return validateProductionEnvironmentEnv({ ...VALID_ENV, ...overrides });
}

function parseAssignments(source: string) {
  return new Map(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

describe("Phase 10 production environment", () => {
  it("accepts the complete production contract", () => {
    expect(validate()).toEqual({ ok: true, errors: [] });
  });

  it("allows the migration-only direct URL to be absent at app startup", () => {
    expect(validate({ DIRECT_URL: undefined })).toEqual({ ok: true, errors: [] });
  });

  it.each([
    "DATA_DRIVER",
    "DATABASE_URL",
    "AUTH_SECRET",
    "DEMO_MODE",
    "AUTH_MICROSOFT_ENTRA_ID_ID",
    "AUTH_MICROSOFT_ENTRA_ID_SECRET",
    "AUTH_MICROSOFT_ENTRA_ID_ISSUER",
    "AZURE_STORAGE_CONNECTION_STRING",
  ])("rejects a missing runtime setting: %s", (name) => {
    const result = validate({ [name]: undefined });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain(name);
  });

  it("rejects demo, memory, and local database settings", () => {
    const result = validate({
      DATA_DRIVER: "memory",
      DEMO_MODE: "true",
      DATABASE_URL: "postgresql://netlink:netlink@localhost:5432/netlink",
      DIRECT_URL: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("DATA_DRIVER");
    expect(result.errors.join(" ")).toContain("DEMO_MODE");
    expect(result.errors.join(" ")).toContain("local or development");
  });

  it("enforces pooled runtime and direct migration endpoints", () => {
    const runtimeNotPooled = validate({
      DATABASE_URL: VALID_ENV.DIRECT_URL,
      DIRECT_URL: undefined,
    });
    expect(runtimeNotPooled.errors.join(" ")).toContain("pooled Neon endpoint");

    const migrationPooled = validate({
      DIRECT_URL: VALID_ENV.DATABASE_URL,
    });
    expect(migrationPooled.errors.join(" ")).toContain("direct Neon endpoint");

    const mismatched = validate({
      DIRECT_URL:
        "postgresql://app_role:S7r0ngDbCreds%21@ep-other.ap-southeast-1.aws.neon.tech/netlink?sslmode=require",
    });
    expect(mismatched.errors.join(" ")).toContain("same Neon database");
  });

  it("never includes supplied credentials in validation errors", () => {
    const sensitiveValues = {
      AUTH_SECRET: "LeakedAuthSecretValueThatMustNeverAppear123456",
      AUTH_MICROSOFT_ENTRA_ID_SECRET: "LeakedEntraSecretValue",
      DATABASE_URL: "LeakedDatabaseUrlValue",
      AZURE_STORAGE_CONNECTION_STRING: "LeakedAzureCredentialValue",
    };
    const serialized = JSON.stringify(validate(sensitiveValues));

    for (const supplied of Object.values(sensitiveValues)) {
      expect(serialized).not.toContain(supplied);
    }
  });

  it("keeps the production example secret-free and required-only", () => {
    const source = readFileSync(
      resolve(process.cwd(), ".env.production.example"),
      "utf8"
    );
    const assignments = parseAssignments(source);

    expect([...assignments.keys()].sort()).toEqual(
      [
        "AUTH_MICROSOFT_ENTRA_ID_ID",
        "AUTH_MICROSOFT_ENTRA_ID_ISSUER",
        "AUTH_MICROSOFT_ENTRA_ID_SECRET",
        "AUTH_SECRET",
        "AZURE_STORAGE_CONNECTION_STRING",
        "DATABASE_URL",
        "DATA_DRIVER",
        "DEMO_MODE",
        "DIRECT_URL",
      ].sort()
    );
    expect(assignments.get("DATA_DRIVER")).toBe("prisma");
    expect(assignments.get("DEMO_MODE")).toBe("false");
    for (const [name, value] of assignments) {
      if (name === "DATA_DRIVER" || name === "DEMO_MODE") continue;
      expect(value, `${name} must remain a placeholder`).toMatch(/[<>]/);
    }
    expect(source).not.toMatch(/(?:GROQ|GEMINI|SENTRY|WEBHOOK|REDIS|ALLOWED_ORIGINS)=/);
  });

  it("keeps populated env files out of Git and Docker contexts", () => {
    const gitignore = readFileSync(resolve(process.cwd(), ".gitignore"), "utf8");
    const dockerignore = readFileSync(
      resolve(process.cwd(), ".dockerignore"),
      "utf8"
    );

    expect(gitignore).toContain(".env*");
    expect(gitignore).toContain("!.env.*.example");
    expect(dockerignore).toContain(".env*");
  });
});

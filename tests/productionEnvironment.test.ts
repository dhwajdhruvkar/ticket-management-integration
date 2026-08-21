import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  config,
  resolveAttachmentStorage,
  resolveAuthMode,
} from "@/server/config";
import { GET as healthRoute } from "@/app/api/v1/health/route";

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
  it("selects fail-closed runtime profiles without optional providers", () => {
    expect(resolveAuthMode(false, false)).toBe("api-key-only");
    expect(resolveAuthMode(false, true)).toBe("entra");
    expect(resolveAuthMode(true, false)).toBe("demo");
    expect(resolveAttachmentStorage(false, false)).toBe("disabled");
    expect(resolveAttachmentStorage(false, true)).toBe("azure");
    expect(resolveAttachmentStorage(true, false)).toBe("local");
  });

  it("reports the active non-sensitive production profile in health", async () => {
    const response = await healthRoute();
    const body = (await response.json()) as {
      productionProfile: {
        authentication: string;
        attachmentStorage: string;
      };
    };
    expect(body.productionProfile).toEqual({
      authentication: config.authMode,
      attachmentStorage: config.attachmentStorage,
    });
  });

  it("accepts the complete production contract", () => {
    expect(validate()).toEqual({ ok: true, errors: [] });
  });

  it("accepts an intentional API-only profile with attachments disabled", () => {
    expect(
      validate({
        AUTH_MICROSOFT_ENTRA_ID_ID: undefined,
        AUTH_MICROSOFT_ENTRA_ID_SECRET: undefined,
        AUTH_MICROSOFT_ENTRA_ID_ISSUER: undefined,
        AZURE_STORAGE_CONNECTION_STRING: undefined,
      })
    ).toEqual({ ok: true, errors: [] });
  });

  it("allows the migration-only direct URL to be absent at app startup", () => {
    expect(validate({ DIRECT_URL: undefined })).toEqual({ ok: true, errors: [] });
  });

  it.each([
    "DATA_DRIVER",
    "DATABASE_URL",
    "AUTH_SECRET",
    "DEMO_MODE",
  ])("rejects a missing runtime setting: %s", (name) => {
    const result = validate({ [name]: undefined });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain(name);
  });

  it("rejects partial Entra and malformed optional Azure configuration", () => {
    const partialEntra = validate({
      AUTH_MICROSOFT_ENTRA_ID_SECRET: undefined,
      AUTH_MICROSOFT_ENTRA_ID_ISSUER: undefined,
      AZURE_STORAGE_CONNECTION_STRING: undefined,
    });
    expect(partialEntra.ok).toBe(false);
    expect(partialEntra.errors.join(" ")).toContain(
      "AUTH_MICROSOFT_ENTRA_ID_SECRET"
    );
    expect(partialEntra.errors.join(" ")).toContain(
      "AUTH_MICROSOFT_ENTRA_ID_ISSUER"
    );

    const malformedAzure = validate({
      AZURE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
    });
    expect(malformedAzure.ok).toBe(false);
    expect(malformedAzure.errors.join(" ")).toContain(
      "AZURE_STORAGE_CONNECTION_STRING"
    );
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
        "AUTH_SECRET",
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
    expect(source).toContain("# AUTH_MICROSOFT_ENTRA_ID_ID=<application-client-id>");
    expect(source).toContain("# AUTH_MICROSOFT_ENTRA_ID_SECRET=<client-secret>");
    expect(source).toContain(
      "# AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0"
    );
    expect(source).toContain("# AZURE_STORAGE_CONNECTION_STRING=");
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

  it("keeps Docker startup and Vercel builds fail-closed", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as { scripts?: Record<string, string> };
    const dockerfile = readFileSync(
      resolve(process.cwd(), "Dockerfile"),
      "utf8"
    );

    expect(packageJson.scripts?.["vercel-build"]).toBe(
      "npm run environment:check && next build"
    );
    expect(dockerfile).toContain(
      "node scripts/check-production-environment.cjs && exec node server.js"
    );
  });
});

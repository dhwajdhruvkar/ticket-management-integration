import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Production sign-in presentation", () => {
  it("renders the credential card layout even when Production has no browser provider", () => {
    const client = source("src/app/signin/SignInClient.tsx");

    expect(client).toContain("const showCredentialPanel = demoMode || !ssoEnabled");
    expect(client).toContain("QUICK DEMO IDENTITIES");
    expect(client).toContain("Authentication preview — Microsoft Entra ID remains deferred.");
    expect(client).not.toContain("API-only deployment.");
  });

  it("does not turn the visual preview into passwordless Production authentication", () => {
    const client = source("src/app/signin/SignInClient.tsx");
    const auth = source("src/auth.ts");

    expect(client).toContain("if (!demoMode)");
    expect(client).toContain("Browser access will activate when Microsoft Entra ID is connected.");
    expect(auth).toContain("if (config.demoMode)");
    expect(auth).not.toContain("SHOWCASE_AUTH");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canUsePasswordlessCredential,
  isPublicDemoEmail,
  PUBLIC_DEMO_USERS,
} from "@/shared/publicDemoUsers";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Public demo authentication", () => {
  it("keeps the public passwordless surface to the six displayed identities", () => {
    expect(PUBLIC_DEMO_USERS).toHaveLength(6);
    expect(new Set(PUBLIC_DEMO_USERS.map((user) => user.email)).size).toBe(6);
    expect(isPublicDemoEmail("VIKRAM.RAO@NETLINK.COM")).toBe(true);
    expect(isPublicDemoEmail("dana.lee@netlink.com")).toBe(true);
    expect(isPublicDemoEmail("admin@netlink.com")).toBe(false);
    expect(isPublicDemoEmail("unknown@example.com")).toBe(false);
  });

  it("preserves local demo behavior but gates Production to the allowlist", () => {
    expect(
      canUsePasswordlessCredential("unknown@example.com", true, false)
    ).toBe(true);
    expect(
      canUsePasswordlessCredential("dana.lee@netlink.com", false, true)
    ).toBe(true);
    expect(
      canUsePasswordlessCredential("admin@netlink.com", false, true)
    ).toBe(false);
    expect(
      canUsePasswordlessCredential("dana.lee@netlink.com", false, false)
    ).toBe(false);
  });

  it("renders functional public-demo copy only when the server enables it", () => {
    const client = source("src/app/signin/SignInClient.tsx");
    const page = source("src/app/signin/page.tsx");

    expect(client).toContain("const credentialLoginEnabled = demoMode || publicDemoAuth");
    expect(client).toContain("QUICK DEMO IDENTITIES");
    expect(client).toContain("Public demo access — choose one of the six approved identities.");
    expect(client).toContain("Public demo access is limited to the six identities shown below.");
    expect(page).toContain("publicDemoAuth={config.publicDemoAuth}");
    expect(client).not.toContain("API-only deployment.");
  });

  it("enforces the allowlist and internal tenant again inside Auth.js", () => {
    const auth = source("src/auth.ts");
    const proxy = source("src/proxy.ts");

    expect(auth).toContain("if (config.demoMode || config.publicDemoAuth)");
    expect(auth).toContain("canUsePasswordlessCredential(");
    expect(auth).toContain("tenant.isInternal");
    expect(auth).toContain("internalTenantIds.has(user.tenantId)");
    expect(proxy).toContain('pathname === "/api/auth/callback/demo"');
    expect(proxy).toContain("public-demo-auth:");
    expect(proxy).toContain("30, 60_000");
  });

  it("adds tenant-qualified local accounts without removing demo or future Entra providers", () => {
    const auth = source("src/auth.ts");
    const client = source("src/app/signin/SignInClient.tsx");
    const setup = source("src/app/setup-account/SetupAccountClient.tsx");

    expect(auth).toContain('id: "organization"');
    expect(auth).toContain("authenticateOrganizationUser(");
    expect(auth).toContain("config.localAccountAuth");
    expect(auth).toContain("MicrosoftEntraID");
    expect(client).toContain('signIn("organization"');
    expect(client).toContain("Organization code");
    expect(client).toContain("QUICK DEMO IDENTITIES");
    expect(setup).toContain("window.location.hash");
    expect(setup).toContain('window.history.replaceState(null, "", window.location.pathname)');
    expect(setup).toContain('fetch("/api/account/setup"');
  });
});

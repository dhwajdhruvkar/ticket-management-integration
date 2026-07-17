import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { authConfig } from "./auth.config";
import { config } from "@/server/config";
import { getStore } from "@/server/data";

// =============================================================================
// Full (Node) auth.
//
// - Credentials provider: demo sign-in by email against seeded users (no
//   password) so the workspace is usable with zero identity infrastructure.
// - Microsoft Entra ID: real SSO, enabled automatically when AUTH_MICROSOFT_*
//   env vars are present. New SSO users are auto-provisioned as requesters in
//   the internal tenant.
// =============================================================================

const providers: NextAuthConfig["providers"] = [];

// The passwordless demo provider only exists in demo mode; production
// deployments (DEMO_MODE=false or Entra configured) sign in via SSO only.
if (config.demoMode) {
  providers.push(
    Credentials({
      id: "demo",
      name: "Demo user",
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(creds) {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        if (!email) return null;
        const store = await getStore();
        const users = await store.users.list();
        const user = users.find((u) => u.email.toLowerCase() === email && u.active);
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
      },
    })
  );
}

if (config.features.entraId) {
  providers.push(
    MicrosoftEntraID({
      clientId: config.auth.entraClientId,
      clientSecret: config.auth.entraClientSecret,
      issuer: config.auth.entraIssuer,
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: config.auth.secret ?? "dev-insecure-secret-change-me",
  providers,
  events: {
    // Login/logout land on the tamper-evident audit chain (compliance trail).
    async signIn({ user, account }) {
      try {
        const { appendAudit } = await import("@/server/audit/auditChain");
        const store = await getStore();
        const tenants = await store.tenants.list();
        const tenantId = (user as { tenantId?: string }).tenantId ?? tenants[0]?.id;
        if (tenantId) {
          await appendAudit({
            tenantId,
            actor: user.email ?? user.name ?? "unknown",
            action: "auth.signin",
            payload: { provider: account?.provider ?? "unknown" },
          });
        }
      } catch (err) {
        console.error("[auth] signin audit failed:", err);
      }
    },
    async signOut(message) {
      try {
        const { appendAudit } = await import("@/server/audit/auditChain");
        const store = await getStore();
        const tenants = await store.tenants.list();
        const token =
          "token" in message ? (message.token as { email?: string; tenantId?: string } | null) : null;
        const tenantId = token?.tenantId ?? tenants[0]?.id;
        if (tenantId) {
          await appendAudit({
            tenantId,
            actor: token?.email ?? "unknown",
            action: "auth.signout",
            payload: {},
          });
        }
      } catch (err) {
        console.error("[auth] signout audit failed:", err);
      }
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      // On sign-in, seed identity from the authorized user (base behavior).
      if (user) {
        const u = user as { id?: string; role?: string; tenantId?: string };
        token.userId = u.id;
        token.role = u.role;
        token.tenantId = u.tenantId;
        return token;
      }
      // On later requests, refresh role/tenant from the store so admin role or
      // department changes take effect without a full re-login. Runs only in
      // this Node auth instance, never the edge middleware.
      if (token.userId) {
        try {
          const store = await getStore();
          const fresh = await store.users.get(token.userId as string);
          if (fresh) {
            token.role = fresh.role;
            token.tenantId = fresh.tenantId;
          }
        } catch {
          // Keep the existing token on any refresh failure.
        }
      }
      return token;
    },
    async signIn({ user, account }) {
      // Auto-provision SSO users (Entra) the first time they sign in.
      if (account?.provider === "microsoft-entra-id" && user.email) {
        const store = await getStore();
        const tenants = await store.tenants.list();
        const tenantId = tenants[0]?.id;
        if (tenantId) {
          const existing = (await store.users.list({ tenantId })).find(
            (u) => u.email.toLowerCase() === user.email!.toLowerCase()
          );
          if (!existing) {
            const { newId, now } = await import("@/server/domain/ids");
            await store.users.create({
              id: newId("user"),
              tenantId,
              email: user.email,
              name: user.name ?? user.email,
              role: "requester",
              title: null,
              department: null,
              initials: (user.name ?? user.email).slice(0, 2).toUpperCase(),
              active: true,
              externalId: account.providerAccountId ?? null,
              createdAt: now(),
              updatedAt: now(),
            });
          }
        }
      }
      return true;
    },
  },
});

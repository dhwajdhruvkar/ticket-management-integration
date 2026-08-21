import type { NextAuthConfig } from "next-auth";

// =============================================================================
// Edge-safe auth configuration (no database imports).
//
// Shared by the network proxy and the full Node auth (src/auth.ts). Token
// callbacks only read/write the JWT so they run anywhere; the DB-backed
// Credentials provider is added in src/auth.ts.
// =============================================================================

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const u = user as { id?: string; role?: string; tenantId?: string };
        token.userId = u.id;
        token.role = u.role;
        token.tenantId = u.tenantId;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.role = token.role as string;
        session.user.tenantId = token.tenantId as string;
      }
      return session;
    },
    authorized({ auth, request }) {
      // Pages: require a session (false -> redirect to /signin).
      // API paths: always pass here; proxy.ts returns JSON 401s itself so
      // machines get a proper status code instead of an HTML redirect.
      if (request.nextUrl.pathname.startsWith("/api")) return true;
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;

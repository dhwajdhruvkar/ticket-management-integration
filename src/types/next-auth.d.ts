import type { DefaultSession } from "next-auth";

// Augment the session/user/JWT with our tenant + role claims.

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      role?: string;
      tenantId?: string;
    } & DefaultSession["user"];
  }
  interface User {
    role?: string;
    tenantId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: string;
    tenantId?: string;
  }
}

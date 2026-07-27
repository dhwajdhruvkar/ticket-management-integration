import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

// =============================================================================
// Edge middleware.
//
// Pages: every page requires a signed-in session (redirect to /signin via the
// `authorized` callback in auth.config).
//
// API (/api/v1): in production mode (DEMO_MODE=false, or Entra ID configured
// without an explicit DEMO_MODE), requests must carry a session cookie or an
// API key header — otherwise a JSON 401 is returned here. Full key validation
// happens in src/server/context.ts (Node); this gate just rejects credential-
// less traffic early. /api/v1/health stays open for probes, /api/auth is
// NextAuth's own surface, and /api/webhooks/* are guarded per-route by HMAC
// signatures (they need the raw request body, which middleware can't consume).
// =============================================================================

// Demo-mode detection mirrors src/server/config.ts (kept inline & env-only so
// the middleware stays edge-safe).
const demoModeEnv = process.env.DEMO_MODE?.trim();
const entraConfigured = !!(
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
  process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
  process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
);
const DEMO_MODE = demoModeEnv ? demoModeEnv === "true" : !entraConfigured;

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/v1")) {
    if (pathname === "/api/v1/health" || DEMO_MODE) return NextResponse.next();

    const hasSession = !!req.auth?.user;
    const bearer = req.headers.get("authorization")?.toLowerCase() ?? "";
    const hasApiKey = bearer.startsWith("bearer nlk_") || !!req.headers.get("x-api-key")?.startsWith("nlk_");
    if (!hasSession && !hasApiKey) {
      return NextResponse.json(
        { ok: false, error: "Authentication required (session or API key)." },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  // Pages (the matcher already excludes /signin, /api and static assets):
  // require a session and bounce to /signin otherwise.
  if (!req.auth?.user) {
    const signin = new URL("/signin", req.nextUrl.origin);
    signin.searchParams.set("callbackUrl", req.nextUrl.href);
    return NextResponse.redirect(signin);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // /legal is public: the sign-in screen links to it, so requiring a session
    // would bounce anyone who wants to read the terms before agreeing to them.
    "/((?!api|_next/static|_next/image|favicon\\.ico|signin|legal).*)",
    "/api/v1/:path*",
  ],
};

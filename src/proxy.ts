import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { decideApiV1Access } from "@/server/auth/apiGateway";

// =============================================================================
// Next.js network proxy.
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
// signatures (they need the raw request body, which the proxy cannot consume).
// =============================================================================

// Demo-mode detection mirrors src/server/config.ts (kept inline & env-only so
// this boundary stays free of database imports).
const demoModeEnv = process.env.DEMO_MODE?.trim();
const entraConfigured = !!(
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
  process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
  process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
);
const DEMO_MODE = demoModeEnv ? demoModeEnv === "true" : !entraConfigured;

const { auth } = NextAuth(authConfig);

// ---------------------------------------------------------------------------
// Request-boundary in-memory fixed-window rate limiter. Mirrors
// src/server/rateLimit.ts and provides a global soft cap for /api/v1.
// ---------------------------------------------------------------------------
const _edgeWindows = new Map<string, { count: number; resetAt: number }>();

function edgeRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = _edgeWindows.get(key);
  if (!existing || now > existing.resetAt) {
    _edgeWindows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count++;
  return true;
}

interface ApiGatewayRequest {
  nextUrl: { pathname: string };
  headers: Headers;
  method: string;
  auth?: { user?: unknown } | null;
}

/**
 * Apply the edge API gateway checks shared by every /api/v1 request.
 *
 * The supported external integration is server-to-server and therefore does
 * not need browser CORS headers or a special unauthenticated OPTIONS path.
 * Authentication is still fully validated in the Node request context; this
 * edge check only rejects requests that do not present any credential.
 */
function handleApiV1Request(
  req: ApiGatewayRequest,
  demoMode = DEMO_MODE
): NextResponse {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientIp = fwd || req.headers.get("x-real-ip") || "local";
  if (!edgeRateLimit(clientIp, 200, 60_000)) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please slow down." },
      { status: 429 }
    );
  }

  const decision = decideApiV1Access({
    pathname: req.nextUrl.pathname,
    method: req.method,
    headers: req.headers,
    hasSession: !!req.auth?.user,
    demoMode,
  });
  return decision.allowed
    ? NextResponse.next()
    : NextResponse.json(decision.body, { status: decision.status });
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/v1")) {
    return handleApiV1Request(req);
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

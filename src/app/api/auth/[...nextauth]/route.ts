// =============================================================================
// /api/auth/[...nextauth] — NextAuth's own route.
//
// Re-exports the GET/POST handlers from src/auth.ts, which serve sign-in,
// callback, session, CSRF, and sign-out for the Credentials (demo) and
// Microsoft Entra ID providers. Do not add app logic here.
//
// The one exception is a rate limit on sign-in POSTs: the demo provider
// authorises by email alone, so an unthrottled endpoint is an open invitation
// to enumerate accounts.
// =============================================================================

import { NextResponse } from "next/server";
import { handlers } from "@/auth";
import { clientKey, rateLimit } from "@/server/rateLimit";

export const runtime = "nodejs";

export const { GET } = handlers;

export async function POST(req: Request, ctx: { params: Promise<{ nextauth: string[] }> }) {
  const segments = (await ctx.params).nextauth ?? [];
  const isSignIn = segments[0] === "callback" || segments[0] === "signin";
  if (isSignIn && !rateLimit(clientKey(req, "auth"), 10, 60_000)) {
    return NextResponse.json(
      { ok: false, error: "Too many sign-in attempts. Try again in a minute." },
      { status: 429 }
    );
  }
  return handlers.POST(req as Parameters<typeof handlers.POST>[0]);
}

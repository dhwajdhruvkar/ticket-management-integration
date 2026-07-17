// =============================================================================
// /api/auth/[...nextauth] — NextAuth's own route.
//
// Re-exports the GET/POST handlers from src/auth.ts, which serve sign-in,
// callback, session, CSRF, and sign-out for the Credentials (demo) and
// Microsoft Entra ID providers. Do not add app logic here.
// =============================================================================

import { handlers } from "@/auth";

export const runtime = "nodejs";

export const { GET, POST } = handlers;

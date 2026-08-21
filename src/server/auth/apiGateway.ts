// Edge-safe API gateway authentication decision. This module intentionally
// contains no browser CORS policy: the supported external consumer uses an API
// key from its backend, so origins and HTTP methods do not change access.

export interface ApiGatewayInput {
  pathname: string;
  method: string;
  headers: Pick<Headers, "get">;
  hasSession: boolean;
  demoMode: boolean;
}

export type ApiGatewayDecision =
  | { allowed: true }
  | {
      allowed: false;
      status: 401;
      body: { ok: false; error: string };
    };

export function decideApiV1Access(
  input: ApiGatewayInput
): ApiGatewayDecision {
  if (input.pathname === "/api/v1/health" || input.demoMode) {
    return { allowed: true };
  }

  const bearer = input.headers.get("authorization")?.toLowerCase() ?? "";
  const hasApiKey =
    bearer.startsWith("bearer nlk_") ||
    !!input.headers.get("x-api-key")?.startsWith("nlk_");

  if (input.hasSession || hasApiKey) return { allowed: true };

  return {
    allowed: false,
    status: 401,
    body: {
      ok: false,
      error: "Authentication required (session or API key).",
    },
  };
}

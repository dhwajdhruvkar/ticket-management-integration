import { fail, ok } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { rotateApiKey } from "@/server/auth/apiKeys";
import { clientKey, rateLimit } from "@/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Replace the bearer secret in-place; the previous secret stops immediately. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!rateLimit(clientKey(req, "api-key-rotate"), 10, 60_000)) {
    return fail("Rate limit exceeded. Try again shortly.", 429);
  }
  const { id } = await params;
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  const rotated = await rotateApiKey(ctx.tenantId, id, ctx.actor.name);
  if (!rotated) return fail("API key not found.", 404);
  const { keyHash, webhookSecretSalt, ...safe } = rotated.record;
  void keyHash;
  void webhookSecretSalt;
  return ok({ ...safe, key: rotated.key });
}

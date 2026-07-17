import { NextResponse } from "next/server";
import { z } from "zod";
import { currentActor, currentTenantId } from "@/server/context";
import { fail, ok, parseBody } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { createApiKey, listApiKeys } from "@/server/auth/apiKeys";
import { clientKey, rateLimit } from "@/server/rateLimit";
import type { Role } from "@/server/domain/models";

// =============================================================================
// /api/v1/api-keys — machine-to-machine credentials (admin only).
//
// GET lists keys (hashes never leave the server; only name/prefix/role/status).
// POST creates a key and returns the full secret exactly once.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateKeySchema = z.object({
  name: z.string().trim().min(1, "name is required").max(80),
  role: z.enum(["requester", "agent", "manager", "tenant_admin"]).optional(),
  /** Optional description of the integration/application. */
  description: z.string().trim().max(300).nullish(),
  /** Agents this integration key acts on behalf of. */
  agentIds: z.array(z.string()).optional(),
  /** ISO date-time; omit for a non-expiring key. */
  expiresAt: z.string().datetime().nullish(),
});

export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);
  const keys = await listApiKeys(tenantId);
  // Never expose the hash.
  return ok(
    keys.map(({ keyHash: _hash, ...rest }) => rest)
  );
}

export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, "api-keys"), 10, 60_000)) {
    return fail("Rate limit exceeded. Try again shortly.", 429);
  }
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);

  const body = await parseBody(req, CreateKeySchema);
  if (body instanceof NextResponse) return body;

  const { record, key } = await createApiKey(
    tenantId,
    {
      name: body.name,
      role: body.role as Role | undefined,
      description: body.description ?? null,
      agentIds: body.agentIds ?? [],
      expiresAt: body.expiresAt ?? null,
      createdBy: actor.name,
    },
    actor.name
  );
  const { keyHash: _hash, ...safe } = record;
  return ok({ ...safe, key }, { status: 201 });
}

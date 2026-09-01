import { NextResponse } from "next/server";
import { z } from "zod";
import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parseBody,
  parsePagination,
} from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { createApiKey, listApiKeys } from "@/server/auth/apiKeys";
import { clientKey, rateLimit } from "@/server/rateLimit";
import type { ApiKeyRow, Role } from "@/server/domain/models";
import {
  assertWebhookSigningAvailable,
  normalizeWebhookEvents,
  normalizeWebhookUrl,
  TICKET_WEBHOOK_EVENTS,
  WebhookConfigurationError,
  webhookSigningSecret,
} from "@/server/services/integrationWebhookService";

// =============================================================================
// /api/v1/api-keys — machine-to-machine credentials (admin only).
//
// GET lists keys (hashes never leave the server; only name/prefix/role/status).
// POST creates a key and returns the full secret exactly once.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withoutKeyHash(row: ApiKeyRow): Omit<ApiKeyRow, "keyHash" | "webhookSecretSalt"> {
  const { keyHash, webhookSecretSalt, ...safe } = row;
  void keyHash;
  void webhookSecretSalt;
  return safe;
}

const CreateKeySchema = z.object({
  name: z.string().trim().min(1, "name is required").max(80),
  role: z.enum(["ticket_submitter", "requester", "agent", "manager", "tenant_admin"]).optional(),
  /** Required for requester/ticket_submitter keys; always tenant-validated. */
  requesterId: z.string().nullish(),
  /** Optional description of the integration/application. */
  description: z.string().trim().max(300).nullish(),
  /** Agents this integration key acts on behalf of. */
  agentIds: z.array(z.string()).optional(),
  /** ISO date-time; omit for a non-expiring key. */
  expiresAt: z.string().datetime().nullish(),
  webhook: z
    .object({
      url: z.string().trim().max(500),
      events: z.array(z.enum(TICKET_WEBHOOK_EVENTS)).max(TICKET_WEBHOOK_EVENTS.length).optional(),
    })
    .nullish(),
});

export async function GET(req: Request) {
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  const { tenantId } = ctx;
  const parsed = parsePagination(req, {
    defaultSortBy: "createdAt",
    defaultSortDir: "desc",
    allowedSortBy: [
      "createdAt",
      "updatedAt",
      "name",
      "active",
      "role",
    ] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  const keys = await listApiKeys(
    tenantId,
    listOptionsFromPagination<ApiKeyRow>(pagination)
  );
  // Never expose the hash.
  return paginated(
    keys.data.map(withoutKeyHash),
    keys.total,
    pagination
  );
}

export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, "api-keys"), 10, 60_000)) {
    return fail("Rate limit exceeded. Try again shortly.", 429);
  }
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  const { tenantId, actor } = ctx;

  const body = await parseBody(req, CreateKeySchema);
  if (body instanceof NextResponse) return body;
  if (body.expiresAt && new Date(body.expiresAt).getTime() <= Date.now()) {
    return fail("expiresAt must be in the future.");
  }

  try {
    const webhookUrl = normalizeWebhookUrl(body.webhook?.url);
    if (webhookUrl) assertWebhookSigningAvailable();
    const webhookEvents = webhookUrl ? normalizeWebhookEvents(body.webhook?.events) : [];
    const { record, key } = await createApiKey(
      tenantId,
      {
        name: body.name,
        role: body.role as Role | undefined,
        requesterId: body.requesterId ?? null,
        description: body.description ?? null,
        agentIds: body.agentIds ?? [],
        expiresAt: body.expiresAt ?? null,
        createdBy: actor.name,
        webhookUrl,
        webhookEvents,
      },
      actor.name
    );
    const safe = withoutKeyHash(record);
    return ok(
      {
        ...safe,
        key,
        webhookSecret: webhookUrl ? webhookSigningSecret(record) : null,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof WebhookConfigurationError) return fail(error.message, error.status);
    return fail(error instanceof Error ? error.message : "Could not create API integration.");
  }
}

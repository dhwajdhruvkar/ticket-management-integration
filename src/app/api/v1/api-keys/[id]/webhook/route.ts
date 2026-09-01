import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit } from "@/server/audit/auditChain";
import { getStore } from "@/server/data";
import { now } from "@/server/domain/ids";
import { fail, ok, parseBody } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import {
  assertWebhookSigningAvailable,
  normalizeWebhookEvents,
  normalizeWebhookUrl,
  TICKET_WEBHOOK_EVENTS,
  WebhookConfigurationError,
  webhookSigningSecret,
} from "@/server/services/integrationWebhookService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  url: z.string().trim().max(500).nullish(),
  events: z.array(z.enum(TICKET_WEBHOOK_EVENTS)).max(TICKET_WEBHOOK_EVENTS.length).optional(),
  active: z.boolean().optional(),
  rotateSecret: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  const body = await parseBody(req, Schema);
  if (body instanceof NextResponse) return body;

  const store = await getStore();
  const existing = await store.apiKeys.get(id);
  if (!existing || existing.tenantId !== ctx.tenantId) return fail("API key not found.", 404);

  try {
    const url = normalizeWebhookUrl(body.url ?? existing.webhookUrl);
    if (url) assertWebhookSigningAvailable();
    const active = body.active ?? !!url;
    if (active && !url) return fail("A webhook URL is required before callbacks can be enabled.");
    const events = url
      ? normalizeWebhookEvents(body.events ?? existing.webhookEvents)
      : [];
    const newSecret = !!url && (!existing.webhookSecretSalt || body.rotateSecret === true);
    const updated = await store.apiKeys.update(id, {
      webhookUrl: url,
      webhookEvents: events,
      webhookActive: active && !!url,
      webhookSecretSalt: url
        ? newSecret
          ? randomBytes(24).toString("base64url")
          : existing.webhookSecretSalt
        : null,
      webhookLastError: null,
      updatedAt: now(),
    });
    if (!updated) return fail("API key not found.", 404);

    if (!updated.webhookActive) {
      const pending = await store.webhookDeliveries.list({ apiKeyId: id });
      await Promise.all(pending.map((row) => store.webhookDeliveries.remove(row.id)));
    }
    await appendAudit({
      tenantId: ctx.tenantId,
      actor: ctx.actor.name,
      action: "integration.webhook_configured",
      payload: { apiKeyId: id, active: updated.webhookActive, events: updated.webhookEvents },
    });
    const { keyHash, webhookSecretSalt, ...safe } = updated;
    void keyHash;
    void webhookSecretSalt;
    return ok({
      ...safe,
      webhookSecret: newSecret ? webhookSigningSecret(updated) : null,
    });
  } catch (error) {
    if (error instanceof WebhookConfigurationError) return fail(error.message, error.status);
    throw error;
  }
}

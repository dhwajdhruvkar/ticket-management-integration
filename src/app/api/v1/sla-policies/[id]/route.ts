import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, ok, parseBody } from "@/server/http";
import { isResponse, requirePermission } from "@/server/guards";
import { getStore } from "@/server/data";
import { appendAudit } from "@/server/audit/auditChain";

// PATCH /api/v1/sla-policies/[id] — adjust targets, the business-hours flag,
// or link a business calendar. Admin only. Applies to tickets created after
// the change (existing due dates are not rewritten).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  responseMins: z.number().int().min(1).max(60 * 24 * 30).optional(),
  resolveMins: z.number().int().min(1).max(60 * 24 * 90).optional(),
  businessHoursOnly: z.boolean().optional(),
  calendarId: z.string().nullish(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;

  const body = await parseBody(req, PatchSchema);
  if (body instanceof NextResponse) return body;

  const store = await getStore();
  const existing = await store.slaPolicies.get(id);
  if (!existing || existing.tenantId !== ctx.tenantId) return fail("SLA policy not found.", 404);

  if (body.calendarId) {
    const cal = await store.calendars.get(body.calendarId);
    if (!cal || cal.tenantId !== existing.tenantId) return fail("Calendar not found.", 404);
  }

  const updated = await store.slaPolicies.update(id, { ...body, updatedAt: new Date().toISOString() });
  await appendAudit({
    tenantId: existing.tenantId,
    actor: ctx.actor.name,
    action: "sla.policy_updated",
    payload: { priority: existing.priority, ...body },
  });
  return ok(updated);
}

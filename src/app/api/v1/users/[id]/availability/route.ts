import { z } from "zod";
import { getStore } from "@/server/data";
import { isResponse, requirePermission } from "@/server/guards";
import { fail, ok, parseBody } from "@/server/http";
import { appendAudit } from "@/server/audit/auditChain";
import type { AvailabilitySettings } from "@/server/services/availabilityService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Input = z.object({ calendarId: z.string().max(100).optional(), capacity: z.number().int().min(1).max(100).optional(),
  override: z.enum(["available", "busy", "away"]).optional(), overrideUntil: z.union([z.string().datetime(), z.literal("")]).optional(), teamsUserId: z.union([z.string().uuid(), z.literal("")]).optional(),
}).strict();
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission(req, "ticket.write");
  if (isResponse(ctx)) return ctx;
  if (ctx.actor.apiKeyId) return fail("Use a staff account to update availability.", 403);
  const id = (await params).id;
  const admin = ["tenant_admin", "super_admin"].includes(ctx.role);
  if (!admin && id !== ctx.actor.id) return fail("Forbidden.", 403);
  const input = await parseBody(req, Input);
  if (isResponse(input)) return input;
  if (!admin && ["calendarId", "capacity", "teamsUserId"].some((key) => key in input)) return fail("An administrator configures working hours, capacity and Teams mapping.", 403);
  const store = await getStore();
  const user = await store.users.get(id);
  if (!user || user.tenantId !== ctx.tenantId || !["agent", "manager", "tenant_admin", "super_admin"].includes(user.role)) return fail("Staff member not found.", 404);
  if (input.calendarId) {
    const calendar = await store.calendars.get(input.calendarId);
    if (!calendar || calendar.tenantId !== ctx.tenantId) return fail("Working-hours calendar not found.", 400);
  }
  const settings: AvailabilitySettings = { capacity: 5, ...user.availabilitySettings, ...input };
  if (settings.override && settings.override !== "available" && (input.override !== undefined || input.overrideUntil !== undefined)) {
    const until = Date.parse(settings.overrideUntil ?? "");
    if (!Number.isFinite(until) || until <= Date.now() || until > Date.now() + 24 * 60 * 60_000) return fail("Busy/Away must expire within the next 24 hours.");
  }
  await store.transaction(async (tx) => {
    const fresh = await tx.users.get(id);
    if (!fresh || fresh.tenantId !== ctx.tenantId) throw new Error("Staff account changed.");
    Object.assign(settings, { capacity: 5, ...fresh.availabilitySettings, ...input });
    await tx.users.update(id, { availabilitySettings: settings, ...(input.teamsUserId !== undefined ? { presenceSnapshot: null } : {}), ...(input.override ? { available: true } : {}), updatedAt: new Date().toISOString() });
    await appendAudit({ tenantId: ctx.tenantId, actor: ctx.actor.name, action: "user.availability.updated", payload: { userId: id, fields: Object.keys(input) } }, tx);
  });
  return ok(settings);
}

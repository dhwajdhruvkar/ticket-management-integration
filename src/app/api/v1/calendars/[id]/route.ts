import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, ok, parseBody } from "@/server/http";
import { isResponse, loadOwned, requirePermission } from "@/server/guards";
import { CalendarError, deleteCalendar, updateCalendar } from "@/server/services/calendarService";

// PATCH/DELETE /api/v1/calendars/[id] — admin only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().max(64).optional(),
  workDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  startHour: z.number().int().min(0).max(23).optional(),
  endHour: z.number().int().min(1).max(24).optional(),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(400).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  const owned = await loadOwned(ctx, "calendars", id, "Calendar");
  if (isResponse(owned)) return owned;

  const body = await parseBody(req, PatchSchema);
  if (body instanceof NextResponse) return body;
  try {
    const updated = await updateCalendar(id, body, ctx.actor.name);
    return updated ? ok(updated) : fail("Calendar not found.", 404);
  } catch (err) {
    if (err instanceof CalendarError) return fail(err.message);
    throw err;
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  const owned = await loadOwned(ctx, "calendars", id, "Calendar");
  if (isResponse(owned)) return owned;

  const removed = await deleteCalendar(id, ctx.actor.name);
  return removed ? ok({ deleted: true }) : fail("Calendar not found.", 404);
}

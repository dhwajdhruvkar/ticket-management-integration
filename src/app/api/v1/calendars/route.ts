import { NextResponse } from "next/server";
import { z } from "zod";
import { currentActor, currentTenantId } from "@/server/context";
import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parseBody,
  parsePagination,
} from "@/server/http";
import { can } from "@/server/auth/rbac";
import { CalendarError, createCalendar, listCalendars } from "@/server/services/calendarService";
import type { BusinessCalendarRow, Role } from "@/server/domain/models";

// /api/v1/calendars — business-hours calendars for SLA policies.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  timezone: z.string().max(64).optional(),
  workDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  startHour: z.number().int().min(0).max(23).optional(),
  endHour: z.number().int().min(1).max(24).optional(),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(400).optional(),
});

export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "report.read")) return fail("Forbidden.", 403);
  const parsed = parsePagination(req, {
    defaultSortBy: "name",
    defaultSortDir: "asc",
    allowedSortBy: ["name", "timezone", "createdAt", "updatedAt"] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  const result = await listCalendars(
    tenantId,
    listOptionsFromPagination<BusinessCalendarRow>(pagination)
  );
  return paginated(result.data, result.total, pagination);
}

export async function POST(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);

  const body = await parseBody(req, CreateSchema);
  if (body instanceof NextResponse) return body;
  try {
    return ok(await createCalendar(tenantId, body, actor.name), { status: 201 });
  } catch (err) {
    if (err instanceof CalendarError) return fail(err.message);
    throw err;
  }
}

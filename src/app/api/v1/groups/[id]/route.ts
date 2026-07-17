import { NextResponse } from "next/server";
import { z } from "zod";
import { currentActor } from "@/server/context";
import { fail, ok, parseBody } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { updateGroup } from "@/server/services/groupService";
import type { Role, TicketCategory } from "@/server/domain/models";

// PATCH /api/v1/groups/[id] — update membership, routing categories, and the
// auto-assignment strategy. Admin only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).nullish(),
  memberIds: z.array(z.string()).max(100).optional(),
  categories: z
    .array(z.enum(["IT", "HR", "Access", "Software", "Hardware", "Network", "Billing", "Other"]))
    .optional(),
  leadId: z.string().nullish(),
  strategy: z.enum(["manual", "round_robin", "least_loaded"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);

  const body = await parseBody(req, PatchSchema);
  if (body instanceof NextResponse) return body;

  const updated = await updateGroup(id, body as Parameters<typeof updateGroup>[1], actor.name);
  return updated ? ok(updated) : fail("Group not found.", 404);
}

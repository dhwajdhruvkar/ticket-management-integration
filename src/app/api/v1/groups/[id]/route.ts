import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, ok, parseBody } from "@/server/http";
import { isResponse, loadOwned, requirePermission } from "@/server/guards";
import { updateGroup } from "@/server/services/groupService";

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
  const ctx = await requirePermission(req, "admin");
  if (isResponse(ctx)) return ctx;
  const owned = await loadOwned(ctx, "groups", id, "Group");
  if (isResponse(owned)) return owned;

  const body = await parseBody(req, PatchSchema);
  if (body instanceof NextResponse) return body;

  const updated = await updateGroup(id, body as Parameters<typeof updateGroup>[1], ctx.actor.name);
  return updated ? ok(updated) : fail("Group not found.", 404);
}

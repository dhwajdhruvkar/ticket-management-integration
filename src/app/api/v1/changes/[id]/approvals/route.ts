import { currentActor } from "@/server/context";
import { fail, ok, readJson } from "@/server/http";
import { can } from "@/server/auth/rbac";
import { decideApproval, submitForApproval } from "@/server/services/changeService";
import type { Role } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// POST /api/v1/changes/[id]/approvals — CAB approval workflow.
//
// op="submit" routes the change to the tenant's approvers (manager/admin);
// op="decide" records an approve/reject. Deciding needs change.approve.
// =============================================================================

interface Body {
  op: "submit" | "decide";
  approvers?: { id?: string; name: string }[];
  approvalId?: string;
  state?: "approved" | "rejected";
  comment?: string;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor(req);
  const body = await readJson<Body>(req);
  if (!body?.op) return fail("op is required.");

  if (body.op === "submit") {
    if (!can(actor.role as Role, "change.write")) return fail("Forbidden.", 403);
    const approvers = body.approvers?.length ? body.approvers : [{ name: "Change Manager" }];
    const view = await submitForApproval(id, approvers);
    return view ? ok(view) : fail("Change not found.", 404);
  }

  if (body.op === "decide") {
    if (!can(actor.role as Role, "change.approve")) return fail("Forbidden: approver role required.", 403);
    if (!body.approvalId || !body.state) return fail("approvalId and state are required.");
    const view = await decideApproval(body.approvalId, body.state, { name: actor.name }, body.comment);
    return view ? ok(view) : fail("Approval not found.", 404);
  }

  return fail("Unknown op.");
}

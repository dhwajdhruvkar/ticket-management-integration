import { currentActor, currentTenantId } from "@/server/context";
import {
  fail,
  listOptionsFromPagination,
  ok,
  paginated,
  parsePagination,
  readJson,
} from "@/server/http";
import { can, isAgentRole } from "@/server/auth/rbac";
import {
  createCustomField,
  listCustomFields,
  type NewCustomFieldInput,
} from "@/server/services/customFieldService";
import type { CustomFieldDefRow, Role } from "@/server/domain/models";

// =============================================================================
// /api/v1/custom-fields — tenant-defined custom ticket fields.
//
// GET lists field definitions (agents, to render them on tickets); POST creates
// a new definition (admin). Per-field edits/removal live on [id].
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!isAgentRole(actor.role as Role)) return fail("Forbidden.", 403);
  const parsed = parsePagination(req, {
    defaultSortBy: "order",
    defaultSortDir: "asc",
    allowedSortBy: [
      "order",
      "label",
      "key",
      "type",
      "createdAt",
      "updatedAt",
    ] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  const result = await listCustomFields(
    tenantId,
    listOptionsFromPagination<CustomFieldDefRow>(pagination)
  );
  return paginated(result.data, result.total, pagination);
}

export async function POST(req: Request) {
  const [tenantId, actor] = await Promise.all([currentTenantId(req), currentActor(req)]);
  if (!can(actor.role as Role, "admin")) return fail("Forbidden.", 403);
  const body = await readJson<NewCustomFieldInput>(req);
  if (!body?.label?.trim()) return fail("label is required.");
  return ok(await createCustomField(tenantId, body), { status: 201 });
}

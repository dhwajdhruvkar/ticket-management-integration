import { currentTenantId } from "@/server/context";
import {
  listOptionsFromPagination,
  paginated,
  parsePagination,
} from "@/server/http";
import { getStore } from "@/server/data";
import { pageCollection } from "@/server/data/store";
import type { CatalogItemRow } from "@/server/domain/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/catalog — active service-request catalog items for the portal
// request form (name, description, category, whether approval is required).
export async function GET(req: Request) {
  const tenantId = await currentTenantId(req);
  const parsed = parsePagination(req, {
    defaultSortBy: "name",
    defaultSortDir: "asc",
    allowedSortBy: [
      "name",
      "category",
      "requiresApproval",
      "createdAt",
      "updatedAt",
    ] as const,
  });
  if (!parsed.ok) return parsed.response;
  const pagination = parsed.value;
  const store = await getStore();
  const result = await pageCollection(
    store.catalogItems,
    { tenantId, active: true },
    listOptionsFromPagination<CatalogItemRow>(pagination)
  );
  return paginated(result.data, result.total, pagination);
}

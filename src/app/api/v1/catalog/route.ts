import { currentTenantId } from "@/server/context";
import { ok } from "@/server/http";
import { getStore } from "@/server/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/catalog — active service-request catalog items for the portal
// request form (name, description, category, whether approval is required).
export async function GET(req: Request) {
  const tenantId = await currentTenantId(req);
  const store = await getStore();
  const items = (await store.catalogItems.list({ tenantId, active: true })).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  return ok(items);
}

// =============================================================================
// Asset Management (ITAM) + CMDB.
//
// Tracks assets and configuration items (CIs) with a dependency graph
// (CI -> depends on -> CI). Impact analysis walks dependents and surfaces the
// tickets/changes touching a CI.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { newId, now } from "../domain/ids";
import type {
  AssetRow,
  AssetStatus,
  CIRelationshipRow,
  CIRow,
  CIType,
} from "../domain/models";

export async function listAssets(tenantId: string): Promise<AssetRow[]> {
  const store = await getStore();
  return (await store.assets.list({ tenantId })).sort((a, b) => a.tag.localeCompare(b.tag));
}

export async function createAsset(
  tenantId: string,
  input: { tag: string; name: string; type: string; status?: AssetStatus; owner?: string }
): Promise<AssetRow> {
  const store = await getStore();
  const asset: AssetRow = {
    id: newId("ast"),
    tenantId,
    tag: input.tag.trim(),
    name: input.name.trim(),
    type: input.type,
    status: input.status ?? "in_stock",
    owner: input.owner ?? null,
    purchasedAt: null,
    warrantyEnd: null,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.assets.create(asset);
  await appendAudit({ tenantId, actor: "system", action: "asset.created", payload: { tag: asset.tag } });
  return asset;
}

export async function listCIs(tenantId: string): Promise<CIRow[]> {
  const store = await getStore();
  return (await store.cis.list({ tenantId })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createCI(
  tenantId: string,
  input: { name: string; type?: CIType; assetId?: string; status?: string }
): Promise<CIRow> {
  const store = await getStore();
  const ci: CIRow = {
    id: newId("ci"),
    tenantId,
    name: input.name.trim(),
    type: input.type ?? "other",
    status: input.status ?? "operational",
    assetId: input.assetId ?? null,
    attributes: null,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.cis.create(ci);
  await appendAudit({ tenantId, actor: "system", action: "ci.created", payload: { name: ci.name, type: ci.type } });
  return ci;
}

export async function linkCIs(sourceId: string, targetId: string, kind = "depends_on"): Promise<CIRelationshipRow | null> {
  const store = await getStore();
  const src = await store.cis.get(sourceId);
  const tgt = await store.cis.get(targetId);
  if (!src || !tgt) return null;
  const rel: CIRelationshipRow = { id: newId("rel"), sourceId, targetId, kind };
  await store.ciRelationships.create(rel);
  await appendAudit({ tenantId: src.tenantId, actor: "system", action: "ci.linked", payload: { sourceId, targetId, kind } });
  return rel;
}

export interface ImpactAnalysis {
  ci: CIRow;
  dependents: CIRow[];
  affectedTickets: { id: string; reference: string; subject: string; status: string }[];
}

/** What breaks if this CI goes down: dependents + open tickets referencing it. */
export async function impactOf(ciId: string): Promise<ImpactAnalysis | null> {
  const store = await getStore();
  const ci = await store.cis.get(ciId);
  if (!ci) return null;

  // Walk the dependency graph (CIs that depend on this one), breadth-first.
  const rels = await store.ciRelationships.list();
  const dependents: CIRow[] = [];
  const seen = new Set<string>([ciId]);
  let frontier = [ciId];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const r of rels.filter((x) => x.targetId === id)) {
        if (!seen.has(r.sourceId)) {
          seen.add(r.sourceId);
          const dep = await store.cis.get(r.sourceId);
          if (dep) {
            dependents.push(dep);
            next.push(dep.id);
          }
        }
      }
    }
    frontier = next;
  }

  // Explicit CMDB links first; fall back to a subject-name match for tickets
  // raised before CI linking existed.
  const tickets = (await store.tickets.list({ tenantId: ci.tenantId })).filter(
    (t) => (t.ciIds ?? []).includes(ci.id) || t.subject.toLowerCase().includes(ci.name.toLowerCase())
  );

  return {
    ci,
    dependents,
    affectedTickets: tickets.map((t) => ({ id: t.id, reference: t.reference, subject: t.subject, status: t.status })),
  };
}

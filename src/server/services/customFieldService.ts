// =============================================================================
// Custom field definitions.
//
// Per-tenant extra ticket fields. Definitions live here; values are stored in
// TicketRow.customFields keyed by the definition's stable `key`. Admin-managed
// CRUD over the DataStore port.
// =============================================================================

import { getStore } from "../data";
import { pageCollection, type ListOptions, type PageResult } from "../data/store";
import { newId, now } from "../domain/ids";
import type { CustomFieldDefRow, CustomFieldType } from "../domain/models";

const FIELD_TYPES: CustomFieldType[] = ["text", "number", "select", "date", "checkbox"];

export interface NewCustomFieldInput {
  label: string;
  description?: string | null;
  type?: CustomFieldType;
  options?: string[];
  required?: boolean;
  order?: number;
}

/** Empty strings from the admin form mean "no help text", not an empty hint. */
function cleanDescription(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Slugify a label into a stable key, deduped against existing keys. */
function deriveKey(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field";
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  return key;
}

export async function listCustomFields(
  tenantId: string,
  options: ListOptions<CustomFieldDefRow> = { orderBy: { field: "order", dir: "asc" } }
): Promise<PageResult<CustomFieldDefRow>> {
  const store = await getStore();
  return pageCollection(store.customFieldDefs, { tenantId }, options);
}

export async function createCustomField(
  tenantId: string,
  input: NewCustomFieldInput
): Promise<CustomFieldDefRow> {
  const store = await getStore();
  const existing = await store.customFieldDefs.list({ tenantId });
  const type: CustomFieldType = FIELD_TYPES.includes(input.type as CustomFieldType)
    ? (input.type as CustomFieldType)
    : "text";
  const def: CustomFieldDefRow = {
    id: newId("cfd"),
    tenantId,
    key: deriveKey(input.label, new Set(existing.map((f) => f.key))),
    label: input.label.trim(),
    description: cleanDescription(input.description),
    type,
    options: type === "select" ? (input.options ?? []).map((o) => o.trim()).filter(Boolean) : [],
    required: !!input.required,
    order: input.order ?? existing.length,
    createdAt: now(),
    updatedAt: now(),
  };
  return store.customFieldDefs.create(def);
}

export async function updateCustomField(
  id: string,
  patch: Partial<NewCustomFieldInput>
): Promise<CustomFieldDefRow | null> {
  const store = await getStore();
  const next: Partial<CustomFieldDefRow> = { updatedAt: now() };
  if (patch.label !== undefined) next.label = patch.label.trim();
  if (patch.description !== undefined) next.description = cleanDescription(patch.description);
  if (patch.type !== undefined && FIELD_TYPES.includes(patch.type)) next.type = patch.type;
  if (patch.options !== undefined) next.options = patch.options.map((o) => o.trim()).filter(Boolean);
  if (patch.required !== undefined) next.required = !!patch.required;
  if (patch.order !== undefined) next.order = patch.order;
  return store.customFieldDefs.update(id, next);
}

export async function deleteCustomField(id: string): Promise<boolean> {
  const store = await getStore();
  return store.customFieldDefs.remove(id);
}

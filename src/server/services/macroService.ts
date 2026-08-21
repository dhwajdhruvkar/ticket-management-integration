// =============================================================================
// Macros / canned responses.
//
// Reusable reply snippets agents insert into the composer. Tenant-scoped CRUD
// over the DataStore port. Placeholder substitution ({{requester_name}},
// {{reference}}) happens at insert time in the composer, which has ticket
// context; the stored body keeps the raw template.
// =============================================================================

import { getStore } from "../data";
import { pageCollection, type ListOptions, type PageResult } from "../data/store";
import { newId, now } from "../domain/ids";
import type { MacroRow, MessageVisibility } from "../domain/models";

export interface NewMacroInput {
  name: string;
  body: string;
  visibility?: MessageVisibility;
  category?: string | null;
}

export async function listMacros(
  tenantId: string,
  options: ListOptions<MacroRow> = { orderBy: { field: "name", dir: "asc" } }
): Promise<PageResult<MacroRow>> {
  const store = await getStore();
  return pageCollection(store.macros, { tenantId }, options);
}

export async function createMacro(tenantId: string, input: NewMacroInput): Promise<MacroRow> {
  const store = await getStore();
  const macro: MacroRow = {
    id: newId("macro"),
    tenantId,
    name: input.name.trim(),
    body: input.body,
    visibility: input.visibility === "internal" ? "internal" : "public",
    category: input.category?.trim() || null,
    createdAt: now(),
    updatedAt: now(),
  };
  return store.macros.create(macro);
}

export async function updateMacro(
  id: string,
  patch: Partial<NewMacroInput>
): Promise<MacroRow | null> {
  const store = await getStore();
  const next: Partial<MacroRow> = { updatedAt: now() };
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.body !== undefined) next.body = patch.body;
  if (patch.visibility !== undefined) next.visibility = patch.visibility === "internal" ? "internal" : "public";
  if (patch.category !== undefined) next.category = patch.category?.trim() || null;
  return store.macros.update(id, next);
}

export async function deleteMacro(id: string): Promise<boolean> {
  const store = await getStore();
  return store.macros.remove(id);
}

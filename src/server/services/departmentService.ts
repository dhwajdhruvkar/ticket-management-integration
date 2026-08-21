// =============================================================================
// Department management service (admin).
//
// Departments are first-class within an organization (tenant). Users link by
// departmentId; the denormalized user.department label is kept in sync on
// rename and cleared on delete. Every change lands on the audit chain.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { pageCollection, type ListOptions, type PageResult } from "../data/store";
import { newId, now } from "../domain/ids";
import type { DepartmentRow } from "../domain/models";

export class DepartmentServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "DepartmentServiceError";
  }
}

export async function listDepartments(
  tenantId: string,
  options: ListOptions<DepartmentRow> = { orderBy: { field: "name", dir: "asc" } }
): Promise<PageResult<DepartmentRow>> {
  const store = await getStore();
  return pageCollection(store.departments, { tenantId }, options);
}

export async function createDepartment(
  tenantId: string,
  input: { name: string; description?: string | null },
  actor = "system"
): Promise<DepartmentRow> {
  const name = input.name?.trim();
  if (!name) throw new DepartmentServiceError("Name is required.");
  const store = await getStore();
  const dup = (await store.departments.list({ tenantId })).find(
    (d) => d.name.toLowerCase() === name.toLowerCase()
  );
  if (dup) throw new DepartmentServiceError("A department with that name already exists.", 409);

  const dept: DepartmentRow = {
    id: newId("dept"),
    tenantId,
    name,
    description: input.description?.trim() || null,
    createdAt: now(),
    updatedAt: now(),
  };
  await store.departments.create(dept);
  await appendAudit({ tenantId, actor, action: "department.created", payload: { name } });
  return dept;
}

export async function updateDepartment(
  tenantId: string,
  id: string,
  input: { name?: string; description?: string | null },
  actor = "system"
): Promise<DepartmentRow> {
  const store = await getStore();
  const before = await store.departments.get(id);
  if (!before || before.tenantId !== tenantId) {
    throw new DepartmentServiceError("Department not found.", 404);
  }

  const patch: Partial<DepartmentRow> = { updatedAt: now() };
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) throw new DepartmentServiceError("Name cannot be empty.");
    const dup = (await store.departments.list({ tenantId })).find(
      (d) => d.id !== id && d.name.toLowerCase() === n.toLowerCase()
    );
    if (dup) throw new DepartmentServiceError("A department with that name already exists.", 409);
    patch.name = n;
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;

  const updated = await store.departments.update(id, patch);
  if (!updated) throw new DepartmentServiceError("Department not found.", 404);

  // Keep the denormalized user.department label in sync on rename.
  if (patch.name && patch.name !== before.name) {
    const members = await store.users.list({ tenantId, departmentId: id });
    for (const u of members) {
      await store.users.update(u.id, { department: patch.name, updatedAt: now() });
    }
  }
  await appendAudit({ tenantId, actor, action: "department.updated", payload: { name: updated.name } });
  return updated;
}

export async function deleteDepartment(
  tenantId: string,
  id: string,
  actor = "system"
): Promise<boolean> {
  const store = await getStore();
  const dept = await store.departments.get(id);
  if (!dept || dept.tenantId !== tenantId) return false;

  // Detach members so no user points at a missing department.
  const members = await store.users.list({ tenantId, departmentId: id });
  for (const u of members) {
    await store.users.update(u.id, { departmentId: null, department: null, updatedAt: now() });
  }
  const removed = await store.departments.remove(id);
  if (removed) {
    await appendAudit({
      tenantId,
      actor,
      action: "department.deleted",
      payload: { name: dept.name, detached: members.length },
    });
  }
  return removed;
}

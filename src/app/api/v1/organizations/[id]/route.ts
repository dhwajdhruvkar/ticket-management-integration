import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fail, ok, parseBody } from '@/server/http';
import { actorContext } from '@/server/guards';
import {
  deleteOrganization,
  OrganizationServiceError,
  updateOrganization,
} from '@/server/services/organizationService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchOrganizationSchema = z
  .object({
    name: z.string().trim().min(1, 'name cannot be empty').max(120).optional(),
    brand: z.string().trim().max(120).nullish(),
    isInternal: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one organization field is required.',
  });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await actorContext(req);
  if (ctx.role !== 'super_admin') {
    return fail('Only a super admin can edit organizations.', 403);
  }

  const body = await parseBody(req, PatchOrganizationSchema);
  if (body instanceof NextResponse) return body;
  try {
    return ok(await updateOrganization(id, body, ctx.actor.name));
  } catch (error) {
    if (error instanceof OrganizationServiceError) return fail(error.message, error.status);
    throw error;
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await actorContext(req);
  if (ctx.role !== 'super_admin') {
    return fail('Only a super admin can discard organizations.', 403);
  }

  try {
    const removed = await deleteOrganization(id, ctx.tenantId, ctx.actor.name);
    return removed ? ok({ deleted: true }) : fail('Organization not found.', 404);
  } catch (error) {
    if (error instanceof OrganizationServiceError) return fail(error.message, error.status);
    throw error;
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
import { GET, POST } from '@/app/api/v1/organizations/route';
import {
  DELETE as DELETE_ORGANIZATION,
  PATCH as PATCH_ORGANIZATION,
} from '@/app/api/v1/organizations/[id]/route';
import { getStore } from '@/server/data';

const TENANT_ID = 'tenant_netlink';
const SUPER_ADMIN = 'vikram.rao@netlink.com';
const TENANT_ADMIN = 'priya.sharma@netlink.com';
const createdIds = new Set<string>();

type Envelope<T> = { ok: boolean; data: T; error?: string };

function request(
  pathName: string,
  options: { method?: string; actor?: string; body?: unknown } = {}
): Request {
  return new Request(`http://organizations.test/api/v1${pathName}`, {
    method: options.method ?? 'GET',
    headers: {
      'x-actor': options.actor ?? SUPER_ADMIN,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function organizationBody(
  name: string,
  overrides: { brand?: string; isInternal?: boolean } = {}
) {
  return {
    name,
    ...overrides,
    admin: { name: 'Initial Admin', email: 'shared-admin@example.com' },
  };
}

beforeAll(async () => {
  const file = path.join(process.cwd(), '.data-test', 'store.json');
  fs.rmSync(file, { force: true });
  await getStore();
});

afterEach(async () => {
  const store = await getStore();
  for (const id of createdIds) await store.tenants.remove(id);
  createdIds.clear();
});

describe('organization tenant management', () => {
  it('lets a super admin create, list, edit, and discard an empty organization', async () => {
    const createdResponse = await POST(
      request('/organizations', {
        method: 'POST',
        body: organizationBody('Acme Support', { brand: 'Acme Service Desk', isInternal: false }),
      })
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as Envelope<{
      organization: {
        id: string;
        name: string;
        brand: string;
        slug: string;
        isInternal: boolean;
      };
      admin: { email: string; accessStatus: string; passwordHash?: string };
      invitation: { setupUrl: string; expiresAt: string };
    }>;
    createdIds.add(created.data.organization.id);
    expect(created.data.organization).toMatchObject({
      name: 'Acme Support',
      brand: 'Acme Service Desk',
      slug: 'acme-support',
      isInternal: false,
    });
    expect(created.data.admin).toMatchObject({ email: 'shared-admin@example.com', accessStatus: 'invited' });
    expect(created.data.admin).not.toHaveProperty('passwordHash');
    expect(created.data.invitation.setupUrl).toContain('/setup-account#token=');

    const listedResponse = await GET(request('/organizations?page=1&pageSize=100'));
    const listed = (await listedResponse.json()) as Envelope<Array<{ id: string }>>;
    expect(listedResponse.status).toBe(200);
    expect(listed.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.data.organization.id, onboardingStatus: 'pending' })]));

    const updatedResponse = await PATCH_ORGANIZATION(
      request(`/organizations/${created.data.organization.id}`, {
        method: 'PATCH',
        body: { name: 'Acme Enterprise', brand: '', isInternal: false },
      }),
      params(created.data.organization.id)
    );
    expect(updatedResponse.status).toBe(200);
    await expect(updatedResponse.json()).resolves.toMatchObject({
      ok: true,
      data: { name: 'Acme Enterprise', brand: 'Acme Enterprise', slug: 'acme-support' },
    });

    const deletedResponse = await DELETE_ORGANIZATION(
      request(`/organizations/${created.data.organization.id}`, { method: 'DELETE' }),
      params(created.data.organization.id)
    );
    expect(deletedResponse.status).toBe(200);
    await expect(deletedResponse.json()).resolves.toMatchObject({ ok: true, data: { deleted: true } });
    expect(await (await getStore()).tenants.get(created.data.organization.id)).toBeNull();

    const audit = await (await getStore()).audit.list({ tenantId: TENANT_ID });
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'organization.deleted',
          payload: expect.objectContaining({ organizationId: created.data.organization.id, name: 'Acme Enterprise' }),
        }),
      ])
    );
  });

  it('rejects duplicate names and tenant-admin lifecycle changes', async () => {
    const firstResponse = await POST(
      request('/organizations', { method: 'POST', body: organizationBody('Unique Tenant') })
    );
    const first = (await firstResponse.json()) as Envelope<{ organization: { id: string } }>;
    createdIds.add(first.data.organization.id);

    const duplicate = await POST(
      request('/organizations', { method: 'POST', body: organizationBody(' unique tenant ') })
    );
    expect(duplicate.status).toBe(409);

    const forbiddenCreate = await POST(
      request('/organizations', {
        method: 'POST',
        actor: TENANT_ADMIN,
        body: organizationBody('Not Allowed'),
      })
    );
    expect(forbiddenCreate.status).toBe(403);

    const forbiddenEdit = await PATCH_ORGANIZATION(
      request(`/organizations/${first.data.organization.id}`, {
        method: 'PATCH',
        actor: TENANT_ADMIN,
        body: { name: 'Not Allowed Either' },
      }),
      params(first.data.organization.id)
    );
    expect(forbiddenEdit.status).toBe(403);

    const forbiddenDelete = await DELETE_ORGANIZATION(
      request(`/organizations/${first.data.organization.id}`, { method: 'DELETE', actor: TENANT_ADMIN }),
      params(first.data.organization.id)
    );
    expect(forbiddenDelete.status).toBe(403);
  });

  it('protects the current tenant, internal tenants, and organizations containing data', async () => {
    const currentTenant = await DELETE_ORGANIZATION(
      request(`/organizations/${TENANT_ID}`, { method: 'DELETE' }),
      params(TENANT_ID)
    );
    expect(currentTenant.status).toBe(409);

    const internalResponse = await POST(
      request('/organizations', {
        method: 'POST',
        body: organizationBody('Protected Internal', { isInternal: true }),
      })
    );
    const internal = (await internalResponse.json()) as Envelope<{ organization: { id: string } }>;
    createdIds.add(internal.data.organization.id);
    const internalDelete = await DELETE_ORGANIZATION(
      request(`/organizations/${internal.data.organization.id}`, { method: 'DELETE' }),
      params(internal.data.organization.id)
    );
    expect(internalDelete.status).toBe(409);

    const usedResponse = await POST(
      request('/organizations', { method: 'POST', body: organizationBody('Tenant With Data') })
    );
    const used = (await usedResponse.json()) as Envelope<{ organization: { id: string } }>;
    createdIds.add(used.data.organization.id);
    const timestamp = new Date().toISOString();
    await (await getStore()).departments.create({
      id: 'dept_organization_guard',
      tenantId: used.data.organization.id,
      name: 'Operations',
      description: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const usedDelete = await DELETE_ORGANIZATION(
      request(`/organizations/${used.data.organization.id}`, { method: 'DELETE' }),
      params(used.data.organization.id)
    );
    expect(usedDelete.status).toBe(409);
    await expect(usedDelete.json()).resolves.toMatchObject({
      ok: false,
      error: 'This organization contains users, tickets, or settings and cannot be discarded.',
    });
  });
});

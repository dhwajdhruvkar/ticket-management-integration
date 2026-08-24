import { afterEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));

import { GET as listUsers, POST as createUser } from "@/app/api/v1/users/route";
import { PATCH as updateUserRoute } from "@/app/api/v1/users/[id]/route";
import { GET as listDepartments } from "@/app/api/v1/departments/route";
import { GET as getTicket } from "@/app/api/v1/tickets/[id]/route";
import { getStore } from "@/server/data";
import { provisionOrganization } from "@/server/services/organizationService";
import { intakeTicket } from "@/server/services/intake";

const createdTenantIds = new Set<string>();

function request(path: string, method = "GET", body?: unknown): Request {
  return new Request("http://tenant-isolation.test/api/v1" + path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function tenant(name: string, email: string) {
  const result = await provisionOrganization(
    { name, admin: { name: name + " Admin", email } },
    "Platform Admin",
    "https://tenant-isolation.test"
  );
  createdTenantIds.add(result.organization.id);
  return result;
}

afterEach(async () => {
  authMock.mockReset();
  const store = await getStore();
  for (const id of createdTenantIds) await store.tenants.remove(id);
  createdTenantIds.clear();
});

describe("Phase 15 tenant session isolation", () => {
  it("rejects cross-tenant organization parameters and guessed user/ticket ids", async () => {
    const alpha = await tenant("Isolation Alpha", "admin@isolation-alpha.test");
    const beta = await tenant("Isolation Beta", "admin@isolation-beta.test");
    const betaTicket = await intakeTicket(beta.organization.id, {
      subject: "Beta private ticket",
      body: "Must never be visible from Alpha.",
      requesterEmail: beta.admin.email,
      category: "Other",
      impact: "low",
      urgency: "low",
      priority: "low",
      channel: "portal",
    });

    authMock.mockResolvedValue({
      user: {
        id: alpha.admin.id,
        name: alpha.admin.name,
        email: alpha.admin.email,
        role: "tenant_admin",
        tenantId: alpha.organization.id,
      },
    });

    expect(
      (await listUsers(request("/users?organizationId=" + beta.organization.id))).status
    ).toBe(403);
    expect(
      (await listDepartments(request("/departments?organizationId=" + beta.organization.id))).status
    ).toBe(403);
    expect(
      (
        await createUser(
          request("/users", "POST", {
            name: "Cross Tenant User",
            email: "cross-tenant@example.com",
            role: "agent",
            organizationId: beta.organization.id,
          })
        )
      ).status
    ).toBe(403);
    expect(
      (
        await updateUserRoute(
          request("/users/" + beta.admin.id, "PATCH", { name: "Guessed" }),
          params(beta.admin.id)
        )
      ).status
    ).toBe(404);
    expect(
      (await getTicket(request("/tickets/" + betaTicket.id), params(betaTicket.id))).status
    ).toBe(404);

    const ownUsers = await listUsers(request("/users?pageSize=100"));
    const ownBody = (await ownUsers.json()) as { data: Array<{ id: string; tenantId: string }> };
    expect(ownBody.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: alpha.admin.id })]));
    expect(ownBody.data.some((user) => user.tenantId === beta.organization.id)).toBe(false);
  });

  it("allows only a platform super-admin to select another organization", async () => {
    const beta = await tenant("Isolation Super Selection", "selected-admin@example.com");
    const store = await getStore();
    const platformAdmin = (await store.users.list()).find((user) => user.role === "super_admin");
    expect(platformAdmin).toBeDefined();
    authMock.mockResolvedValue({
      user: {
        id: platformAdmin!.id,
        name: platformAdmin!.name,
        email: platformAdmin!.email,
        role: "super_admin",
        tenantId: platformAdmin!.tenantId,
      },
    });

    const response = await listUsers(
      request("/users?organizationId=" + beta.organization.id + "&pageSize=100")
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ tenantId: string; passwordHash?: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].tenantId).toBe(beta.organization.id);
    expect(body.data[0]).not.toHaveProperty("passwordHash");
  });
});

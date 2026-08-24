import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { GET as getOpenApi } from "@/app/api/v1/openapi.json/route";
import { GET as listApiKeys } from "@/app/api/v1/api-keys/route";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  return value as JsonObject;
}

function openApiRequest(
  headers: HeadersInit = { "x-actor": "dana.lee@netlink.com" }
): Request {
  return new Request("http://phase14.test/api/v1/openapi.json", { headers });
}

function operation(
  paths: JsonObject,
  route: string,
  method: string
): JsonObject {
  return object(object(paths[route])[method]);
}

describe("Phase 14 OpenAPI and external documentation contract", () => {
  it("publishes an OpenAPI 3.1 production contract for the verified integration surface", async () => {
    const response = await getOpenApi(openApiRequest());
    expect(response.status).toBe(200);

    const spec = object(await response.json());
    expect(spec.openapi).toBe("3.1.0");
    expect(object(spec.info).version).toBe("2.1.0");

    const servers = spec.servers as Array<JsonObject>;
    expect(servers[0]).toMatchObject({
      url: "https://netlink-support.vercel.app/api/v1",
      description: "Production",
    });
    expect(object(spec.externalDocs).url).toContain(
      "docs/EXTERNAL_API_GUIDE.md"
    );

    const components = object(spec.components);
    const securitySchemes = object(components.securitySchemes);
    expect(securitySchemes).toHaveProperty("bearerApiKey");
    expect(securitySchemes).toHaveProperty("headerApiKey");
    expect(securitySchemes).toHaveProperty("sessionCookie");

    const schemas = object(components.schemas);
    for (const name of [
      "ErrorResponse",
      "HealthResponse",
      "Ticket",
      "TicketView",
      "TicketMessage",
      "CreateTicketRequest",
      "UpdateTicketRequest",
      "AddMessageRequest",
      "ApiKey",
      "CreatedApiKey",
      "AccessLink",
      "UserAccessView",
      "CreateOrganizationRequest",
      "CreateUserInvitationRequest",
      "SetupAccountRequest",
      "ChangePasswordRequest",
      "PageMeta",
    ]) {
      expect(schemas).toHaveProperty(name);
    }

    const healthProperties = object(object(schemas.HealthResponse).properties);
    const profileProperties = object(
      object(healthProperties.productionProfile).properties
    );
    expect(
      object(profileProperties.authentication).enum as Array<string>
    ).toContain("public-demo");
    expect(
      object(profileProperties.authentication).enum as Array<string>
    ).toContain("public-demo+organization");

    const apiKeySchema = object(schemas.ApiKey);
    expect(object(apiKeySchema.properties)).not.toHaveProperty("keyHash");

    const paths = object(spec.paths);
    expect(paths).toHaveProperty("/openapi.json");
    expect(paths).toHaveProperty("/health");
    expect(paths).toHaveProperty("/tickets");
    expect(paths).toHaveProperty("/tickets/{id}");
    expect(paths).toHaveProperty("/tickets/{id}/messages");
    expect(paths).toHaveProperty("/api-keys");
    expect(paths).toHaveProperty("/api-keys/{id}");
    expect(paths).toHaveProperty("/organizations");
    expect(paths).toHaveProperty("/users");
    expect(paths).toHaveProperty("/users/{id}/access-link");
    expect(paths).toHaveProperty("/account/setup");
    expect(paths).toHaveProperty("/account/password");

    expect(operation(paths, "/health", "get").security).toEqual([]);
    expect(operation(paths, "/tickets", "post")["x-required-permission"]).toBe(
      "ticket.create"
    );
    expect(
      operation(paths, "/tickets/{id}", "patch")["x-required-permission"]
    ).toBe("ticket.write");
    expect(
      operation(paths, "/tickets/{id}", "delete")["x-required-permission"]
    ).toBe("ticket.delete");
    expect(
      operation(paths, "/api-keys", "post")["x-required-permission"]
    ).toBe("admin");
    expect(operation(paths, "/account/setup", "post").security).toEqual([]);
  });

  it("documents pagination, messages, and the 401/403 error boundary precisely", async () => {
    const spec = object(await (await getOpenApi(openApiRequest())).json());
    const paths = object(spec.paths);

    const listTickets = operation(paths, "/tickets", "get");
    const parameters = listTickets.parameters as Array<JsonObject>;
    expect(parameters.find((parameter) => parameter.name === "page")).toMatchObject({
      schema: { type: "integer", minimum: 1, default: 1 },
    });
    expect(
      parameters.find((parameter) => parameter.name === "pageSize")
    ).toMatchObject({
      schema: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        default: 50,
      },
    });
    expect(parameters.find((parameter) => parameter.name === "limit")).toMatchObject({
      deprecated: true,
    });

    for (const [route, method] of [
      ["/tickets", "get"],
      ["/tickets", "post"],
      ["/tickets/{id}", "get"],
      ["/tickets/{id}", "patch"],
      ["/tickets/{id}/messages", "post"],
      ["/api-keys", "get"],
      ["/api-keys", "post"],
      ["/api-keys/{id}", "delete"],
    ]) {
      const responses = object(operation(paths, route, method).responses);
      expect(responses).toHaveProperty("401");
      expect(responses).toHaveProperty("403");
      expect(responses).toHaveProperty("429");
    }

    const messagePath = object(paths["/tickets/{id}/messages"]);
    expect(messagePath).not.toHaveProperty("get");
    expect(object(messagePath.post).description).toContain(
      "Retrieve messages through GET /tickets/{id}"
    );

    const responses = object(object(spec.components).responses);
    expect(responses).toHaveProperty("Unauthorized");
    expect(responses).toHaveProperty("Forbidden");
    expect(responses).toHaveProperty("RateLimited");
  });

  it("keeps the external guide complete and free of credential values", () => {
    const guide = fs.readFileSync(
      path.join(process.cwd(), "docs", "EXTERNAL_API_GUIDE.md"),
      "utf8"
    );

    for (const required of [
      "Production API base URL",
      "## Authentication",
      "### API key setup",
      "## Roles and permissions",
      "## Create a ticket",
      "## Retrieve a ticket and its messages",
      "## Update a ticket",
      "## Add a message",
      "## List and paginate tickets",
      "## Error handling",
      "## Rate limiting",
      "## CORS and browser clients",
      "## JavaScript example",
      "curl",
    ]) {
      expect(guide).toContain(required);
    }

    expect(guide).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(guide).not.toMatch(/\b(?:AUTH_SECRET|DATABASE_URL)\s*=/);
    expect(guide).not.toMatch(/nlk_[A-Za-z0-9_-]{32,}/);
  });

  it("returns 401 rather than 403 for invalid keys on protected documentation and administration routes", async () => {
    const invalidHeaders = { authorization: "Bearer nlk_invalid" };
    const openApiResponse = await getOpenApi(openApiRequest(invalidHeaders));
    expect(openApiResponse.status).toBe(401);
    await expect(openApiResponse.json()).resolves.toEqual({
      ok: false,
      error: "Invalid, expired, or revoked API key.",
    });

    const response = await listApiKeys(
      new Request("http://phase14.test/api/v1/api-keys", {
        headers: invalidHeaders,
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Invalid, expired, or revoked API key.",
    });
  });
});

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGetAll } from "@/lib/api";
import { MemoryCollection } from "@/server/data/memoryStore";
import { PrismaCollection } from "@/server/data/prismaStore";
import { pageCollection } from "@/server/data/store";
import { paginated, parsePagination } from "@/server/http";

interface Row {
  id: string;
  tenantId: string;
  name: string;
  createdAt: string;
}

const parserOptions = {
  defaultSortBy: "createdAt",
  defaultSortDir: "desc",
  allowedSortBy: ["createdAt", "name"] as const,
} as const;

function parse(url: string) {
  return parsePagination(new Request(url), parserOptions);
}

describe("pagination query contract", () => {
  it("uses canonical defaults and returns the legacy limit alias", () => {
    const result = parse("http://local.test/api");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      page: 1,
      pageSize: 50,
      limit: 50,
      skip: 0,
      take: 50,
      sortBy: "createdAt",
      sortDir: "desc",
    });
  });

  it("accepts pageSize and the backward-compatible limit alias", () => {
    const canonical = parse("http://local.test/api?page=2&pageSize=25&sortBy=name&sortDir=asc");
    const legacy = parse("http://local.test/api?page=3&limit=10");
    expect(canonical.ok && canonical.value).toMatchObject({
      page: 2,
      pageSize: 25,
      skip: 25,
      sortBy: "name",
      sortDir: "asc",
    });
    expect(legacy.ok && legacy.value).toMatchObject({
      page: 3,
      pageSize: 10,
      limit: 10,
      skip: 20,
    });
  });

  it.each([
    ["page=0", "page must be a positive integer."],
    ["page=-1", "page must be a positive integer."],
    ["page=1.5", "page must be a positive integer."],
    ["page=abc", "page must be a positive integer."],
    ["pageSize=0", "pageSize must be a positive integer."],
    ["pageSize=101", "pageSize must be at most 100."],
    ["pageSize=abc", "pageSize must be a positive integer."],
    ["sortBy=keyHash", "sortBy must be one of:"],
    ["sortDir=sideways", "sortDir must be one of:"],
    ["pageSize=10&limit=20", "pageSize and limit must match"],
  ])("rejects invalid query %s", async (query, expected) => {
    const result = parse("http://local.test/api?" + query);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    await expect(result.response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining(expected),
    });
  });

  it("emits canonical and legacy metadata together", async () => {
    const result = parse("http://local.test/api?page=2&pageSize=2");
    if (!result.ok) throw new Error("unexpected parse failure");
    const body = await paginated(["c", "d"], 5, result.value).json();
    expect(body.meta).toEqual({
      total: 5,
      page: 2,
      pageSize: 2,
      limit: 2,
      totalPages: 3,
    });
  });
});

describe("datastore pagination", () => {
  const rows: Row[] = [
    { id: "b", tenantId: "t1", name: "Beta", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "a", tenantId: "t1", name: "Alpha", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "c", tenantId: "t1", name: "Gamma", createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "d", tenantId: "t1", name: "Delta", createdAt: "2026-01-04T00:00:00.000Z" },
    { id: "x", tenantId: "t2", name: "Other", createdAt: "2026-01-05T00:00:00.000Z" },
  ];

  it("filters, sorts deterministically, counts before slicing, and supports empty pages", async () => {
    const collection = new MemoryCollection<Row>(() => rows, () => undefined);
    const first = await pageCollection(
      collection,
      { tenantId: "t1" },
      { skip: 0, take: 2, orderBy: { field: "createdAt", dir: "asc" } }
    );
    const second = await pageCollection(
      collection,
      { tenantId: "t1" },
      { skip: 2, take: 2, orderBy: { field: "createdAt", dir: "asc" } }
    );
    const empty = await pageCollection(
      collection,
      { tenantId: "t1" },
      { skip: 10, take: 2, orderBy: { field: "createdAt", dir: "asc" } }
    );

    expect(first).toEqual({ data: [rows[1], rows[0]], total: 4 });
    expect(second).toEqual({ data: [rows[2], rows[3]], total: 4 });
    expect(empty).toEqual({ data: [], total: 4 });
  });

  it("passes skip/take/filter and stable ordering to Prisma while counting the full filter", async () => {
    const delegate = {
      findMany: vi.fn().mockResolvedValue([
        { id: "c", tenantId: "t1", name: "Gamma", createdAt: new Date("2026-01-03T00:00:00Z") },
      ]),
      count: vi.fn().mockResolvedValue(4),
    };
    const collection = new PrismaCollection<Row>(delegate);
    const result = await pageCollection(
      collection,
      { tenantId: "t1" },
      { skip: 2, take: 2, orderBy: { field: "name", dir: "asc" } }
    );

    expect(delegate.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1" },
      skip: 2,
      take: 2,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    expect(delegate.count).toHaveBeenCalledWith({ where: { tenantId: "t1" } });
    expect(result).toEqual({
      data: [{ id: "c", tenantId: "t1", name: "Gamma", createdAt: "2026-01-03T00:00:00.000Z" }],
      total: 4,
    });
  });
});

describe("paginated client compatibility", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads every page and preserves existing filters", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://client.test");
      const page = Number(url.searchParams.get("page"));
      const data = page === 1 ? [{ id: "a" }, { id: "b" }] : [{ id: "c" }];
      return Response.json({
        ok: true,
        data,
        meta: { total: 3, page, pageSize: 100, limit: 100, totalPages: 2 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGetAll<{ id: string }>("/tickets?status=open&limit=5")).resolves.toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [input] of fetchMock.mock.calls) {
      const url = new URL(String(input), "http://client.test");
      expect(url.searchParams.get("status")).toBe("open");
      expect(url.searchParams.get("pageSize")).toBe("100");
      expect(url.searchParams.has("limit")).toBe(false);
    }
  });
});

describe("list-route pagination coverage", () => {
  it.each([
    "api-keys/route.ts",
    "assets/route.ts",
    "audit/route.ts",
    "automations/route.ts",
    "calendars/route.ts",
    "catalog/route.ts",
    "changes/route.ts",
    "cis/route.ts",
    "custom-fields/route.ts",
    "departments/route.ts",
    "groups/route.ts",
    "kb/route.ts",
    "kb/search/route.ts",
    "macros/route.ts",
    "notifications/route.ts",
    "organizations/route.ts",
    "problems/route.ts",
    "sla-policies/route.ts",
    "tickets/route.ts",
    "tickets/[id]/approvals/route.ts",
    "tickets/[id]/attachments/route.ts",
    "users/route.ts",
  ])("%s uses the shared validated pagination contract", (relative) => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src", "app", "api", "v1", relative),
      "utf8"
    );
    expect(source).toContain("parsePagination");
    expect(source).toContain("paginated");
  });
});

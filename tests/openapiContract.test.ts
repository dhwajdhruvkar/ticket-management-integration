// Keeps the OpenAPI document tied to the code: every documented path and method
// has a handler, every handler is documented, and the query parameters the
// tickets route reads are all described. Source-only checks; no route is run.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { GET as getOpenApi } from "@/app/api/v1/openapi.json/route";
import { TICKET_VIEW_RULES } from "@/lib/ticketViews";
import { TICKET_CATEGORIES } from "@/lib/ticketFilters";
import { BUCKET_STATUSES, REQUESTER_FILTERS, REQUESTER_SORTS } from "@/shared/requesterBuckets";

type Param = { name: string; in: string; schema?: { enum?: string[] } };
type Op = { parameters?: Param[]; responses?: Record<string, unknown> };
type Spec = { paths: Record<string, Record<string, Op | unknown>> };

const ROOT = path.join(process.cwd(), "src/app/api/v1");
const API_ROOT = path.join(process.cwd(), "src/app/api"); // paths with servers:[{url:"/api"}] live here, outside /v1
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? routeFiles(full) : e.name === "route.ts" ? [full] : [];
  });
}
const apiUrlOf = (file: string) => "/" + path.relative(API_ROOT, path.dirname(file)).split(path.sep).join("/").replace(/\[(\w+)\]/g, "{$1}");
const urlOf = (file: string) => "/" + path.relative(ROOT, path.dirname(file)).split(path.sep).join("/").replace(/\[(\w+)\]/g, "{$1}");
const handlersOf = (file: string) =>
  new Set([...fs.readFileSync(file, "utf8").matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1].toLowerCase()));

async function spec(): Promise<Spec> {
  const res = await getOpenApi(new Request("http://contract.test/api/v1/openapi.json", { headers: { "x-actor": "dana.lee@netlink.com" } }));
  return (await res.json()) as Spec;
}

describe("OpenAPI matches the implemented routes", () => {
  const files = routeFiles(ROOT).filter((f) => !f.endsWith(path.join("openapi.json", "route.ts")));

  it("every documented method has a handler and every handler is documented", async () => {
    const { paths } = await spec();
    const problems: string[] = [];
    for (const file of files) {
      const url = urlOf(file);
      const documented = new Set(Object.keys(paths[url] ?? {}).filter((m) => (METHODS as readonly string[]).includes(m)));
      const implemented = handlersOf(file);
      for (const m of implemented) if (!documented.has(m)) problems.push(`${m.toUpperCase()} ${url} is implemented but not documented`);
      for (const m of documented) if (!implemented.has(m)) problems.push(`${m.toUpperCase()} ${url} is documented but not implemented`);
    }
    expect(problems).toEqual([]);
  });

  it("documents no path that has no route file, and every method on a path under another server has a handler", async () => {
    const { paths } = await spec();
    const outside = routeFiles(API_ROOT).filter((f) => !f.startsWith(ROOT));
    const outsideByUrl = new Map(outside.map((f) => [apiUrlOf(f), f]));
    const real = new Set(files.map(urlOf).concat("/openapi.json"));
    const problems: string[] = [];
    for (const [url, item] of Object.entries(paths)) {
      const servers = (item as { servers?: { url: string }[] }).servers;
      if (servers?.some((s) => s.url === "/api")) {
        const file = outsideByUrl.get(url);
        if (!file) { problems.push(`${url}: documented under /api but no route exists`); continue; }
        for (const m of METHODS) if (m in item && !handlersOf(file).has(m)) problems.push(`${m.toUpperCase()} ${url} is documented but not implemented`);
      } else if (!real.has(url)) problems.push(`${url}: documented but no route file`);
    }
    expect(problems).toEqual([]);
  });
});

describe("GET /tickets documents the query parameters the route reads", () => {
  it("lists every parameter read by the route and by the explorer filters", async () => {
    const { paths } = await spec();
    const documented = new Set(((paths["/tickets"].get as Op).parameters ?? []).filter((p) => p.in === "query").map((p) => p.name));
    const read = (file: string) => [...fs.readFileSync(file, "utf8").matchAll(/(?:searchParams|\bp)\.get\("(\w+)"\)/g)].map((m) => m[1]);
    const names = new Set([
      ...read(path.join(ROOT, "tickets/route.ts")),
      ...read(path.join(process.cwd(), "src/lib/ticketFilters.ts")),
      "page", "pageSize", "limit", "sortBy", "sortDir", // parsePagination
    ]);
    expect([...names].filter((n) => !documented.has(n)).sort()).toEqual([]);
  });

  it("describes the same values the code accepts", async () => {
    const { paths } = await spec();
    const param = (name: string) => ((paths["/tickets"].get as Op).parameters ?? []).find((p) => p.name === name)?.schema?.enum;
    expect(param("view")?.slice().sort()).toEqual(Object.keys(TICKET_VIEW_RULES).sort());
    expect(param("category")?.slice().sort()).toEqual([...TICKET_CATEGORIES].sort());
    expect(param("bucket")).toEqual([...REQUESTER_FILTERS]);
    expect(param("sort")).toEqual([...REQUESTER_SORTS]);
    expect(Object.keys(BUCKET_STATUSES).sort()).toEqual(["closed", "escalated", "resolved", "waiting"]);
  });

  it("documents the attachment upload limits and retry header", async () => {
    const { paths } = await spec();
    const post = paths["/tickets/{id}/attachments"].post as Op & { summary?: string };
    expect(post.summary).toMatch(/max 5 files/);
    expect((post.parameters ?? []).some((p) => p.name === "X-Upload-Retry" && p.in === "header")).toBe(true);
    expect(Object.keys(post.responses ?? {})).toEqual(expect.arrayContaining(["200", "201", "400"]));
  });
});

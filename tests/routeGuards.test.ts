// Contract test: every API route file declares how it is protected. A new route
// without requirePermission() must be added to ALLOWED below with the guard it
// really uses, so an unguarded route cannot slip in unnoticed. This inspects
// source only; it does not change or exercise any route's behaviour.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const API_ROOT = path.join(process.cwd(), "src/app/api");

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}
const rel = (file: string) => path.relative(API_ROOT, file).split(path.sep).join("/");
const HANDLER = /export (?:async )?function (?:GET|POST|PUT|PATCH|DELETE)\b/;

interface Guard { reason: string; all: RegExp[] }
const SESSION_RBAC: Guard = { reason: "session actor + explicit RBAC check", all: [/currentActor\(/, /can\(/, /currentTenantId\(/] };
const ACTOR_RBAC: Guard = { reason: "actorContext + explicit RBAC check", all: [/actorContext\(/, /can\(/] };
const WEBHOOK_SIGNATURE: Guard = { reason: "provider signature verification", all: [/verifyWebhookRequest\(/] };

/** Routes that do not call requirePermission(), each with the markers that must be present in its source. */
const ALLOWED: Record<string, Guard> = {
  "jobs/workflow/route.ts": { reason: "cron secret, constant-time compare", all: [/CRON_SECRET/, /timingSafeEqual/] },
  "account/setup/route.ts": { reason: "public: single-use setup token + rate limit", all: [/token: z\.string\(\)\.min\(32\)/, /rateLimit\(/] },
  "account/ticket-confirmation/route.ts": { reason: "public: single-use confirmation token + shared rate limit", all: [/token: z\.string\(\)\.min\(32\)/, /sharedActionLimit\(/] },
  "v1/health/route.ts": { reason: "public liveness/capability probe (no tenant data)", all: [/service: "netlink-support"/] },
  "webhooks/slack/route.ts": { reason: "Slack signing secret", all: [/verifySlackRequest\(/] },
  "webhooks/brevo/route.ts": { reason: "shared secret, constant-time compare", all: [/authorized\(/, /timingSafeEqual/] },
  "webhooks/freshdesk/route.ts": WEBHOOK_SIGNATURE,
  "webhooks/generic/route.ts": WEBHOOK_SIGNATURE,
  "webhooks/zendesk/route.ts": WEBHOOK_SIGNATURE,
  "auth/[...nextauth]/route.ts": { reason: "Auth.js handlers", all: [/handlers/] },
  "v1/account/password/route.ts": { reason: "signed-in actor changes their own password", all: [/actorContext\(/, /ctx\.actor/] },
  "v1/organizations/[id]/route.ts": { reason: "actorContext + role checks in the service", all: [/actorContext\(/, /ctx\./] },
  "v1/changes/[id]/approvals/route.ts": ACTOR_RBAC,
  "v1/problems/[id]/actions/route.ts": ACTOR_RBAC,
  "v1/triage/assign/route.ts": ACTOR_RBAC,
  "v1/tickets/[id]/typing/route.ts": { reason: "tenant- and requester-scoped via loadTicket", all: [/actorContext\(/, /loadTicket\(/] },
  "v1/tickets/[id]/actions/route.ts": { reason: "loadTicket + RBAC", all: [/loadTicket\(/, /can\(/] },
  "v1/tickets/[id]/attachments/route.ts": { reason: "loadTicket + RBAC", all: [/loadTicket\(/, /can\(/] },
  ...Object.fromEntries(
    [
      "v1/audit", "v1/calendars", "v1/custom-fields", "v1/departments", "v1/departments/[id]", "v1/macros", "v1/metrics", "v1/reports",
      "v1/reports/trends", "v1/triage", "v1/users", "v1/users/[id]", "v1/users/[id]/access-link",
    ].map((dir) => [`${dir}/route.ts`, SESSION_RBAC])
  ),
};

describe("API route guard contract", () => {
  const files = routeFiles(API_ROOT);

  it("finds the route files", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("every route file calls requirePermission() or is allow-listed with its real guard", () => {
    const unclassified = files.filter((file) => !fs.readFileSync(file, "utf8").includes("requirePermission(") && !(rel(file) in ALLOWED)).map(rel);
    expect(unclassified, "add a guard, or allow-list the route with the guard it uses").toEqual([]);
  });

  it("every allow-listed route still contains the markers of its guard", () => {
    const problems: string[] = [];
    for (const [route, guard] of Object.entries(ALLOWED)) {
      const file = path.join(API_ROOT, route);
      if (!fs.existsSync(file)) { problems.push(`${route}: listed but missing`); continue; }
      const source = fs.readFileSync(file, "utf8");
      for (const marker of guard.all) if (!marker.test(source)) problems.push(`${route}: missing ${marker} (${guard.reason})`);
    }
    expect(problems).toEqual([]);
  });

  it("no allow-list entry is stale: routes that already use requirePermission() do not need one", () => {
    const redundant = Object.keys(ALLOWED).filter((route) => {
      const file = path.join(API_ROOT, route);
      return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("requirePermission(");
    });
    expect(redundant).toEqual([]);
  });

  it("every route exports at least one HTTP handler", () => {
    const empty = files.filter((file) => !HANDLER.test(fs.readFileSync(file, "utf8"))).map(rel);
    expect(empty).toEqual([]);
  });
});

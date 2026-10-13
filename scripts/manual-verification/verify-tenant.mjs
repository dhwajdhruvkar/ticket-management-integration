// Corrected tenant-isolation and availability re-checks. Demo-mode header auth needs x-tenant to pick a tenant.
// Writes verdicts-fixes.json with the same shape as verdicts.json.
import { writeFileSync } from "node:fs";
const BASE = "http://localhost:3000/api/v1";
const verdicts = {};
const rec = (id, verdict, evidence) => { verdicts[id] = { verdict, evidence }; console.log(`${id.padEnd(12)} ${verdict.padEnd(20)} ${evidence.slice(0, 260)}`); };

async function call(actor, method, path, body, tenant = "tenant_netlink") {
  const headers = { "x-actor": actor, "x-tenant": tenant };
  let payload;
  if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  let json = null; try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data: json?.data, error: json?.error };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const orgs = (await call("vikram.rao@netlink.com", "GET", "/organizations")).data ?? [];
  const orgB = orgs.find((o) => o.name === "Verification Org B");
  if (!orgB) throw new Error("Verification Org B not found");
  const A = "tenant_netlink", B = orgB.id, adminB = "agent.orgb@example.test";
  // Org B user must be active (access-link setup) with a role that can read the directory.
  await call("vikram.rao@netlink.com", "PATCH", "/users/user_2f8d675a95114a86bec2", { role: "manager" }, B);

  // TC-WHO-04: Org B admin cannot see Tenant A requesters.
  const bDana = await call(adminB, "GET", "/requesters?q=Dana", undefined, B);
  const bAll = await call(adminB, "GET", "/requesters?q=", undefined, B);
  const bNames = (bAll.data?.items ?? []).map((i) => i.name);
  rec("TC-WHO-04", bDana.status === 200 && (bDana.data?.items ?? []).length === 0 && !bNames.includes("Dana Lee") ? "Confirmed" : "Mismatch",
    `Org B admin (tenant ${B}) searching "Dana": ${(bDana.data?.items ?? []).length} results; Org B directory: ${bNames.join(", ")}`);

  // TC-SEC-07: tenant barrier in both directions.
  const aTicket = await call("arjun.mehta@netlink.com", "POST", "/tickets", { subject: "Tenant A barrier ticket", body: "Tenant A only", requesterEmail: "dana.lee@netlink.com", category: "Access" }, A);
  const bTicket = await call(adminB, "POST", "/tickets", { subject: "Tenant B barrier ticket", body: "Tenant B only", requesterEmail: adminB, category: "Other" }, B);
  const aReadsB = await call("arjun.mehta@netlink.com", "GET", `/tickets/${bTicket.data?.id}`, undefined, A);
  const bReadsA = await call(adminB, "GET", `/tickets/${aTicket.data?.id}`, undefined, B);
  const aUsers = await call("priya.sharma@netlink.com", "GET", "/users", undefined, A);
  const aSeesBUser = (aUsers.data ?? []).some((u) => u.email === adminB);
  const aBoard = await call("arjun.mehta@netlink.com", "GET", "/workflow/board", undefined, A);
  const aBoardHasB = (aBoard.data?.tickets ?? []).some((t) => t.id === bTicket.data?.id);
  const bBoard = await call(adminB, "GET", "/workflow/board", undefined, B);
  const bBoardHasA = (bBoard.data?.tickets ?? []).some((t) => t.id === aTicket.data?.id);
  const bDepts = await call(adminB, "GET", "/departments", undefined, B);
  const aDeptsHaveB = (await call("arjun.mehta@netlink.com", "GET", "/departments", undefined, A)).data?.some((d) => d.tenantId === B);
  const aAvailB = await call("arjun.mehta@netlink.com", "GET", `/users/${encodeURIComponent(adminB)}/availability`, undefined, A);
  const ok = aReadsB.status === 404 && bReadsA.status === 404 && !aSeesBUser && !aBoardHasB && !bBoardHasA && !aDeptsHaveB;
  rec("TC-SEC-07", ok ? "Confirmed" : "Mismatch",
    `A reads B ticket ${aReadsB.status}; B reads A ticket ${bReadsA.status}; A sees B user: ${aSeesBUser}; B ticket on A board: ${aBoardHasB}; A ticket on B board: ${bBoardHasA}; A sees B departments: ${!!aDeptsHaveB}; A availability for B user ${aAvailB.status}; B departments listed ${(bDepts.data ?? []).length}`);

  // TC-REC-03: Tenant B resolved history must not change Tenant A's recommendation.
  const probe = await call("arjun.mehta@netlink.com", "POST", "/tickets", { subject: "VPN is not connecting after I changed my password (probe)", body: "VPN is not connecting after I changed my password.", requesterEmail: "dana.lee@netlink.com", category: "Network" }, A);
  const before = await call("meera.nair@netlink.com", "GET", `/tickets/${probe.data.id}/workflow`, undefined, A);
  const bHist = await call(adminB, "POST", "/tickets", { subject: "VPN is not connecting after password reset", body: "VPN is not connecting after password reset.", requesterEmail: adminB, category: "Network" }, B);
  await call(adminB, "POST", `/tickets/${bHist.data.id}/actions`, { action: "resolve", resolutionNotes: "Tenant B fix" }, B);
  const after = await call("meera.nair@netlink.com", "GET", `/tickets/${probe.data.id}/workflow`, undefined, A);
  const count = (r) => JSON.stringify((r.data?.agents ?? []).map((a) => [a.id, a.similarResolved]));
  const bAgentsInA = (after.data?.agents ?? []).some((a) => !a.id.startsWith("user_"));
  rec("TC-REC-03", before.status === 200 && after.status === 200 && count(before) === count(after) && !bAgentsInA ? "Confirmed" : "Mismatch",
    `Tenant A recommendation before/after a Tenant B resolved match: ${count(before)} -> ${count(after)}; Tenant B agents listed in A: ${bAgentsInA}`);

  // TC-AVL-08 (corrected): expiry test on Meera (self-override, no calendar).
  await call("meera.nair@netlink.com", "PATCH", "/users/user_meera/availability", { override: "away", overrideUntil: new Date(Date.now() + 3000).toISOString() }, A);
  const during = (await call("arjun.mehta@netlink.com", "GET", "/workflow/board", undefined, A)).data?.staff?.find((s) => s.id === "user_meera")?.availability;
  await sleep(4500);
  const later = (await call("arjun.mehta@netlink.com", "GET", "/workflow/board", undefined, A)).data?.staff?.find((s) => s.id === "user_meera")?.availability;
  rec("TC-AVL-08", during?.status === "away" && later?.status !== "away" ? "Confirmed" : "Mismatch", `Meera override away: during=${during?.status} ("${during?.reason}"), 4.5 s later=${later?.status} ("${later?.reason}")`);
  await call("meera.nair@netlink.com", "PATCH", "/users/user_meera/availability", { override: "available", overrideUntil: "" }, A);

  writeFileSync(new URL("./verdicts-fixes.json", import.meta.url), JSON.stringify(verdicts, null, 1));
  console.log("written verdicts-fixes.json");
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exitCode = 2; });

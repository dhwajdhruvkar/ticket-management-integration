// Live behaviour checks for Phases A-G against the running dev server (demo mode, memory store).
// Each check prints PASS/FAIL with evidence. Run: node verify-phases.mjs
const BASE = "http://localhost:3000/api/v1";
const who = {
  priya: "priya.sharma@netlink.com", // tenant_admin, senior RM
  meera: "meera.nair@netlink.com", // manager, desk bucket manager
  arjun: "arjun.mehta@netlink.com", // agent, service desk member
  sarah: "sarah.johnson@netlink.com", // agent, service desk member
  luis: "luis.moreno@netlink.com", // agent, member of Network Operations only
  dana: "dana.lee@netlink.com", // requester, San Francisco
  sam: "sam.patel@netlink.com", // requester, New York
};

const results = [];
function check(section, name, cond, detail = "") {
  results.push({ section, name, pass: !!cond, detail: cond ? "" : String(detail) });
  console.log(`${cond ? "PASS" : "FAIL"}  [${section}] ${name}${cond ? "" : `  -> ${String(detail).slice(0, 300)}`}`);
}

async function call(actor, method, path, body, form) {
  const headers = { "x-actor": who[actor] ?? actor };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data: json?.data, error: json?.error, json };
}

async function raw(actor, path) {
  const res = await fetch(BASE + path, { headers: { "x-actor": who[actor] } });
  return { status: res.status, text: await res.text() };
}

const file = (name, text, type = "text/plain") => new Blob([text], { type });
function formOf(fields, files = []) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const f of files) form.append("file", file(f.name, f.text, f.type), f.name);
  return form;
}

const STAGES = {
  critical: { pickupMins: 5, managerMins: 5 }, high: { pickupMins: 15, managerMins: 15 },
  medium: { pickupMins: 30, managerMins: 30 }, low: { pickupMins: 60, managerMins: 60 }, very_low: { pickupMins: 120, managerMins: 120 },
};

async function main() {
  // ---------------------------------------------------------------- setup
  const setup = await call("priya", "PATCH", "/workflow/settings", {
    enabled: true, serviceDeskGroupId: "grp_service_desk", timezone: "UTC", availabilityMode: "automatic", stages: STAGES,
    buckets: [
      { groupId: "grp_service_desk", kind: "service_desk", managerId: "user_meera", seniorRmId: "user_priya" },
      { groupId: "grp_network", kind: "department", departmentId: "dept_872fe05c8ae04ae5b5e2", managerId: "user_meera", seniorRmId: "user_priya" },
      { groupId: "grp_access", kind: "department", departmentId: "dept_f4668abed347479e84b0", managerId: "user_meera", seniorRmId: "user_priya" },
    ],
  });
  check("setup", "workflow enabled by tenant admin", setup.status === 200 && setup.data?.enabled === true, `${setup.status} ${setup.error}`);

  // ---------------------------------------------------------------- G: who & where
  const browse = await call("arjun", "GET", "/requesters?q=");
  const names = (browse.data?.items ?? []).map((i) => i.name);
  check("G", "empty search browses active users alphabetically", browse.status === 200 && names.length > 0 && names.every((n, i) => i === 0 || names[i - 1].localeCompare(n) <= 0), JSON.stringify(names));
  check("G", "choices carry a location field", (browse.data?.items ?? []).every((i) => "location" in i), JSON.stringify(browse.data?.items?.[0]));
  const bySf = await call("arjun", "GET", "/requesters?q=" + encodeURIComponent("San Francisco"));
  const sfNames = (bySf.data?.items ?? []).map((i) => i.name);
  check("G", "search matches location text", sfNames.includes("Dana Lee") && sfNames.includes("Sarah Johnson"), JSON.stringify(sfNames));

  const withLoc = await call("arjun", "POST", "/tickets", {
    subject: "Need access to the finance share", body: "Please grant me access to the finance share drive.",
    requesterEmail: "dana.lee@netlink.com", category: "Access", requesterLocation: "  Floor 9, SF HQ  ",
  });
  check("G", "ticket stores trimmed requester location in customFields", withLoc.status < 300 && withLoc.data?.customFields?.requesterLocation === "Floor 9, SF HQ", `${withLoc.status} ${JSON.stringify(withLoc.data?.customFields)}`);
  const fallback = await call("arjun", "POST", "/tickets", {
    subject: "Laptop keyboard sticky", body: "Two keys stick on my laptop.", requesterEmail: "sam.patel@netlink.com", category: "Hardware",
  });
  check("G", "location falls back to the requester profile", fallback.data?.customFields?.requesterLocation === "New York, US", JSON.stringify(fallback.data?.customFields));
  const tooLong = await call("arjun", "POST", "/tickets", {
    subject: "Monitor flicker", body: "Monitor flickers.", requesterEmail: "sam.patel@netlink.com", category: "Hardware", requesterLocation: "x".repeat(200),
  });
  check("G", "over-long location is dropped (profile fallback used)", tooLong.data?.customFields?.requesterLocation === "New York, US", JSON.stringify(tooLong.data?.customFields));
  const inject = await call("arjun", "POST", "/tickets", {
    subject: "Printer offline", body: "Printer offline.", requesterEmail: "dana.lee@netlink.com", category: "Hardware",
    customFields: { hack: "1", requesterLocation: "Forged" },
  });
  check("G", "client cannot inject arbitrary customFields", inject.data && !("hack" in (inject.data.customFields ?? {})), JSON.stringify(inject.data?.customFields));

  // ---------------------------------------------------------------- F: context-aware priority
  const cls = await call("arjun", "POST", "/tickets/classification", {
    subject: "Cannot log in", body: "I am locked out and cannot work", category: "Access", type: "incident", affectedPeople: "many", workStopped: true,
  });
  const f1 = cls.data ?? {};
  check("F", "work-stopped + many people raise impact and urgency", f1.impact === "high" && f1.urgency === "high", JSON.stringify(f1));
  check("F", "factors are listed", ["Requester cannot work", "Many people affected"].every((x) => (f1.factors ?? []).includes(x)), JSON.stringify(f1.factors));
  check("F", "requester category is kept", f1.category === "Access", f1.category);
  const sec = await call("arjun", "POST", "/tickets/classification", { subject: "Suspicious email", body: "I clicked a phishing link and typed my password" });
  check("F", "security wording forces at least high priority", ["critical", "high"].includes(sec.data?.priority) && (sec.data?.factors ?? []).includes("Possible security incident"), JSON.stringify(sec.data));
  const plain = await call("arjun", "POST", "/tickets/classification", { subject: "Printer label", body: "The label printer needs new paper" });
  check("F", "no signals means no factors and matrix priority", Array.isArray(plain.data?.factors) && plain.data.factors.length === 0 && plain.data.priority === "medium", JSON.stringify(plain.data));
  const bad = await call("arjun", "POST", "/tickets/classification", { subject: "x", body: "y", affectedPeople: "everyone" });
  check("F", "invalid affectedPeople is rejected by the classifier schema", bad.status === 400, bad.status);

  const outage = await call("dana", "POST", "/tickets", {
    subject: "VPN down for everyone", body: "Nobody in the office can connect.", category: "Network", affectedPeople: "many", workStopped: true,
  });
  const audit = await call("priya", "GET", `/audit?ticketId=${outage.data?.id}`);
  const assessed = (audit.data ?? []).find((r) => r.action === "ticket.priority_assessed");
  check("F", "automatic classification is audited with factors", !!assessed && (assessed.payload?.factors ?? []).includes("Requester cannot work"), JSON.stringify(audit.data?.map((r) => r.action)));

  // ---------------------------------------------------------------- E2: attachments in conversations
  const te = await call("arjun", "POST", "/tickets", { subject: "Attachment test", body: "Testing files", requesterEmail: "dana.lee@netlink.com", category: "Software" });
  const tid = te.data.id;
  const pub = await call("arjun", "POST", `/tickets/${tid}/messages`, undefined, formOf({ body: "See attached", visibility: "public" }, [{ name: "notes.txt", text: "hello public" }]));
  check("E2", "agent public reply with a file is accepted (multipart)", pub.status === 200, `${pub.status} ${pub.error}`);
  const internal = await call("arjun", "POST", `/tickets/${tid}/messages`, undefined, formOf({ body: "Internal: check VPN logs", visibility: "internal" }, [{ name: "secret.txt", text: "internal-only-bytes" }]));
  check("E2", "agent internal note with a file is accepted", internal.status === 200, `${internal.status} ${internal.error}`);

  let view = await call("arjun", "GET", `/tickets/${tid}`);
  const att = view.data?.attachments ?? [];
  const publicMsg = (view.data?.messages ?? []).find((m) => m.body === "See attached");
  const notes = att.find((a) => a.fileName === "notes.txt");
  const secret = att.find((a) => a.fileName === "secret.txt");
  check("E2", "staff see both files", !!notes && !!secret, JSON.stringify(att.map((a) => a.fileName)));
  check("E2", "file is attached to its message", !!publicMsg && notes?.messageId === publicMsg.id, JSON.stringify({ messageId: notes?.messageId, msg: publicMsg?.id }));

  view = await call("dana", "GET", `/tickets/${tid}`);
  const dnames = (view.data?.attachments ?? []).map((a) => a.fileName);
  check("E2", "requester sees the public file but not the internal-note file", dnames.includes("notes.txt") && !dnames.includes("secret.txt"), JSON.stringify(dnames));
  check("E2", "requester does not see the internal note", !(view.data?.messages ?? []).some((m) => m.body === "Internal: check VPN logs"), "internal note leaked");
  const reqList = await call("dana", "GET", `/tickets/${tid}/attachments`);
  check("E2", "attachment list endpoint hides internal-note files from requesters", !(reqList.data ?? []).some((a) => a.fileName === "secret.txt") && (reqList.data ?? []).some((a) => a.fileName === "notes.txt"), JSON.stringify((reqList.data ?? []).map((a) => a.fileName)));
  const hidden = await raw("dana", `/attachments/${secret.id}`);
  check("E2", "requester download of an internal-note file returns 404", hidden.status === 404, hidden.status);
  const shown = await raw("arjun", `/attachments/${secret.id}`);
  check("E2", "staff download of an internal-note file works and returns the bytes", shown.status === 200 && shown.text === "internal-only-bytes", `${shown.status} ${shown.text.slice(0, 60)}`);

  const reqInternal = await call("dana", "POST", `/tickets/${tid}/messages`, undefined, formOf({ body: "sneaky", visibility: "internal" }, [{ name: "x.txt", text: "x" }]));
  check("E2", "requester cannot post an internal note with files", reqInternal.status === 403, reqInternal.status);

  const before = (await call("arjun", "GET", `/tickets/${tid}`)).data.messages.length;
  const exe = await call("arjun", "POST", `/tickets/${tid}/messages`, undefined, formOf({ body: "run this" }, [{ name: "payload.exe", text: "MZ", type: "application/octet-stream" }]));
  const afterExe = (await call("arjun", "GET", `/tickets/${tid}`)).data.messages.length;
  check("E2", ".exe is rejected and no message is posted", exe.status === 400 && /\.exe files are not allowed/.test(exe.error ?? "") && afterExe === before, `${exe.status} ${exe.error} msgs ${before}->${afterExe}`);
  const six = await call("arjun", "POST", `/tickets/${tid}/messages`, undefined, formOf({ body: "six" }, [1, 2, 3, 4, 5, 6].map((i) => ({ name: `f${i}.txt`, text: "x" }))));
  check("E2", "more than 5 files per message is rejected", six.status === 400 && /At most 5/.test(six.error ?? ""), `${six.status} ${six.error}`);
  const noBody = await call("arjun", "POST", `/tickets/${tid}/messages`, undefined, formOf({ body: "" }, [{ name: "lonely.txt", text: "x" }]));
  check("E2", "a file without text is rejected (text required)", noBody.status === 400, noBody.status);
  const json = await call("arjun", "POST", `/tickets/${tid}/messages`, { body: "plain json reply", visibility: "public" });
  check("E2", "JSON message path still works", json.status === 200, `${json.status} ${json.error}`);
  const reqFile = await call("dana", "POST", `/tickets/${tid}/messages`, undefined, formOf({ body: "Here is my screenshot" }, [{ name: "dana.txt", text: "shot" }]));
  check("E2", "requester can reply with a file", reqFile.status === 200, `${reqFile.status} ${reqFile.error}`);

  // ---------------------------------------------------------------- C: agent performance
  const perf = await call("arjun", "GET", "/metrics/agents?range=week");
  const row = (perf.data?.rows ?? [])[0];
  check("C", "per-agent rows include the new metrics", perf.status === 200 && row && ["resolvedToday", "resolvedThisWeek", "resolvedThisMonth", "avgResolutionMins", "slaCompliance", "reopened", "oldestOpenAgeMins", "avgOpenAgeMins"].every((k) => k in row), JSON.stringify(row));
  check("C", "week range defaults to daily trend", perf.data?.granularity === "day" && perf.data?.series?.length === 7, `${perf.data?.granularity} ${perf.data?.series?.length}`);
  const longRange = await call("arjun", "GET", "/metrics/agents?range=custom&from=2026-01-01&to=2026-06-30");
  check("C", "181-day custom range defaults to monthly trend", longRange.data?.granularity === "month", longRange.data?.granularity);
  const badG = await call("arjun", "GET", "/metrics/agents?range=week&granularity=hourly");
  check("C", "invalid granularity is rejected", badG.status === 400 && badG.error === "Invalid granularity.", `${badG.status} ${badG.error}`);

  // ---------------------------------------------------------------- D: status board metrics
  const m = await call("arjun", "GET", "/metrics");
  const md = m.data ?? {};
  const numericOk = ["assigned", "inProgress", "pending", "escalatedTickets", "overdue"].every((k) => typeof md[k] === "number");
  check("D", "dashboard metrics expose status-board counts", m.status === 200 && numericOk && typeof md.byWorkflowPhase === "object", JSON.stringify({ assigned: md.assigned, inProgress: md.inProgress, pending: md.pending, escalatedTickets: md.escalatedTickets, overdue: md.overdue }));
  check("D", "assigned never exceeds open count", md.assigned <= md.openCount, `${md.assigned} > ${md.openCount}`);

  // ---------------------------------------------------------------- B + A: workflow, recommendation, return
  const w = await call("dana", "POST", "/tickets", {
    subject: "VPN connection fails on laptop from home", body: "Cannot connect to the VPN, network timeout from home.", category: "Network",
  });
  const wid = w.data.id;
  check("A", "new ticket enters the service-desk bucket", w.data?.workflow?.phase === "service_desk" && w.data?.assignmentGroupId === "grp_service_desk", JSON.stringify({ phase: w.data?.workflow?.phase, group: w.data?.assignmentGroupId }));

  const rq = await call("dana", "GET", `/tickets/${wid}/workflow`);
  check("B", "requester cannot request routing suggestions", rq.status === 403, rq.status);
  const rqLuis = await call("luis", "GET", `/tickets/${wid}/workflow`);
  check("B", "agent outside the service desk cannot request suggestions", rqLuis.status === 403, rqLuis.status);
  const rec = await call("arjun", "GET", `/tickets/${wid}/workflow`);
  check("B", "service-desk member gets a ranked recommendation", rec.status === 200 && Array.isArray(rec.data?.groups) && Array.isArray(rec.data?.agents) && typeof rec.data?.basis === "string", `${rec.status} ${rec.error}`);
  const top = rec.data?.groups?.[0];
  console.log(`      info: top suggestion = ${top ? `${top.name} (${top.confidence}, score ${top.score})` : "none (no evidence)"}; basis: ${rec.data?.basis}`);

  const claim = await call("arjun", "POST", `/tickets/${wid}/workflow`, { action: "claim_review" });
  check("A", "desk member claims review", claim.status === 200, `${claim.status} ${claim.error}`);
  const route = await call("arjun", "POST", `/tickets/${wid}/workflow`, { action: "route", groupId: "grp_network", suggestedGroupId: top?.groupId });
  check("A", "route to department bucket", route.status === 200 && route.data?.workflow?.phase === "department", `${route.status} ${route.error}`);
  const ticketNow = await call("arjun", "GET", `/tickets/${wid}`);
  const routeEvent = (ticketNow.data?.events ?? []).find((e) => e.type === "workflow.route");
  if (top) {
    check("B", "route event records the suggestion and whether it was followed", routeEvent?.meta?.suggestedGroupId === top.groupId && routeEvent?.meta?.followedSuggestion === (top.groupId === "grp_network"), JSON.stringify(routeEvent?.meta));
  } else {
    check("B", "route without a suggestion records no suggestion fields", routeEvent && !("suggestedGroupId" in (routeEvent.meta ?? {})), JSON.stringify(routeEvent?.meta));
  }

  const notMember = await call("sarah", "POST", `/tickets/${wid}/workflow`, { action: "return_to_service_desk", reason: "Not mine" });
  check("A", "non-member agent cannot return a department ticket", notMember.status === 403, `${notMember.status} ${notMember.error}`);
  const blank = await call("luis", "POST", `/tickets/${wid}/workflow`, { action: "return_to_service_desk", reason: "   " });
  check("A", "blank return reason is rejected", blank.status === 400, `${blank.status} ${blank.error}`);
  const ret1 = await call("luis", "POST", `/tickets/${wid}/workflow`, { action: "return_to_service_desk", reason: "Wrong team, this is an access issue" });
  check("A", "group member returns the ticket to the service desk", ret1.status === 200 && ret1.data?.workflow?.phase === "service_desk" && ret1.data?.assignmentGroupId === "grp_service_desk" && ret1.data?.workflow?.returns?.length === 1, `${ret1.status} ${ret1.error} ${JSON.stringify(ret1.data?.workflow?.returns)}`);
  check("A", "return history keeps the origin group and reason", ret1.data?.workflow?.returns?.[0]?.fromGroupId === "grp_network" && ret1.data?.workflow?.returns?.[0]?.reason === "Wrong team, this is an access issue", JSON.stringify(ret1.data?.workflow?.returns));

  await call("arjun", "POST", `/tickets/${wid}/workflow`, { action: "claim_review" });
  const back = await call("arjun", "POST", `/tickets/${wid}/workflow`, { action: "route", groupId: "grp_network", reason: "Trying again" });
  check("A", "desk cannot route straight back to the group that returned it", back.status === 403, `${back.status} ${back.error}`);
  const mgrNoReason = await call("meera", "POST", `/tickets/${wid}/workflow`, { action: "route", groupId: "grp_network" });
  check("A", "manager routing a returned ticket needs a reason", mgrNoReason.status === 400, `${mgrNoReason.status} ${mgrNoReason.error}`);
  const mgrRoute = await call("meera", "POST", `/tickets/${wid}/workflow`, { action: "route", groupId: "grp_network", reason: "Confirmed with requester" });
  check("A", "manager with a reason can route it", mgrRoute.status === 200 && mgrRoute.data?.workflow?.phase === "department", `${mgrRoute.status} ${mgrRoute.error}`);

  const ret2 = await call("luis", "POST", `/tickets/${wid}/workflow`, { action: "return_to_service_desk", reason: "Still wrong" });
  check("A", "second return is recorded and the count reaches 2", ret2.status === 200 && ret2.data?.workflow?.returns?.length === 2, `${ret2.status} ${ret2.error}`);
  await call("arjun", "POST", `/tickets/${wid}/workflow`, { action: "claim_review" });
  const third = await call("arjun", "POST", `/tickets/${wid}/workflow`, { action: "route", groupId: "grp_access", reason: "Trying another group" });
  check("A", "after two returns a non-manager cannot route at all", third.status === 403, `${third.status} ${third.error}`);

  const mNotes = await call("meera", "GET", "/notifications");
  const deskMail = (mNotes.data?.items ?? []).filter((n) => /returned to the Service Desk 2 times/.test(n.subject ?? ""));
  check("A", "desk bucket manager is notified after the second return", deskMail.length >= 1, `${mNotes.status} notifications=${(mNotes.data?.items ?? []).length}`);

  // ---------------------------------------------------------------- summary
  const failed = results.filter((r) => !r.pass);
  const bySection = {};
  for (const r of results) { bySection[r.section] ??= { pass: 0, fail: 0 }; bySection[r.section][r.pass ? "pass" : "fail"]++; }
  console.log("\nSummary by phase:", JSON.stringify(bySection));
  console.log(`TOTAL: ${results.length - failed.length} passed, ${failed.length} failed`);
  return failed.length === 0 ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }).catch((err) => { console.error("HARNESS ERROR", err); process.exitCode = 2; });

# =============================================================================
# End-to-end smoke test for Netlink Support.
#
# Signs in as each demo role through the real NextAuth credentials flow and
# exercises the API call behind every UI control: ticket lifecycle, SLA pause,
# approvals, groups, KB, problems, changes (CAB + lifecycle), assets/CMDB,
# notifications, profile, audit, metrics, portal intake, and RBAC denials.
#
#   powershell -File scripts/e2e-smoke.ps1 [-BaseUrl http://localhost:3000]
# =============================================================================

param([string]$BaseUrl = "http://localhost:3000")

$ErrorActionPreference = "Stop"
$script:pass = 0
$script:fail = 0

function Check([string]$name, [bool]$ok, [string]$detail = "") {
  if ($ok) { $script:pass++; Write-Host ("  PASS  " + $name) }
  else { $script:fail++; Write-Host ("  FAIL  " + $name + ($(if ($detail) { "  -> $detail" } else { "" }))) -ForegroundColor Red }
}

function New-Session([string]$email) {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $csrf = (Invoke-RestMethod -Uri "$BaseUrl/api/auth/csrf" -WebSession $s).csrfToken
  Invoke-WebRequest -Uri "$BaseUrl/api/auth/callback/demo" -Method Post -WebSession $s -UseBasicParsing `
    -ContentType "application/x-www-form-urlencoded" `
    -Body "csrfToken=$([uri]::EscapeDataString($csrf))&email=$([uri]::EscapeDataString($email))" | Out-Null
  $who = Invoke-RestMethod -Uri "$BaseUrl/api/auth/session" -WebSession $s
  if (-not $who.user) { throw "Sign-in failed for $email" }
  return $s
}

function Api($s, [string]$method, [string]$path, $body = $null) {
  $args = @{ Uri = "$BaseUrl/api/v1$path"; Method = $method; WebSession = $s; ContentType = "application/json" }
  if ($null -ne $body) { $args.Body = ($body | ConvertTo-Json -Depth 8) }
  return (Invoke-RestMethod @args).data
}

function ApiFails($s, [string]$method, [string]$path, $body = $null) {
  try {
    Api $s $method $path $body | Out-Null
    return $false
  } catch {
    return $true
  }
}

Write-Host "== Session gating =="
$redirected = $false
try {
  $r = Invoke-WebRequest -Uri "$BaseUrl/" -MaximumRedirection 0 -UseBasicParsing
  $redirected = ($r.StatusCode -ge 300 -and $r.StatusCode -lt 400 -and $r.Headers.Location -match "signin")
} catch {
  $resp = $_.Exception.Response
  if ($resp -and $resp.StatusCode.value__ -ge 300 -and $resp.StatusCode.value__ -lt 400) {
    $redirected = ("" + $resp.Headers["Location"]) -match "signin"
  }
}
Check "unauthenticated / redirects to /signin" $redirected

Write-Host "== Sign in all roles =="
$priya = New-Session "priya.sharma@netlink.com"   # tenant_admin
$arjun = New-Session "arjun.mehta@netlink.com"    # agent
$meera = New-Session "meera.nair@netlink.com"     # manager
$dana  = New-Session "dana.lee@netlink.com"       # requester
Check "all four demo users signed in" $true

Write-Host "== Authenticated pages render =="
foreach ($p in @("/", "/tickets", "/knowledge-base", "/audit", "/settings", "/portal", "/analytics", "/problems", "/changes", "/assets", "/profile")) {
  $status = 0
  foreach ($attempt in 1..3) {
    try {
      $page = Invoke-WebRequest -Uri "$BaseUrl$p" -WebSession $priya -UseBasicParsing
      $status = $page.StatusCode
    } catch {
      $status = $_.Exception.Response.StatusCode.value__
    }
    if ($status -eq 200) { break }
    Start-Sleep 1  # dev server cold-compile retry
  }
  Check "GET $p (as admin)" ($status -eq 200)
}

Write-Host "== Ticket lifecycle (agent workspace buttons) =="
$t = Api $priya POST "/tickets" @{ type = "incident"; subject = "E2E: core switch flapping"; body = "Port 7 drops every few minutes."; requesterEmail = "dana.lee@netlink.com"; category = "Network"; impact = "high"; urgency = "high"; autoResolve = $false }
Check "create derives P1 + INC ref + routes to Network group" ($t.priority -eq "critical" -and $t.reference -like "INC-*" -and $t.assignmentGroupId -eq "grp_network")

$t2 = Api $priya PATCH "/tickets/$($t.id)" @{ impact = "low" }
Check "impact edit recalculates priority (matrix)" ($t2.priority -eq "medium")
$t3 = Api $priya PATCH "/tickets/$($t.id)" @{ priority = "high"; priorityJustification = "e2e override" }
Check "manual priority override" ($t3.priority -eq "high")
$t4 = Api $priya PATCH "/tickets/$($t.id)" @{ subcategory = "Switching"; tags = @("e2e"); ciIds = @() }
Check "subcategory/tags/CI patch" ($t4.subcategory -eq "Switching")

$t5 = Api $priya POST "/tickets/$($t.id)/actions" @{ action = "assign"; assigneeId = "user_arjun" }
Check "assign to agent" ($t5.assigneeId -eq "user_arjun")
Api $priya POST "/tickets/$($t.id)/messages" @{ body = "Looking into it now."; visibility = "public" } | Out-Null
Api $priya POST "/tickets/$($t.id)/messages" @{ body = "Suspect a bad SFP."; visibility = "internal" } | Out-Null
$view = Api $priya GET "/tickets/$($t.id)"
Check "public reply + internal note recorded" ((($view.messages | Measure-Object).Count -ge 2) -and [bool]$view.firstRespondedAt)

$hold = Api $priya PATCH "/tickets/$($t.id)" @{ status = "pending" }
Check "on-hold pauses the SLA clock" ([bool]$hold.slaPausedAt)
$resume = Api $priya PATCH "/tickets/$($t.id)" @{ status = "in_progress" }
Check "resume clears the pause" (-not $resume.slaPausedAt)

$sum = Api $priya GET "/tickets/$($t.id)/summary"
Check "AI thread summary" ($sum.summary.Length -gt 0)
Api $priya POST "/tickets/$($t.id)/actions" @{ action = "run_ai" } | Out-Null
Check "run AI triage" $true

$res = Api $priya POST "/tickets/$($t.id)/actions" @{ action = "resolve"; reply = "Replaced the SFP."; resolutionNotes = "Faulty SFP swapped." }
Check "resolve with notes" ($res.status -eq "resolved" -and $res.resolutionNotes -eq "Faulty SFP swapped.")
$closed = Api $priya POST "/tickets/$($t.id)/actions" @{ action = "close" }
Check "close stamps closedAt" (($closed.status -eq "closed") -and [bool]$closed.closedAt)
$re = Api $priya POST "/tickets/$($t.id)/actions" @{ action = "reopen" }
Check "reopen" ($re.status -eq "reopened")

Write-Host "== Requester record security + portal =="
$mine = Api $dana GET "/tickets"
$others = @($mine | Where-Object { $_.requesterEmail -ne "dana.lee@netlink.com" })
Check "requester sees only own tickets" ($others.Count -eq 0 -and ($mine | Measure-Object).Count -gt 0)
Check "requester blocked from ticket PATCH" (ApiFails $dana PATCH "/tickets/$($t.id)" @{ priority = "low" })
Check "requester blocked from audit" (ApiFails $dana GET "/audit")
Check "requester blocked from metrics" (ApiFails $dana GET "/metrics")
Check "requester blocked from KB write" (ApiFails $dana POST "/kb" @{ title = "x"; content = "y" })

$reply = Api $dana POST "/tickets/$($t.id)/messages" @{ body = "Thanks, seems stable now."; asRequester = $true }
Check "requester reply on own ticket" ([bool]$reply)
$fb = Api $dana POST "/tickets/$($t.id)/actions" @{ action = "feedback"; satisfaction = "satisfied" }
Check "CSAT feedback closes ticket" ($fb.status -eq "closed")

$cat = @(Api $dana GET "/catalog") | Where-Object { $_.requiresApproval } | Select-Object -First 1
$req = Api $dana POST "/intake" @{ channel = "portal"; subject = "E2E: laptop request"; body = "Standard model please."; requesterEmail = "dana.lee@netlink.com"; catalogItemId = $cat.id }
Check "portal request with approval item goes pending" ($req.status -eq "pending")

Write-Host "== Approvals (manager) =="
Check "agent cannot decide ticket approvals" (ApiFails $arjun POST "/tickets/$($req.id)/approvals" @{ decision = "approved" })
$dec = Api $meera POST "/tickets/$($req.id)/approvals" @{ decision = "approved" }
Check "manager approves service request" ($dec.status -ne "pending" -and $dec.status -ne "cancelled")

Write-Host "== Changes (CAB + lifecycle) =="
$chg = Api $priya POST "/changes" @{ title = "E2E: rotate wifi PSK"; description = "Scheduled security rotation."; type = "normal" }
Check "create change with AI risk" ($chg.riskScore -ge 0)
$sub = Api $priya POST "/changes/$($chg.id)/approvals" @{ op = "submit"; approvers = @(@{ id = "user_meera"; name = "Meera Nair" }) }
Check "submit for CAB" ($sub.status -eq "awaiting_approval")
Check "agent cannot CAB-approve" (ApiFails $arjun POST "/changes/$($chg.id)/approvals" @{ op = "decide"; approvalId = $sub.approvals[0].id; state = "approved" })
$app = Api $meera POST "/changes/$($chg.id)/approvals" @{ op = "decide"; approvalId = $sub.approvals[0].id; state = "approved" }
Check "manager CAB approval advances change" ($app.status -eq "approved")
foreach ($step in @("scheduled", "implementing", "review", "closed")) {
  $chg = Api $priya PATCH "/changes/$($chg.id)" @{ status = $step }
}
Check "lifecycle to closed" ($chg.status -eq "closed")

Write-Host "== Problems (RCA workflow) =="
$prb = Api $priya POST "/problems" @{ title = "E2E: recurring switch failures"; description = "Multiple port incidents."; impact = "medium"; urgency = "high"; category = "Network" }
Check "problem priority from matrix (M x H = high)" ($prb.priority -eq "high")
Api $priya POST "/problems/$($prb.id)/actions" @{ action = "link_incident"; ticketId = $t.id } | Out-Null
$pv = Api $priya GET "/problems/$($prb.id)"
Check "incident linked to problem" (($pv.linkedIncidents | Measure-Object).Count -ge 1)
$rca = Api $priya POST "/problems/$($prb.id)/actions" @{ action = "ai_root_cause" }
Check "AI root-cause suggestion" ($rca.rootCause.Length -gt 0)
Api $priya PATCH "/problems/$($prb.id)" @{ workaround = "Move affected users to switch B." } | Out-Null
$pub = Api $priya POST "/problems/$($prb.id)/actions" @{ action = "publish_workaround" }
Check "workaround published to KB (KEDB)" ([bool]$pub.publishedArticleId)
$rc = Api $priya POST "/problems/$($prb.id)/actions" @{ action = "raise_change" }
Check "raise change for permanent fix" ([bool]$rc.changeId)
Api $priya POST "/problems/$($prb.id)/actions" @{ action = "add_note"; body = "E2E note." } | Out-Null
Check "problem note added" $true

Write-Host "== Assets & CMDB =="
$ast = Api $priya POST "/assets" @{ tag = "E2E-0001"; name = "E2E Test Server"; type = "server" }
Check "asset created" ($ast.tag -eq "E2E-0001")
$ci1 = Api $priya POST "/cis" @{ name = "E2E App"; type = "application" }
$ci2 = Api $priya POST "/cis" @{ name = "E2E Database"; type = "database" }
Api $priya POST "/cis" @{ link = @{ sourceId = $ci1.id; targetId = $ci2.id } } | Out-Null
$imp = Api $priya GET "/cis/$($ci2.id)/impact"
Check "CI dependency + impact analysis" (($imp.dependents | Measure-Object).Count -ge 1)
$linkT = Api $priya PATCH "/tickets/$($t.id)" @{ ciIds = @($ci1.id) }
Check "ticket-CI link" ($linkT.ciIds -contains $ci1.id)

Write-Host "== Knowledge base CRUD + search =="
$art = Api $priya POST "/kb" @{ title = "E2E: reboot the test rig"; content = "Hold the button for ten seconds, then release."; category = "IT"; tags = @("e2e"); isPublic = $true }
Check "article created" ([bool]$art.id)
Api $priya PATCH "/kb/$($art.id)" @{ content = "Hold the power button for ten seconds, then release. Wait a minute." } | Out-Null
$hits = Api $priya GET "/kb/search?q=reboot%20test%20rig"
Check "vector search finds it" (@($hits.hits | Where-Object { $_.id -eq $art.id }).Count -ge 1)
Api $priya DELETE "/kb/$($art.id)" | Out-Null
Check "article deleted" $true

Write-Host "== Profile, notifications, settings, reporting =="
$me = Api $priya PATCH "/me" @{ bio = "E2E updated bio."; preferences = @{ emailNotifications = $true; desktopNotifications = $true; weeklyDigest = $false; mentionAlerts = $true } }
Check "profile + preferences saved server-side" ($me.bio -eq "E2E updated bio." -and $me.preferences.desktopNotifications)
$nf = Api $arjun GET "/notifications"
Check "notification feed (assignment/SLA emails visible)" (($nf.items | Measure-Object).Count -ge 1)
Api $arjun POST "/notifications" @{ op = "mark_read" } | Out-Null
$nf2 = Api $arjun GET "/notifications"
Check "mark-read clears unread badge" ($nf2.unread -eq 0)
$slas = Api $priya GET "/sla-policies"
Check "SLA policy table (5 priorities)" (($slas | Measure-Object).Count -eq 5)
$autos = @(Api $priya GET "/automations")
Api $priya PATCH "/automations/$($autos[0].id)" @{ enabled = $false } | Out-Null
Api $priya PATCH "/automations/$($autos[0].id)" @{ enabled = $true } | Out-Null
Check "automation toggle round-trip" $true
$met = Api $priya GET "/metrics"
Check "metrics incl. SLA compliance/backlog" ([bool]$met.slaCompliance -and [bool]$met.backlogByGroup)
$csv = Invoke-WebRequest -Uri "$BaseUrl/api/v1/reports?format=csv" -WebSession $priya -UseBasicParsing
Check "CSV report download" ($csv.Headers["Content-Type"] -like "text/csv*")
$aud = Api $priya GET "/audit?verify=1"
Check "audit chain verifies" ([bool]$aud.valid)

Write-Host "== Enterprise phase A-D surfaces =="
# API keys (admin) — create, authenticate with it, revoke.
$key = Api $priya POST "/api-keys" @{ name = "E2E smoke key"; role = "agent" }
Check "api key created (secret returned once)" ([bool]$key.key -and $key.prefix.StartsWith("nlk_"))
$viaKey = Invoke-RestMethod -Uri "$BaseUrl/api/v1/tickets" -Headers @{ Authorization = "Bearer $($key.key)" }
Check "bearer key authenticates" ($viaKey.ok -and ($viaKey.data | Measure-Object).Count -ge 1)
Api $priya DELETE "/api-keys/$($key.id)" | Out-Null
Check "api key revoked" $true

# Attachments — upload via multipart, list, download, delete.
$tmp = Join-Path $env:TEMP "e2e-attach.txt"
Set-Content -Path $tmp -Value "e2e attachment payload"
$curlOut = curl.exe -s -X POST "$BaseUrl/api/v1/tickets/$($t.id)/attachments" -F "file=@$tmp;type=text/plain" -H "Cookie: $(($priya.Cookies.GetCookies($BaseUrl) | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; ')" | ConvertFrom-Json
Check "attachment uploaded" ($curlOut.ok -and $curlOut.data[0].fileName -eq "e2e-attach.txt")
$attList = Api $priya GET "/tickets/$($t.id)/attachments"
Check "attachment listed" ((@(@($attList) | Where-Object { $_.id -eq $curlOut.data[0].id })).Count -eq 1)
$dl = Invoke-WebRequest -Uri "$BaseUrl/api/v1/attachments/$($curlOut.data[0].id)" -WebSession $priya -UseBasicParsing
Check "attachment downloads with attachment disposition" ($dl.StatusCode -eq 200 -and $dl.Headers["Content-Disposition"] -like "attachment*")
Api $priya DELETE "/attachments/$($curlOut.data[0].id)" | Out-Null
Check "attachment deleted" $true

# Business calendars + SLA policy link.
$cal = Api $priya POST "/calendars" @{ name = "E2E Calendar $(Get-Random)"; timezone = "Asia/Kolkata"; holidays = @("2026-12-25") }
Check "business calendar created" ([bool]$cal.id -and $cal.timezone -eq "Asia/Kolkata")
$pol5 = (Api $priya GET "/sla-policies") | Select-Object -Last 1
$polUpd = Api $priya PATCH "/sla-policies/$($pol5.id)" @{ calendarId = $cal.id }
Check "sla policy linked to calendar" ($polUpd.calendarId -eq $cal.id)
Api $priya PATCH "/sla-policies/$($pol5.id)" @{ calendarId = $null } | Out-Null
Api $priya DELETE "/calendars/$($cal.id)" | Out-Null
Check "calendar deleted (policy detached)" $true

# Group strategy + auto-assignment. Pick any group that has members and owns a
# category, so this stays correct as the seed's groups/categories evolve.
$grpAll = Api $priya GET "/groups"
$rrGrp = $grpAll | Where-Object { @($_.memberIds).Count -ge 1 -and @($_.categories).Count -ge 1 } | Select-Object -First 1
$gUpd = Api $priya PATCH "/groups/$($rrGrp.id)" @{ strategy = "round_robin" }
Check "group strategy patched" ($gUpd.strategy -eq "round_robin")
$rrCat = @($rrGrp.categories)[0]
$rrT = Api $dana POST "/tickets" @{ subject = "E2E RR probe"; body = "auto-assignment probe for the queue"; category = $rrCat; autoResolve = $false }
$rrView = Api $priya GET "/tickets/$($rrT.id)"
Check "round-robin auto-assigned an agent" ([bool]$rrView.assignee)

# Trends + OpenAPI + SSE.
$trend = Api $priya GET "/reports/trends?days=7"
Check "trends series (7 days)" ((@($trend) | Measure-Object).Count -eq 7)
$spec = Invoke-RestMethod -Uri "$BaseUrl/api/v1/openapi.json"
Check "openapi spec served" ($spec.openapi -like "3.1*")
$sse = curl.exe -s --max-time 3 -N "$BaseUrl/api/v1/events" -H "Cookie: $(($priya.Cookies.GetCookies($BaseUrl) | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; ')" 2>$null | Select-Object -First 1
Check "SSE stream emits connected frame" ("$sse" -like "*connected*")

# Slack webhook (unsigned accepted in demo mode; challenge echo).
$slackChallenge = Invoke-RestMethod -Uri "$BaseUrl/api/webhooks/slack" -Method Post -ContentType "application/json" -Body '{"type":"url_verification","challenge":"e2e-challenge"}'
Check "slack url_verification challenge echoed" ($slackChallenge.challenge -eq "e2e-challenge")

# Brevo inbound webhook mounted (active only when EMAIL_PROVIDER=brevo).
$brevoInfo = Invoke-RestMethod -Uri "$BaseUrl/api/webhooks/brevo" -Method Get
Check "brevo inbound webhook mounted" ($brevoInfo.source -eq "brevo")

Write-Host ""
Write-Host ("Result: {0} passed, {1} failed" -f $script:pass, $script:fail) -ForegroundColor $(if ($script:fail -eq 0) { "Green" } else { "Red" })
if ($script:fail -gt 0) { exit 1 }

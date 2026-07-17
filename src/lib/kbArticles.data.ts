import type { TicketCategory } from "../server/domain/models";

// =============================================================================
// Shared knowledge base content.
//
// Pure, dependency-free article data used by the server seed
// (src/server/data/seed.ts) to build the starter knowledge base.
// =============================================================================

export interface KbArticleSeed {
  title: string;
  content: string;
  category: TicketCategory;
  tags: string[];
}

export const KB_ARTICLES: KbArticleSeed[] = [
  // ================================================================= Access
  {
    title: "Reset your corporate password (self-service)",
    category: "Access",
    tags: ["password", "reset", "login", "credentials", "forgot"],
    content:
      "Open the self-service password reset portal at passwordreset.netlink.com and select 'Forgot password'. Enter your corporate email address and complete the multi-factor verification on your enrolled device. Choose a new password of at least 14 characters with upper case, lower case, a number and a symbol; it cannot match your previous five passwords. After resetting, sign out of all sessions and sign back in on each device. Update the saved password on your phone's email app and any mapped network drives, because stale saved passwords are the most common cause of immediate re-lockouts.",
  },
  {
    title: "Unlock a locked account",
    category: "Access",
    tags: ["locked", "lockout", "account", "unlock", "sign in"],
    content:
      "Accounts lock automatically after five failed sign-in attempts and unlock on their own after 15 minutes. To unlock sooner, use the self-service password reset portal, which clears the lockout even if you keep the same password flow. If the account shows as disabled rather than locked, it is usually an HR leave-of-absence or offboarding hold, and reinstatement needs HR approval. If you get locked out repeatedly, an old password saved on a phone, tablet or mapped drive is almost always retrying in the background, so update or remove it there.",
  },
  {
    title: "Enroll or reset multi-factor authentication (MFA)",
    category: "Access",
    tags: ["mfa", "2fa", "authenticator", "security", "lost phone"],
    content:
      "Go to your account security page and choose 'Security info' to manage MFA methods. To enroll, install the authenticator app on your phone and scan the QR code shown on screen. Always register at least two methods, for example the authenticator app plus a phone number, so a lost device does not lock you out. If you lost the phone with your authenticator, contact the service desk to revoke the old methods, then re-enroll on your new device. Generate backup codes from the same security page and store them somewhere safe.",
  },
  {
    title: "Request access to an application or shared drive",
    category: "Access",
    tags: ["access request", "permissions", "shared drive", "application", "role"],
    content:
      "Submit an access request in the Netlink Service Portal under 'Request Access', selecting the application or shared folder you need. Access is role-based: requests for standard tools are approved by your manager, while admin or production access also needs the system owner's sign-off. Provide a one-line business justification; requests without it are returned. Most approvals complete within one business day, and you will get an email when access is granted. Sign out and back in to the application for new permissions to take effect.",
  },
  {
    title: "SSH keys and developer access to internal systems",
    category: "Access",
    tags: ["ssh", "developer", "git", "key", "engineering"],
    content:
      "Generate a personal SSH key with `ssh-keygen -t ed25519 -C \"you@netlink.com\"` and protect it with a passphrase. Upload only the public key (the `.pub` file) to your developer profile in the Netlink Service Portal under 'SSH Keys'; never paste the private key anywhere. Rotate keys at least once a year, or immediately if a laptop is lost; the portal will revoke the old key once the new one is added. For shared service accounts used by CI, request a deploy key per repository rather than reusing a personal key. If `git push` fails with 'permission denied (publickey)', confirm your key is loaded with `ssh-add -l` and that it is registered against your account in the portal.",
  },
  {
    title: "Use a password manager and set up passkeys",
    category: "Access",
    tags: ["password manager", "passkey", "vault", "credentials", "security"],
    content:
      "Netlink provides a managed password manager — install it from the Netlink Portal and sign in with your corporate account so your vault syncs across devices. Store every work credential there rather than in browser autofill or a notes app, and use the built-in generator for long unique passwords. Where a site offers passkeys, prefer them: they replace passwords with a device-bound key and cannot be phished. Never share a password in chat or email; use the password manager's secure-share feature, which expires the link after viewing. If you leave the company, your vault is automatically deprovisioned, so keep personal logins in a separate personal vault.",
  },
  {
    title: "Request temporary privileged or admin access",
    category: "Access",
    tags: ["admin", "privileged", "elevation", "jit", "production"],
    content:
      "Standing admin rights are not granted; instead request just-in-time elevation in the Netlink Service Portal under 'Privileged Access'. Specify the system, the task and the time window you need — access is granted for that window only and revoked automatically when it expires. Production and security-tooling elevation requires the system owner's approval in addition to your manager's. All actions performed under elevated access are logged to the audit trail, so keep changes to what you requested. If you need recurring elevation for a routine job, ask for it to be automated through a service account instead of elevating a person repeatedly.",
  },
  {
    title: "Delegate mailbox or calendar access to a colleague",
    category: "Access",
    tags: ["delegate", "mailbox", "calendar", "shared", "assistant"],
    content:
      "To let a colleague manage your mail or calendar, open Outlook account settings and add them as a delegate with the permission level you intend — 'Editor' can create and respond, 'Reviewer' can only read. For a team inbox, request a shared mailbox through the portal rather than sharing your personal credentials, which is against policy. Delegated calendar access is the right way to let an assistant book meetings on your behalf. Remember to remove delegation when it is no longer needed, especially before you change roles. If a delegate sees 'access denied', the change can take up to an hour to replicate, or they may need to restart Outlook.",
  },
  {
    title: "Create and manage a shared team mailbox",
    category: "Access",
    tags: ["shared mailbox", "team inbox", "send as", "mailbox request", "owner"],
    content:
      "Request a shared mailbox in the Netlink Service Portal under 'Shared Mailbox', giving the address you want, its purpose and a named owner — the owner approves membership changes from then on. Members sign in with their own accounts; a shared mailbox has no password of its own and sharing one would breach policy. Once added, the mailbox appears in Outlook automatically within an hour, or you can add it manually under account settings. Choose 'Send as' if replies should come from the team address, or 'Send on behalf' if the recipient should see who actually wrote. Keep membership current when people change teams — access reviews will flag stale members. Shared mailboxes over the size quota move older mail to the online archive automatically.",
  },
  {
    title: "Join, leave or create a distribution list",
    category: "Access",
    tags: ["distribution list", "email group", "membership", "dl", "mailing list"],
    content:
      "Distribution lists are managed by their owners: open the list in the Outlook address book to see the owner and ask them to add or remove you, or use the self-service Groups page where the list allows it. Company-wide and per-office lists are dynamic — membership comes from your HR record, so if you are on the wrong office list, fix your location in the HR system rather than asking IT. To create a new list, raise a request with the proposed name (the convention is dl-team-purpose), an owner and a one-line purpose. External senders are blocked by default; request an exception if a supplier needs to mail the list. Lists unused for 12 months are flagged to their owner and then retired.",
  },
  {
    title: "Service accounts and API tokens for integrations",
    category: "Access",
    tags: ["service account", "api token", "integration", "automation", "rotate"],
    content:
      "Automation and integrations must run under a service account, not a personal one — personal accounts break when the owner leaves or rotates MFA. Request one in the Netlink Service Portal under 'Service Account', naming the owning team, the system it touches and the access it needs; least privilege applies. API tokens issued to service accounts expire after 90 days by default, so put rotation in the team calendar and store the secret only in the approved vault, never in code, chat or a wiki. Use one account per integration so a single credential can be revoked without breaking everything else. Orphaned service accounts with no responding owner are disabled at the quarterly access review.",
  },
  {
    title: "Quarterly access reviews: what managers must do",
    category: "Access",
    tags: ["access review", "recertification", "compliance", "manager", "audit"],
    content:
      "Every quarter, managers receive an access review pack in the Netlink Service Portal listing each team member's application, share and privileged access. Approve or revoke every line within ten business days; anything left unreviewed is revoked automatically as a safety default. Pay particular attention to movers (people who changed roles and kept old access), leavers still showing entitlements, and accounts dormant for 90 days. Revoking is instant but re-requesting is easy, so when in doubt, remove — the cost of a wrong removal is minutes, the cost of stale access is an audit finding. Decisions are recorded and form part of the compliance evidence, so review honestly rather than bulk-approving.",
  },

  // ================================================================ Network
  {
    title: "Fix VPN connection problems",
    category: "Network",
    tags: ["vpn", "remote", "connection failed", "work from home"],
    content:
      "Open the VPN client installed from the Netlink Portal and confirm the portal address is vpn.netlink.com. Sign in with your corporate credentials and approve the multi-factor push notification within 60 seconds. If the status says 'connection failed', first check you are not on a captive Wi-Fi portal such as a hotel network; open a browser page to complete the Wi-Fi login, then reconnect the VPN. Toggling Wi-Fi off and on, or restarting the VPN client, resolves most stuck connections. The VPN session expires after 12 hours and requires you to authenticate again. If your home internet works but the VPN never connects, allow the VPN app through your operating system firewall settings.",
  },
  {
    title: "Connect to office Wi-Fi and printers",
    category: "Network",
    tags: ["wifi", "printer", "printing", "office", "network"],
    content:
      "Connect to the 'Corp' Wi-Fi network using your corporate username and password; the guest network does not allow printing or internal systems. To add a printer, open your system's 'Add Printer' dialog and select the queue named for your floor, for example FL3-North. Print jobs are held in the follow-me queue and released when you badge in at any enabled printer. If printing fails, confirm you are on the corporate network rather than guest Wi-Fi, then restart the print spooler or simply reboot. Report persistent Wi-Fi drops with your floor number and the nearest access point label so the network team can trace the right equipment.",
  },
  {
    title: "Guest Wi-Fi for visitors and personal devices",
    category: "Network",
    tags: ["guest wifi", "visitor", "personal device", "byod"],
    content:
      "Visitors and personal devices connect to the 'Guest' Wi-Fi network, not the 'Corp' network. Hosts can generate a 24-hour guest passcode from the lobby tablet or the Netlink Service Portal under 'Guest Access' — provide the visitor's name and email so the code is sent to them directly. Guest Wi-Fi only allows internet access; it cannot reach printers, file shares or internal apps, which is intentional. Multi-day visitors should request a week-long pass through the portal so they do not have to renew daily. Personal phones used for work email should still join Guest Wi-Fi rather than Corp, because the corporate network requires device management.",
  },
  {
    title: "Slow internet or specific service is unreachable",
    category: "Network",
    tags: ["slow", "internet", "latency", "unreachable", "outage"],
    content:
      "Start by checking the corporate status page at status.netlink.com; most 'site is slow' reports turn out to be a known incident already being worked on. If the status page is green, run a speed test from the affected device and a second device on the same network — if both are slow, the problem is local Wi-Fi or your internet service, not the application. Try a wired connection or restart your router. If only one service is slow, share the URL or app name with the service desk along with the time of the test; this lets the network team trace the right path. Persistent slowness from one office floor is usually an access-point load issue, so include your floor and the time-of-day pattern when reporting.",
  },
  {
    title: "Connect to the VPN on a mobile device",
    category: "Network",
    tags: ["vpn", "mobile", "phone", "ios", "android"],
    content:
      "Install the GlobalProtect app from the App Store or Google Play and enter the portal address vpn.netlink.com when prompted. Sign in with your corporate account and approve the MFA push on the same phone — if the push never arrives, open the authenticator app manually and enter the code. The phone must be enrolled in mobile device management first; if you see 'device not compliant', complete enrollment in the Netlink Portal app and retry. Battery optimisation can silently kill the VPN in the background, so exclude GlobalProtect from battery saver. Mobile VPN is intended for occasional access to internal apps, not for streaming, which will be throttled.",
  },
  {
    title: "Request a blocked website be unblocked",
    category: "Network",
    tags: ["web filter", "blocked site", "proxy", "allowlist", "category"],
    content:
      "If a site you need for work is blocked, note the full URL and the category shown on the block page, then open a 'Web Access' request in the Netlink Service Portal. Include a business reason; sites in security categories such as malware or anonymisers are not unblocked, but mis-categorised business tools usually are within a few hours. Personal-use categories (streaming, gaming, social) are blocked by policy on corporate networks and are not exceptions. While you wait, check whether the site works off the corporate network on a personal device to confirm it is a filter block rather than the site being down. Temporary, time-boxed exceptions can be granted for one-off vendor webinars.",
  },
  {
    title: "Wired Ethernet or desk port not working",
    category: "Network",
    tags: ["ethernet", "wired", "desk port", "no connection", "lan"],
    content:
      "First reseat both ends of the cable — at your dock or laptop and at the wall/floor port — and watch for the link light on the port. Try a known-good cable, since a bent or kinked cable is the most common cause. If the laptop connects over Wi-Fi but not Ethernet, the dock may need a firmware update from the Netlink Portal, or the dock's Ethernet needs to be selected as the active adapter. Note the desk number and the port label (often printed beside the socket) when reporting, so facilities can test the exact run. Hot-desking spots sometimes have inactive ports; the network team can patch them live if you provide the label.",
  },
  {
    title: "Fix DNS errors: site not found on corporate network",
    category: "Network",
    tags: ["dns", "site not found", "cannot resolve", "flush", "internal site"],
    content:
      "If a site shows 'server not found' or 'DNS_PROBE_FINISHED' while other sites work, flush the local resolver first: run `ipconfig /flushdns` on Windows or `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder` on macOS, then retry. Internal names such as intranet.netlink.com only resolve on the corporate network or over the VPN, so check your VPN status before reporting an internal site as down. Do not hard-code public DNS servers like 8.8.8.8 on a corporate device — it breaks internal resolution and the setting will be reverted by policy. If one specific site fails for you but works for a colleague on the same network, capture the output of `nslookup <hostname>` in your ticket; it tells the network team exactly which resolver answered. Newly created internal names can take up to an hour to propagate.",
  },
  {
    title: "Request a firewall rule or open a port",
    category: "Network",
    tags: ["firewall", "port", "rule", "allow", "connectivity"],
    content:
      "Applications that need to reach an internal system on a non-standard port require a firewall request: open 'Firewall Change' in the Netlink Service Portal with the source (device or subnet), destination host, port and protocol, and the business reason. Rules are reviewed by the network security team and standard requests are implemented within two business days; anything exposing a service to the internet needs a security review first. Test connectivity precisely before raising the request — `Test-NetConnection <host> -Port <n>` on Windows or `nc -vz <host> <port>` on macOS shows whether the block is on the network or in the application. Time-boxed rules are available for vendor demos and expire automatically. Never work around a firewall with tunnelling tools; that triggers a security incident.",
  },
  {
    title: "Video calls keep freezing or dropping: network checklist",
    category: "Network",
    tags: ["video call", "freezing", "jitter", "bandwidth", "quality"],
    content:
      "Choppy or frozen video is nearly always the local network. Move closer to the Wi-Fi access point or switch to a wired connection through your dock — Ethernet removes the majority of call-quality complaints. Pause large downloads, cloud backups and streaming on your machine and others sharing your connection during important calls. Turning off incoming video reduces bandwidth by more than half if the link is marginal, and the call apps do this automatically when they detect congestion. In the office, report the room or desk location and the time — access points log per-client statistics the network team can check. Working from home, reboot your router if calls degrade after days of uptime, and prefer the 5 GHz band over the crowded 2.4 GHz one.",
  },
  {
    title: "Working abroad or on the road: connectivity guide",
    category: "Network",
    tags: ["travel", "roaming", "hotspot", "abroad", "connectivity"],
    content:
      "Before travelling, confirm your working-abroad approval with HR, then test the VPN from your phone's hotspot — hotel and conference Wi-Fi frequently blocks VPN ports, and a mobile hotspot is the reliable fallback. Corporate SIMs have roaming enabled in most countries; check the covered list in the portal and request a travel data pack for anywhere outside it. In countries where the VPN is restricted, some internal systems will be unreachable by design — plan around the offline copies you are permitted to take, and never use unapproved VPN apps to bypass local restrictions. Use the same security habits as any public network: VPN always on, no certificate-warning click-through, privacy screen in shared spaces. If connectivity is business-critical for the trip, borrow a travel router or portable hotspot from the IT desk before you leave.",
  },

  // =============================================================== Software
  {
    title: "Set up work email on your phone",
    category: "Software",
    tags: ["email", "mobile", "outlook", "phone", "sync"],
    content:
      "Install the Outlook app from the App Store or Google Play and add your corporate email address. Choose 'Office 365' as the account type when prompted and sign in with your corporate password plus MFA approval. Company policy requires the device to be enrolled in mobile device management before mail will sync; if you see 'access blocked', open the Netlink Portal app and complete enrollment first. Calendar and contacts sync automatically once mail starts flowing. Personal mail profiles are not affected by enrollment, and Netlink can only manage the work profile.",
  },
  {
    title: "Install approved software from the Netlink Portal",
    category: "Software",
    tags: ["software", "install", "application", "company portal", "license"],
    content:
      "Open the Netlink Portal app on your managed device and browse the Apps catalog. Click 'Install' on the application you need; most apps install silently within a few minutes and may require a restart to appear. Software that is not in the catalog needs a software request approved by your manager, including license cost if any. Do not download installers from the public internet onto a corporate device, as this violates the endpoint security policy and the install will be blocked. If an installation hangs, restart the machine and retry from the Portal before raising a ticket.",
  },
  {
    title: "Fix single sign-on (SSO) and browser sign-in issues",
    category: "Software",
    tags: ["sso", "browser", "sign in loop", "session", "cookies"],
    content:
      "If a web app keeps bouncing you back to the sign-in page, the cause is usually a stale browser session. Sign out of the app, then clear cookies for that site or open a private/incognito window and sign in again. Make sure you pick your corporate account rather than a personal account on the account chooser screen. Browser extensions that block trackers can break the SSO redirect, so allowlist your identity provider's domain. If the error mentions 'your account does not have access', the app needs an access request rather than a sign-in fix, so submit one through the Netlink Service Portal.",
  },
  {
    title: "Fix Slack and Teams chat, calls and notifications",
    category: "Software",
    tags: ["slack", "teams", "chat", "calls", "notifications"],
    content:
      "If chat messages are not arriving in real time, first check whether you are signed in to the correct workspace or tenant — multi-account switchers often drop you into a personal one. Quit and relaunch the desktop app, which forces a re-sync; reloading the in-app workspace (Ctrl/Cmd+R) often clears stuck threads too. For missing notifications, confirm the app has notification permission in your operating system settings and that Do Not Disturb is off in both the app and the system. Call quality problems are almost always network related: switch from Wi-Fi to a wired connection, or close large downloads and video streams. If audio sounds robotic for everyone, leave and rejoin the call so the client renegotiates codecs.",
  },
  {
    title: "Supported browsers and browser compatibility",
    category: "Software",
    tags: ["browser", "chrome", "edge", "safari", "compatibility"],
    content:
      "Internal web apps are tested against the two most recent stable releases of Chrome and Edge, plus the current Safari on macOS. Firefox is supported on a best-effort basis. Update your browser regularly through the Netlink Portal — outdated browsers are the cause of most 'this page won't load' or 'unsupported feature' messages. Disable experimental browser flags before reporting an app bug, as they regularly break SSO and file uploads. Internet Explorer and other unsupported browsers are blocked at the proxy and will show a generic error rather than the app's own error page.",
  },
  {
    title: "Fix Outlook stuck offline or not sending mail",
    category: "Software",
    tags: ["outlook", "offline", "not sending", "stuck", "sync"],
    content:
      "If Outlook shows 'Working Offline' or 'Disconnected' at the bottom, open the Send/Receive tab and make sure 'Work Offline' is not toggled on. Confirm your internet and, off-site, your VPN are connected, then click 'Send/Receive All Folders' to force a sync. Mail stuck in the Outbox is usually a large attachment over the 25 MB limit — share a cloud link instead, or an item with an invalid recipient that needs deleting. If the whole profile is wedged, close Outlook and reopen it holding the reset option, or clear the local cache by recreating the account under File > Account Settings. The web version at outlook.office.com is a quick way to confirm mail is flowing while you fix the desktop app.",
  },
  {
    title: "Recover deleted files from OneDrive or SharePoint",
    category: "Software",
    tags: ["onedrive", "sharepoint", "recover", "deleted", "restore", "version"],
    content:
      "Deleted files go to the OneDrive or SharePoint Recycle Bin and are recoverable for 93 days — open the site in a browser, click 'Recycle bin', select the items and choose 'Restore'. To recover an earlier version of a file that still exists, right-click it and choose 'Version history', then restore the version you want. If you emptied the recycle bin, there is a second-stage recycle bin retained for site administrators, so raise a ticket promptly with the file name and approximate deletion date. Files only ever saved to the laptop's local desktop are not backed up unless that folder is set to sync, so keep work in the synced OneDrive folders. Ransomware or mass-deletion events can be rolled back to a point in time by the service desk.",
  },
  {
    title: "Share files securely with people outside Netlink",
    category: "Software",
    tags: ["external sharing", "share", "link", "secure", "guest"],
    content:
      "Share work files using a OneDrive or SharePoint link rather than email attachments, so access can be revoked and tracked. Click 'Share', set the audience to 'Specific people', enter the external email, and choose 'view' unless they genuinely need to edit. For sensitive content, enable an expiry date and a password on the link, and avoid 'Anyone with the link'. External recipients verify with a one-time code, so they do not need a Netlink account. If sharing is blocked, the file or library may be classified as confidential, which restricts external access by policy — request an exception with a business justification.",
  },
  {
    title: "Set an out-of-office automatic reply",
    category: "Software",
    tags: ["out of office", "automatic reply", "vacation", "ooo", "away"],
    content:
      "In Outlook, go to File > Automatic Replies (or Settings > Automatic replies on the web), turn them on, and set the start and end dates so they switch off by themselves. Write separate messages for inside and outside the organisation; the external one should be brief and name a colleague to contact for urgent matters. Remember to set the same on Teams via your status message so chats get a heads-up too. If you manage a shared mailbox, set its automatic reply from the shared mailbox settings, not your own. Booking the leave in the HR system does not set your out-of-office automatically — they are separate steps.",
  },
  {
    title: "Activate Microsoft 365 / Office apps",
    category: "Software",
    tags: ["office", "microsoft 365", "activation", "license", "word", "excel"],
    content:
      "Office apps activate automatically when you sign in with your corporate account — open Word, go to Account, and confirm it shows 'Subscription Product' with your email. If you see 'Product Deactivated' or a yellow licence banner, sign out of all Office apps, restart, and sign back in with the work account (not a personal one). Activation needs an internet connection at least once every 30 days. If you have signed into Office with multiple accounts, remove the personal account from File > Account so it stops claiming the licence. Persistent activation loops usually mean your account is missing the licence assignment, which the service desk can confirm and apply.",
  },
  {
    title: "Schedule meetings, book rooms and delegate your calendar",
    category: "Software",
    tags: ["calendar", "meeting", "room booking", "scheduling", "delegate"],
    content:
      "Create a meeting in Outlook or Teams and use the Scheduling Assistant to find a time when attendees are free. Add a meeting room by clicking 'Room Finder' and filtering by building and capacity; the room auto-accepts if it is available. Always add a Teams link for hybrid attendees, even for in-person meetings. To let an assistant manage your calendar, add them as a delegate in account settings rather than sharing your password. If a recurring meeting's room keeps declining, the room may have a booking limit on recurring events — book it as single occurrences or ask facilities to extend the policy.",
  },
  {
    title: "Record a meeting and find the recording or transcript",
    category: "Software",
    tags: ["recording", "transcript", "teams", "meeting", "stream"],
    content:
      "In a Teams meeting, open the More menu and choose 'Record and transcribe'; participants are notified automatically, which is required by policy. The recording saves to the organiser's OneDrive (for non-channel meetings) or the channel's SharePoint, and a link appears in the meeting chat when processing finishes. Transcripts and AI recaps appear on the meeting's Recap tab once available. Recordings follow a retention policy and are deleted after the configured period, so download anything you need to keep. Do not record meetings that involve confidential HR or legal matters without explicit consent from all parties.",
  },
  {
    title: "Password-protect or encrypt a document",
    category: "Software",
    tags: ["encrypt", "password protect", "sensitivity label", "confidential", "document"],
    content:
      "For Office files, the preferred method is to apply a sensitivity label (Confidential or Highly Confidential) from the toolbar — this encrypts the file and travels with it even if forwarded. To add a simple password instead, use File > Info > Protect Document > Encrypt with Password, and share the password through a separate channel such as a phone call. Never email a file and its password together. For PDFs, use the corporate PDF tool's 'Protect' option rather than a random online site, which may retain your upload. If you receive a protected file you cannot open, ask the sender which label or password applies rather than trying to crack it.",
  },
  {
    title: "Reset an app that keeps crashing or won't load",
    category: "Software",
    tags: ["crash", "freeze", "reset", "cache", "reinstall"],
    content:
      "Start with the basics that fix most app crashes: fully quit the app (not just close the window), then reopen it, and if that fails, restart the laptop to clear memory. For web apps, hard-refresh with Ctrl/Cmd+Shift+R and try an incognito window to rule out a bad cached file or extension. For desktop apps, clearing the app's cache or signing out and back in resolves corrupted local data. If it still crashes, reinstall it from the Netlink Portal, which lays down a clean, approved copy. When raising a ticket, note the exact error, what you were doing, and whether it happens every time or intermittently — that difference points to very different causes.",
  },
  {
    title: "Operating system updates and restart policy",
    category: "Software",
    tags: ["updates", "patch", "restart", "windows update", "macos"],
    content:
      "Security and feature updates are pushed to managed devices through the Netlink Portal on a monthly cycle, with critical patches released as needed. You get a seven-day grace window to restart at a convenient time; after that the device schedules a forced restart outside your working hours, so restarting promptly is always the gentler option. Do not defer updates repeatedly — devices more than one patch cycle behind lose access to sensitive systems until they catch up, which shows as sudden 'device not compliant' errors. Updates download in the background and typically need 10-20 minutes of restart time; plug into power first. If an update loops or fails twice, stop retrying and raise a ticket with the error code so the endpoint team can push a repair.",
  },
  {
    title: "Fix Excel workbooks that are slow, locked or corrupted",
    category: "Software",
    tags: ["excel", "spreadsheet", "locked", "corrupted", "read only"],
    content:
      "If Excel says a workbook is 'locked for editing by another user', the file is genuinely open elsewhere or a stale lock remains — in SharePoint/OneDrive files, close it everywhere and the lock clears within minutes; co-authoring in the browser avoids locks entirely. For very slow workbooks, the usual causes are thousands of rows of stray formatting (Ctrl+End showing a far-off last cell), volatile formulas like OFFSET and INDIRECT recalculating constantly, or links to dead external workbooks under Data > Edit Links. Save a copy as .xlsx rather than legacy .xls, which also repairs many corruptions; File > Open > 'Open and Repair' handles the rest. Recover an earlier state through the file's Version History rather than mailing copies around. Workbooks used as multi-user 'databases' hit these limits by design — ask about moving that process to a proper list or app.",
  },
  {
    title: "Use company AI tools safely (approved AI policy)",
    category: "Software",
    tags: ["ai", "copilot", "chatgpt", "policy", "data protection"],
    content:
      "Use the AI tools provided in the Netlink catalog — the enterprise Copilot and the internal assistant — which are configured so prompts and files stay within the corporate tenant. Public AI tools must never receive Confidential or Highly Confidential information, customer data, source code, or anything covered by an NDA; assume whatever you paste leaves the company. AI output is a draft, not an authority: verify facts, figures and generated code before using them, and never present generated content as reviewed work without checking it. Label AI-assisted documents normally — the same classification rules apply as to any other content. Requests for new AI tools go through the standard software request with a security review; unapproved AI browser extensions are blocked because they read page content by design.",
  },
  {
    title: "Fix desktop notifications you are missing or drowning in",
    category: "Software",
    tags: ["notifications", "focus", "do not disturb", "alerts", "badges"],
    content:
      "If notifications never appear, check three layers in order: the app's own notification settings, the operating system's notification permission for that app, and Focus/Do Not Disturb schedules that silence everything at certain hours. Presenting a screen automatically suppresses banners, which is why you 'miss' messages during demos — they are in the notification centre afterwards. If you are drowning instead, tune at the source: in Teams set channel notifications to mentions-only, in Outlook disable the banner for every mail and rely on the badge, and route newsletters to folders with rules. Calendar reminders defaulting to 15 minutes can be changed per-event or in settings. A quiet-hours schedule aligned to your working pattern beats disabling notifications app by app.",
  },
  {
    title: "Add a signature and set email sending defaults",
    category: "Software",
    tags: ["signature", "email", "branding", "font", "defaults"],
    content:
      "Create your signature under Settings > Signatures in Outlook using the corporate template from the brand portal — name, role, team and phone, no inspirational quotes or large images, which trip spam filters. Set it for both new messages and replies. Signatures are per-device unless roaming signatures are enabled, so set it on the web client too, which mobile then inherits. While you are in settings, check your sending defaults: plain, readable font at 10-12pt, replies kept in thread, and 'Undo send' set to a 10-second delay, which quietly rescues mis-sent mail every week. External-recipient warnings are on by policy and cannot be disabled — they exist to catch the classic wrong-autocomplete mistake.",
  },

  // =============================================================== Hardware
  {
    title: "Request a replacement laptop or hardware repair",
    category: "Hardware",
    tags: ["laptop", "replacement", "repair", "broken", "hardware"],
    content:
      "For a failed or damaged device, open a 'Hardware Repair' ticket in the Netlink Service Portal describing the fault and whether the device powers on. IT will arrange a loaner laptop while yours is repaired or replaced, usually within two business days. Standard laptops, monitors, docks and headsets are pre-approved and ship within five business days; non-standard or high-cost items need manager and budget approval. Back up your files to the corporate cloud drive before handing over a device, as repairs may wipe local storage. Battery, keyboard and screen failures in the first three years are covered under warranty at no cost to your team.",
  },
  {
    title: "Meeting room projector and AV troubleshooting",
    category: "Hardware",
    tags: ["projector", "meeting room", "display", "hdmi", "no signal"],
    content:
      "If the room display shows 'no signal', first check the cable is seated firmly in your laptop and try the second HDMI or USB-C port. On the room control panel, select the input that matches the cable you are using. On your laptop, press the display shortcut to switch to duplicate or extend mode rather than internal-only. For wireless casting, join the same corporate Wi-Fi as the room system and use the room name shown on the screen. If the room system itself is frozen, hold its power button for ten seconds to restart; this takes about a minute. Report recurring faults with the room name so facilities can service the right equipment.",
  },
  {
    title: "Set up your monitor, dock and external peripherals",
    category: "Hardware",
    tags: ["monitor", "dock", "external display", "usb-c", "peripherals"],
    content:
      "Plug the dock's USB-C cable into your laptop, then connect monitors, keyboard, mouse and Ethernet to the dock — never daisy-chain monitors through other monitors unless the model explicitly supports it. If an external monitor is not detected, unplug all peripherals from the dock, reconnect only the monitor, and use the operating system's 'Detect displays' option. Set the correct display scaling so text is sharp: 100% on standard 1080p monitors and 125-150% on high-DPI panels. For dual monitors, drag the displays in the settings panel so their on-screen arrangement matches their physical layout — this fixes 'mouse jumps the wrong way' problems. Firmware updates for the dock are pushed through the Netlink Portal; install them if the dock disconnects randomly.",
  },
  {
    title: "Replace a faulty keyboard, mouse or headset",
    category: "Hardware",
    tags: ["keyboard", "mouse", "headset", "peripheral", "replacement"],
    content:
      "Standard keyboards, mice and headsets are stocked at the IT desk on each floor and can be swapped same-day during business hours — bring the faulty unit so it can be marked for recycling. For wireless peripherals, first try a fresh set of batteries and re-pair the device; most 'mouse stopped working' tickets are battery-related. If a USB device is not detected on any port, the device is faulty; if it works on another laptop, the problem is the dock or laptop port and should be raised as a hardware ticket. Premium or ergonomic peripherals (vertical mice, mechanical keyboards, noise-cancelling headsets) need an accommodations request supported by a one-line justification. Hand back the old hardware so the asset register stays accurate.",
  },
  {
    title: "Laptop won't power on or won't charge",
    category: "Hardware",
    tags: ["won't turn on", "charging", "battery", "power", "dead"],
    content:
      "If the laptop is completely dead, plug in the official charger and leave it for 15 minutes before trying again — a fully drained battery needs time before it will respond. Confirm the charger's light is on and try a different known-good outlet and cable, since chargers fail more often than laptops. A hard reset clears most no-boot states: hold the power button for 10 seconds, release, then press it once to start. If it powers but the screen stays black, connect an external monitor to check whether it is a display or a boot problem. If none of this works, raise a 'Hardware Repair' ticket noting any lights, sounds or error codes, and request a loaner so you are not blocked.",
  },
  {
    title: "Laptop is slow, hot, or the fan is loud",
    category: "Hardware",
    tags: ["slow", "overheating", "fan", "performance", "hot"],
    content:
      "Open Task Manager (Windows) or Activity Monitor (macOS) and sort by CPU and memory to see what is driving the load — browser tabs, video calls and sync clients are common culprits. Restart the machine if it has been on for many days; uptime of weeks is the most common cause of gradual slowdowns. Make sure vents are not blocked by a soft surface, and that pending updates from the Netlink Portal are installed, as updates often include performance fixes. If a single process is pinned at 100% with no obvious reason, note its name in a ticket. Consistent slowness on an older device may mean it is due for a refresh, which the service desk can check against the asset lifecycle.",
  },
  {
    title: "Free up disk space on your laptop",
    category: "Hardware",
    tags: ["disk space", "storage", "full", "cleanup", "temp"],
    content:
      "Empty the Recycle Bin/Trash and the Downloads folder first — these quietly accumulate gigabytes. Move large personal-but-work files into OneDrive and enable Files On-Demand so they live in the cloud and free local space. Use the built-in Storage settings (Windows Storage Sense or macOS 'Manage Storage') to clear temporary files, old system updates and app caches. Old Teams and browser caches are safe to clear and often recover several gigabytes. If you are still short on space after cleanup, your role may need a larger-capacity device; raise a ticket with a screenshot of the storage breakdown rather than deleting system files manually.",
  },
  {
    title: "Webcam or microphone not working in calls",
    category: "Hardware",
    tags: ["webcam", "microphone", "camera", "audio", "calls"],
    content:
      "First check the app's own device settings (in Teams or Zoom) and select the correct camera and microphone, since the app often defaults to the wrong one when a dock is connected. Confirm the operating system has granted camera and microphone permission to the app under Privacy settings. A physical privacy shutter or a hardware mute button on a headset is a frequent cause of 'camera is black' or 'no one can hear me'. Close other apps that may be holding the camera, then fully restart the meeting app. If the device is missing entirely from the list, reconnect it directly to the laptop rather than the dock to isolate the fault.",
  },
  {
    title: "Set up your new laptop on first boot",
    category: "Hardware",
    tags: ["new laptop", "first boot", "setup", "autopilot", "enroll"],
    content:
      "Connect to Wi-Fi or Ethernet when prompted and sign in with your corporate email and temporary password — the device enrolls automatically and begins installing your role's apps in the background, which can take 30-60 minutes. Set up MFA when asked, and let the machine finish provisioning before installing anything yourself. Your files are not copied automatically; sign in to OneDrive and let it sync, and re-add any mapped drives. Standard apps arrive through the Netlink Portal; if something specific to your team is missing after an hour, install it from the Portal or raise a ticket. Keep the old device until your new one is fully working, then return it to the IT desk so it can be wiped and recycled.",
  },
  {
    title: "Printer shows offline, jams or prints badly",
    category: "Hardware",
    tags: ["printer", "offline", "jam", "toner", "print quality"],
    content:
      "A printer showing 'offline' on your laptop usually means your machine lost the queue, not that the printer is down — remove and re-add the follow-me queue from 'Add Printer', or restart the print spooler, and check the printer's own screen for errors. For paper jams, open only the doors the printer's display tells you to and pull paper in the direction of travel, never backwards, which tears it and leaves fragments. Streaky or faded pages mean toner or drum: shake the toner gently for an immediate improvement and log a consumable request so facilities swaps it properly. Never buy toner directly — cartridges are stocked and fitted under the print contract. Include the printer's asset label (on the front) in any ticket so the right device is serviced.",
  },
  {
    title: "Battery draining fast: laptop power tuning",
    category: "Hardware",
    tags: ["battery", "power", "drain", "energy", "unplugged"],
    content:
      "Check what is eating the battery under Settings > Power (Windows 'Battery usage' or macOS 'Battery') — browsers with dozens of tabs, video calls and stray background apps dominate the list. Lower screen brightness a notch, enable the power-saver profile when unplugged, and close apps you are not using rather than minimising them. External devices drain too: unplug from the dock's peripherals when running on battery. Batteries are consumables — capacity below 80% of design after a few years is normal and qualifies for a warranty swap, which the Netlink Portal shows under your device's health tab. Sudden overnight drain after an update is usually one app misbehaving; restart first, then check the usage list again before booking a repair.",
  },
  {
    title: "Return, recycle or donate old IT equipment",
    category: "Hardware",
    tags: ["return", "recycle", "disposal", "asset", "e-waste"],
    content:
      "All corporate equipment must come back to the IT desk when replaced, when you change roles, or when you leave — even broken items, because the asset register and data destruction both depend on it. Devices are securely wiped to certified standards before reuse, resale or recycling; never dispose of a corporate device in regular e-waste yourself. Personal purchases through the employee discount scheme are yours and do not come back. Cables, keyboards and mice can go straight into the e-waste bins by the IT desk without a ticket. If you find unregistered equipment in a cupboard clear-out, hand it in with a note of where it was found so the register can be corrected — mystery assets fail audits.",
  },
  {
    title: "Request an ergonomic assessment and equipment",
    category: "Hardware",
    tags: ["ergonomic", "assessment", "chair", "standing desk", "accommodation"],
    content:
      "If you experience discomfort at your workstation, request an ergonomic assessment in the Netlink Service Portal under 'Workplace Adjustment' — a trained assessor reviews your setup in the office or over video for home offices. Common adjustments such as a monitor riser, external keyboard, vertical mouse or footrest are dispatched from stock without further approval. Chairs, standing desks and larger items follow the assessor's recommendation with team-budget sign-off. Medical accommodations are handled confidentially with HR and occupational health, and override standard equipment policy where recommended. Do not soldier on: musculoskeletal issues respond best to early adjustment, and the assessment is free to your team.",
  },

  // ===================================================================== HR
  {
    title: "Request PTO and time off",
    category: "HR",
    tags: ["pto", "vacation", "time off", "leave", "holiday"],
    content:
      "Submit time-off requests in the HR system under 'Absence', then 'Request Absence', ideally at least two weeks in advance for planned leave. Full-time employees accrue 1.5 PTO days per month, visible on your absence balance page. Requests route to your manager and you receive an email when approved or declined. Sick leave does not need advance notice but should be logged the same day. Up to five unused PTO days carry over into the next calendar year; anything beyond that is forfeited. Extended medical, parental or bereavement leave follows a separate process, so contact HR directly for those.",
  },
  {
    title: "Payslip, salary payment and tax document queries",
    category: "HR",
    tags: ["payslip", "salary", "payroll", "tax", "bank details"],
    content:
      "Payslips are published in the HR system under 'Pay' on the last working day of each month. Salaries are paid by bank transfer on the same day; if your payment has not arrived by the next morning, check that your bank details under 'Personal Information' are current before raising a payroll ticket. Update bank details at least five business days before payday for the change to apply in the same cycle. Annual tax documents appear in the same Pay section by the end of January. For questions about deductions or allowances, raise a confidential ticket with the payroll team rather than emailing figures around.",
  },
  {
    title: "Expense reimbursement and corporate card",
    category: "HR",
    tags: ["expense", "reimbursement", "corporate card", "receipt", "claim"],
    content:
      "Submit expenses in the expense system within 30 days of purchase, attaching an itemized receipt for every line. Approved reimbursements are paid into your salary bank account in the next payroll cycle. Meals while traveling are reimbursed up to the per-diem limit for your destination city. Travel costing more than 1,000 dollars needs pre-approval before booking. For a corporate card charge you do not recognize, file a dispute in the expense system and notify the finance team; do not contact the card issuer directly. Missing-receipt declarations are accepted at most twice per year for amounts under 25 dollars.",
  },
  {
    title: "New employee onboarding checklist (first week)",
    category: "HR",
    tags: ["onboarding", "new hire", "first day", "checklist", "starter"],
    content:
      "On day one, sign in with the temporary password from your welcome email and immediately enroll in multi-factor authentication. Complete the mandatory security and code-of-conduct training in the Learning portal within five business days. Set up direct deposit and tax forms in the HR system under 'Personal Information'. Your laptop and standard application access are provisioned automatically from your role profile; raise a ticket only if something is still missing after 24 hours. Ask your manager to add you to the right team channels and distribution lists, and book your benefits enrollment session before the end of your first month.",
  },
  {
    title: "Benefits enrollment and qualifying life events",
    category: "HR",
    tags: ["benefits", "insurance", "enrollment", "life event", "dependents"],
    content:
      "New hires have 30 days from their start date to choose health, dental and retirement benefits in the HR system under 'Benefits'. The annual open enrollment window runs each November; outside of it, you can only change elections if you have a qualifying life event such as marriage, divorce, the birth or adoption of a child, or a partner losing coverage. Report a life event within 30 days of the date it occurred and upload supporting documents (marriage certificate, birth certificate, prior-coverage letter) directly in the portal. Coverage for new dependents starts on the event date, not the form submission date, so submit promptly even if you are still gathering documents. Questions about specific plan coverage should go to the insurance provider's member services line, which is listed on your benefits card.",
  },
  {
    title: "Offboarding: your last working day checklist",
    category: "HR",
    tags: ["offboarding", "leaving", "resignation", "last day", "exit"],
    content:
      "Once your departure date is confirmed, HR opens an offboarding checklist that covers handover, asset return and final pay. Save any personal files you are entitled to keep before your last day, because access is removed automatically at end of day — work content stays with Netlink. Hand back your laptop, monitor, dock, badge and any other assets to the IT desk and get a return receipt. Your manager should reassign your tickets, shared mailboxes and document ownership before you leave so nothing is orphaned. Final pay, accrued PTO payout and benefits end dates are confirmed by HR; your tax documents remain available through the alumni portal.",
  },
  {
    title: "Update your personal details and emergency contacts",
    category: "HR",
    tags: ["personal details", "address", "name change", "emergency contact", "bank"],
    content:
      "Update your address, phone number, emergency contact and bank details yourself in the HR system under 'Personal Information' — keeping these current matters for payroll, benefits and safety. A legal name change requires supporting documentation uploaded in the portal, after which IT updates your email display name and accounts within a few days. Bank detail changes must be made at least five business days before payday to apply that cycle. Your emergency contact is used only in genuine emergencies and is not visible to colleagues. If your work location or country changes, raise it with HR separately, as it can affect tax, benefits and equipment.",
  },
  {
    title: "Work-from-home and hybrid working policy",
    category: "HR",
    tags: ["work from home", "hybrid", "remote", "policy", "wfh"],
    content:
      "Netlink operates a hybrid model; your team's specific in-office days are agreed with your manager and recorded in the HR system. When working from home, you are expected to be reachable during core hours, have a reliable internet connection, and use the VPN for internal systems. Home-office equipment such as a monitor or chair can be requested through the portal subject to your team's budget. Working from a different country, even temporarily, needs prior approval because of tax and security rules, so request it well in advance. Reimbursement for home internet or utilities, where offered, is defined in the regional policy document linked in the HR portal.",
  },
  {
    title: "Book business travel and get it approved",
    category: "HR",
    tags: ["travel", "booking", "flights", "hotel", "approval"],
    content:
      "Book flights, hotels and rail through the corporate travel tool so trips are within policy and trackable for duty-of-care. Trips over the approval threshold need manager sign-off before booking; the tool routes this automatically. Choose economy for short-haul and within the fare cap for long-haul unless your manager pre-approves an exception. Keep all receipts and submit them as expenses within 30 days of returning. For visa letters or international travel risk guidance, raise an HR ticket at least three weeks before departure, as some destinations require extra approval.",
  },
  {
    title: "Performance reviews and goal setting",
    category: "HR",
    tags: ["performance", "review", "goals", "appraisal", "feedback"],
    content:
      "Performance reviews run twice a year in the HR system; you will be prompted to complete a self-assessment before your manager's review. Set SMART goals at the start of each cycle and update progress as you go rather than all at once at the end. Continuous feedback can be requested from peers at any time through the 'Feedback' module. Ratings and any compensation outcomes are confirmed after calibration, which is why there is a gap between submitting and the final conversation. If you disagree with a review outcome, the policy includes an appeal route via HR business partners.",
  },
  {
    title: "Refer a candidate (employee referral program)",
    category: "HR",
    tags: ["referral", "hiring", "candidate", "bonus", "recruitment"],
    content:
      "Submit referrals through the 'Refer a Friend' section of the careers portal, attaching the candidate's CV and the role you are referring them for. Referral bonuses are paid after the new hire completes their probation period, and the amount depends on the role level. You cannot refer for roles where you are the hiring manager or in your direct reporting line. Keep the candidate informed that you have referred them, but recruitment will manage the process from there. Referrals are valid for 12 months, so a candidate who is a great fit for a future role still counts if they are hired later.",
  },
  {
    title: "Training, certifications and learning reimbursement",
    category: "HR",
    tags: ["training", "certification", "learning", "reimbursement", "course"],
    content:
      "Browse self-paced courses in the Learning portal, which are free to take any time. For external paid courses, conferences or certification exams, raise a 'Learning Request' with the cost and how it supports your role; approval is by your manager against the team's development budget. Certification exam fees are reimbursed on a pass, and often on a first attempt regardless of result for approved exams — check the policy. Submit receipts through the expense system after completion, referencing the approved request. Time spent on approved training during work hours is supported, but agree the schedule with your manager so cover is arranged.",
  },
  {
    title: "Parental, medical and bereavement leave",
    category: "HR",
    tags: ["parental leave", "medical leave", "bereavement", "maternity", "paternity"],
    content:
      "Extended leave types are handled confidentially by HR rather than the standard absence flow. For parental leave, notify HR as early as you can so pay, cover and your return-to-work plan can be arranged; eligibility and duration follow your regional policy. Medical leave beyond a few days may require a fit note, which you upload securely in the portal. Bereavement leave is granted compassionately and does not count against your PTO. In all cases, open a confidential HR ticket or contact your HR business partner directly — your manager only needs to know the dates, not the medical details.",
  },
  {
    title: "Timesheets, overtime and time-in-lieu",
    category: "HR",
    tags: ["timesheet", "overtime", "time in lieu", "hours", "billing code"],
    content:
      "Submit timesheets in the HR system by end of day Friday each week, booking hours against the correct project or billing code — your manager holds the current code list. Unsubmitted timesheets block project invoicing, so chasing emails escalate quickly after Monday. Overtime must be agreed with your manager before it is worked; approved overtime is either paid at the regional rate or taken as time-in-lieu within three months, whichever your contract specifies. On-call allowances are added automatically from the rota system and should not be entered manually. Correct a submitted timesheet by recalling it within the same month; older corrections need a payroll adjustment ticket.",
  },
  {
    title: "Apply for internal roles and team transfers",
    category: "HR",
    tags: ["internal mobility", "transfer", "vacancy", "career", "apply"],
    content:
      "All open roles are posted on the internal careers page before or alongside external advertising, and employees past probation can apply to any of them. Applications are confidential from your current manager until you reach the interview stage, at which point recruitment informs them as a courtesy — you are encouraged to have the conversation earlier. Interviews follow the same process as external hires, minus the culture screening. If you are successful, transfer dates are agreed between both managers, normally within four to eight weeks to allow handover. Your compensation is reviewed against the new role's band; a transfer is not automatically a raise. Unsuccessful internal candidates get feedback and it does not affect your standing in your current role.",
  },
  {
    title: "Probation reviews for new starters",
    category: "HR",
    tags: ["probation", "review", "new starter", "confirmation", "objectives"],
    content:
      "New employees have a six-month probation period with a light-touch check-in at month one, a mid-point review at month three and a confirmation review before the end of month six, all recorded in the HR system. Your manager sets three to five probation objectives in your first two weeks — if you have not seen yours, ask, because the reviews measure against them. Most probations confirm without ceremony; where there are concerns, they must be raised at the mid-point with specific examples and support, never for the first time at the final review. Probation can be extended once, by up to three months, with a written plan. Benefits and access are unaffected by probation status except where a specific policy notes otherwise.",
  },

  // ===================================================================== IT
  {
    title: "How to submit a good IT support ticket",
    category: "IT",
    tags: ["ticket", "support", "how to", "service desk", "request"],
    content:
      "Open a ticket in the Netlink Service Portal at helpdesk.netlink.com and pick the closest matching category — 'Access', 'Hardware', 'Software' or 'Other' — so it routes to the right team automatically. In the description, say what you were trying to do, what happened instead, and the exact error message (a screenshot is ideal). Include the device name, the application name and the time the problem started; these three details cut average resolution time roughly in half. One issue per ticket is the rule — multiple problems combined in one ticket take longer because they need to bounce between teams. You can reply to the ticket email or update it in the portal; new replies reset the SLA clock so the team sees there is movement.",
  },
  {
    title: "Service desk hours, channels and response times",
    category: "IT",
    tags: ["hours", "sla", "response time", "support channels", "after hours"],
    content:
      "The service desk is staffed Monday to Friday, 8am to 7pm in your local business region, and follows the sun for global coverage between regions. Standard response targets are: P1 (system-wide outage) within 15 minutes, P2 (major impact) within one hour, P3 (single user blocked) within four business hours, P4 (request or question) within one business day. Outside business hours, P1 incidents reach an on-call engineer through the same ticket — do not email individuals, as the rotation changes weekly. Live chat in the portal is the fastest channel during business hours; email and the portal form share the same queue. Phone is reserved for confirmed P1 incidents so the line stays clear.",
  },
  {
    title: "Report a major incident or system-wide outage",
    category: "IT",
    tags: ["incident", "outage", "p1", "major", "down"],
    content:
      "If a core service such as email, SSO, the VPN or a customer-facing system is completely down for many people, open a P1 ticket in the Netlink Service Portal and select 'Major Incident'. This pages the on-call team immediately rather than waiting in the standard queue. Provide a one-line impact summary, the approximate number of users affected, and at least one screenshot or error message. Updates are posted every 30 minutes to the corporate status page at status.netlink.com — direct anyone asking to that page rather than re-raising tickets. After the incident is resolved, a written post-incident review is published within five business days and is open to all employees. Do not attempt workarounds on production systems during a major incident without coordinating with the on-call lead.",
  },
  {
    title: "Check, reopen or escalate your ticket",
    category: "IT",
    tags: ["ticket status", "reopen", "escalate", "update", "follow up"],
    content:
      "Track any ticket in the Netlink Service Portal under 'My Tickets', where you can see its status, assigned team and full history. To add information, reply to the ticket email or post an update in the portal — both reset the SLA timer so the team knows it is active. If a ticket was resolved but the problem returns, reopen it within 14 days instead of raising a new one, so the history stays together; after 14 days it auto-closes and you should open a fresh ticket. To escalate, use the 'Escalate' button on the ticket and add why it is urgent (for example, a deadline or a growing number of affected people) rather than messaging engineers directly. Escalations are reviewed by a coordinator who can reprioritise across the queue.",
  },
  {
    title: "What each ticket status means",
    category: "IT",
    tags: ["status", "open", "pending", "resolved", "auto-resolved"],
    content:
      "Open means the ticket is in the queue waiting to be picked up or actively being worked. In Progress means an agent is on it now. Pending means it is waiting on you (for information or confirmation) or on a third party — replying moves it forward. Auto-resolved means the assistant answered it from the knowledge base and closed it before an agent was needed; if that answer did not help, reply and it reopens to a human. Resolved means a fix was delivered and the ticket will close automatically after a few days unless you reply, and Closed means it is complete. Escalated means it has been raised in priority and routed to a specialist or on-call engineer.",
  },
  {
    title: "Data backup: what is protected and how to restore",
    category: "IT",
    tags: ["backup", "restore", "data protection", "onedrive", "recovery"],
    content:
      "Anything stored in OneDrive, SharePoint and approved corporate systems is backed up and versioned automatically — this is why you should keep work there rather than only on the laptop's local drive. The Desktop, Documents and Pictures folders are set to sync to OneDrive on managed devices, so they are covered; files saved elsewhere on the local disk are not. To restore, use the recycle bin and version history first, and raise a ticket for anything older or already purged. Email is retained according to the retention policy and can be recovered within that window. Never rely on a personal USB drive or personal cloud account for work data, as those are neither backed up nor permitted for corporate information.",
  },
  {
    title: "Incident vs service request: which should you raise?",
    category: "IT",
    tags: ["incident", "service request", "difference", "itil", "raise"],
    content:
      "Raise an incident when something that used to work is broken or degraded — you cannot sign in, an app errors, the printer is down. Raise a service request when you need something new or routine — access to an application, a laptop for a starter, software installed, a guest Wi-Fi code. The distinction matters because incidents are prioritised by impact and urgency against restore-time targets, while requests follow fulfilment workflows that may include approvals. If you are unsure, pick your best guess and describe the situation clearly; the service desk reclassifies without penalty and nothing is lost. One practical tip: 'it is slow' is an incident, 'can I have more' (storage, licences, memory) is a request. Choosing well routes you to the right team on the first hop.",
  },
  {
    title: "How ticket priority is decided (impact x urgency)",
    category: "IT",
    tags: ["priority", "impact", "urgency", "p1", "matrix"],
    content:
      "Priority is not chosen directly — it is derived from impact (how widely the issue affects the business) and urgency (how quickly it needs restoring). High impact and high urgency produce P1 Critical, targeted for response in 15 minutes and resolution in 2 hours; the scale runs down to P5 Very Low for minor, non-time-sensitive items. This is why 'please make it urgent' without context does not change the queue, but 'the whole finance team cannot invoice and month-end is tomorrow' does — it raises both dimensions with evidence. Agents can override the derived priority with a documented justification, which is recorded in the audit trail. If circumstances change (more people affected, a deadline approaching), update the ticket so impact and urgency are re-evaluated.",
  },
  {
    title: "Request an IT change (change management basics)",
    category: "IT",
    tags: ["change", "change request", "cab", "maintenance window", "rollback"],
    content:
      "Modifications to production systems — new versions, configuration changes, infrastructure work — go through a change request in the Netlink Service Portal, not a normal ticket. Standard changes (pre-approved, low-risk, routine) are fast-tracked; normal changes are risk-assessed and approved by the change advisory board; emergency changes fix live incidents and are reviewed afterwards. Every change needs a description, a risk assessment, a rollback plan and a planned window, which should sit inside the published maintenance windows where possible. Linked incidents and problems should be referenced so the change closes them when it succeeds. Unauthorised changes are treated seriously because they are the leading cause of self-inflicted outages — when in doubt, raise the change and let the process decide how heavy it needs to be.",
  },
  {
    title: "Software licences: compliance, reuse and true-ups",
    category: "IT",
    tags: ["licence", "compliance", "software audit", "reclaim", "seat"],
    content:
      "Licensed software is assigned to you through the Netlink Portal, and the licence follows the person, not the machine — a replacement laptop keeps your entitlements automatically. Do not install licence keys found on the internet or reuse a colleague's sign-in; vendor audits reconcile installs against entitlements and unlicensed copies create real financial exposure. Licences unused for 60 days are flagged for reclaim and the app may be uninstalled after a warning, which is normal cost hygiene — request it again when you need it. Team leads can see their licence allocation and spend in the portal's software dashboard. Before buying anything new, check the catalog for an already-licensed equivalent; consolidation requests beat duplicate purchases.",
  },
  {
    title: "Personal data requests and privacy (GDPR) basics",
    category: "IT",
    tags: ["gdpr", "privacy", "data subject", "personal data", "dpo"],
    content:
      "Requests from customers or employees to access, correct or delete their personal data are data-subject requests with a legal clock — forward them to the privacy team via the 'Privacy Request' form the same day you receive them, and do not attempt to fulfil them yourself. The countdown starts when the request arrives anywhere in the company, not when the privacy team sees it. If you suspect personal data has been exposed — wrong recipient, lost device, misconfigured share — report it immediately as a security incident; breach notification deadlines are measured in hours, and early reports are always welcome. Collect only the personal data your process genuinely needs, keep it in approved systems, and follow the retention schedule rather than hoarding exports. The Data Protection Officer's contact details are on the privacy page of the intranet for anything ambiguous.",
  },

  // ================================================================ Security
  {
    title: "Report a lost or stolen device",
    category: "Other",
    tags: ["lost", "stolen", "device", "laptop", "phone"],
    content:
      "Report a lost or stolen corporate device within one hour of noticing it missing, even if you suspect you may have left it at home — early reporting limits exposure. Open a 'Lost or Stolen Device' ticket in the Netlink Service Portal or call the after-hours line if outside business hours. IT will remotely lock and, if needed, wipe the device; your synced cloud files remain safe. If the device is later found, do not power it on — return it to the IT desk so it can be reviewed before being reissued. File a police report for stolen devices and attach the report number to the ticket, as insurance and any replacement cost recovery depend on it. Change your corporate password from a different device immediately as a precaution.",
  },
  {
    title: "Report a phishing email or suspected security incident",
    category: "Other",
    tags: ["phishing", "security", "incident", "suspicious email", "report"],
    content:
      "If you receive a suspicious email, do not click links or open attachments. Use the 'Report Phishing' button in your mail client, which forwards the message with full headers to the security team and removes it from your inbox. If you already clicked a link or entered credentials, change your password immediately and open an 'Account Compromise' ticket in the Netlink Service Portal — the security team will revoke active sessions and check for follow-on activity. For other suspected incidents (unexpected MFA prompts, unknown sign-ins on your account activity page, unfamiliar applications appearing on your device), file a security incident ticket the same day. Do not discuss the suspected incident in public chat channels; use the dedicated security channel or direct message. Speed matters more than certainty — false alarms are welcomed, missed incidents are not.",
  },
  {
    title: "Building access, visitor badges and lost ID cards",
    category: "Other",
    tags: ["badge", "office access", "visitor", "lost id", "facilities"],
    content:
      "Tap your corporate badge on any reader to enter the office; the same badge releases follow-me print jobs. To bring a visitor, pre-register them in the lobby visitor portal the day before — this prints a badge and saves them queuing. If you lost your badge, report it through the Netlink Service Portal under 'Lost Badge' so the old one is deactivated immediately; collect a replacement from the lobby with photo ID. Tailgating into secure areas, even for colleagues, is against the security policy; ask them to badge in themselves so access is logged. Out-of-hours access needs manager approval logged in the portal at least 24 hours in advance, and security is notified automatically.",
  },
  {
    title: "Find your BitLocker or FileVault recovery key",
    category: "Other",
    tags: ["bitlocker", "filevault", "recovery key", "encryption", "locked"],
    content:
      "Corporate laptops are encrypted, and after a firmware update or hardware change the device may ask for a recovery key on boot. The key is stored against your device record — open the Netlink Portal from another device, find your device under 'My Devices', and copy the recovery key shown there. Enter it exactly, including dashes, and the laptop will boot and then usually stop asking. If you cannot reach the Portal, the service desk can read the key after verifying your identity. Never store the recovery key on the laptop itself or on a sticky note; it exists precisely to protect the data if the device is lost.",
  },
  {
    title: "Data classification and handling confidential information",
    category: "Other",
    tags: ["data classification", "confidential", "labels", "handling", "policy"],
    content:
      "Netlink classifies information as Public, Internal, Confidential or Highly Confidential, and you apply the matching sensitivity label when you create or save a document. Internal is the default for most work; Confidential and above must not be shared externally without approval and are encrypted by the label. Never put Confidential data into personal email, personal cloud storage, or unapproved AI tools. When in doubt, label up rather than down, and ask the data owner. Mishandling is far more often accidental (wrong recipient, public link) than malicious, so slow down on the share dialog and check the audience before sending.",
  },
  {
    title: "Work securely on public or home Wi-Fi",
    category: "Other",
    tags: ["public wifi", "home wifi", "security", "vpn", "travel"],
    content:
      "On any network you do not control — cafes, airports, hotels — connect the VPN before accessing work systems so traffic is encrypted end to end. Avoid networks with no password where possible, and never dismiss browser certificate warnings, which can indicate an intercepted connection. At home, secure your router with a strong unique password and keep its firmware updated; a guest network for smart-home devices keeps them off your work traffic. Do not let family members use your corporate laptop, and lock the screen whenever you step away. Treat shoulder-surfing as a real risk in public — a privacy screen filter is available from the IT desk for frequent travelers.",
  },
  {
    title: "Lock your screen and clean-desk basics",
    category: "Other",
    tags: ["screen lock", "clean desk", "security", "policy", "lock"],
    content:
      "Lock your screen every time you step away — Windows key + L, or Control + Command + Q on macOS — even for a minute; an unlocked, badged-in machine is the most common avoidable security gap. Devices auto-lock after a few minutes of inactivity, but that is a backstop, not a substitute. Follow the clean-desk policy by not leaving printed Confidential documents, badges or sticky-note passwords on your desk overnight. Use the secure print queue so sensitive documents only print when you are at the device. Shred physical documents in the secure bins rather than the recycling when you are done with them.",
  },
  {
    title: "Book a desk, locker or parking space",
    category: "Other",
    tags: ["desk booking", "hot desk", "locker", "parking", "facilities"],
    content:
      "Book desks through the workplace app up to two weeks ahead — pick your floor and neighbourhood, and check in by badging into the building or tapping the desk QR code within an hour of your slot or the booking releases. Team areas can be block-booked by managers for collaboration days. Lockers are requested in the same app; day lockers clear each evening, while permanent lockers depend on floor availability. Parking spaces are limited and allocated by the daily ballot in the app, with priority for accessibility needs and car-poolers; EV chargers are bookable in two-hour slots and the app fines no-shows with a temporary booking cool-down. Report broken desks, chairs or booking-app errors under Facilities in the Netlink Service Portal with the desk number printed on the surface.",
  },
  {
    title: "Deliveries, post and courier collections at the office",
    category: "Other",
    tags: ["post", "delivery", "courier", "mailroom", "shipping"],
    content:
      "Incoming post and parcels are received by the mailroom, logged, and announced to you by email with a shelf reference — collect within five working days, as space is limited. Personal deliveries are tolerated in moderation but the company accepts no liability for them; large personal items may be refused at the dock. For outgoing business shipments, book a courier through the mailroom portal with the cost-centre code, choosing tracked services for anything valuable or confidential — never post corporate hardware without the IT desk preparing it first. International shipments need a customs description and value, which the mailroom can help draft. Urgent same-day couriers require manager approval attached to the booking.",
  },
  {
    title: "First aid, fire wardens and emergency procedures",
    category: "Other",
    tags: ["emergency", "first aid", "fire", "evacuation", "safety"],
    content:
      "First aiders and fire wardens for each floor are listed on the safety noticeboard by the lifts and on the intranet's safety page; their badges have a green cross or an orange stripe. For medical emergencies, call the local emergency number first, then reception so responders are met at the door — defibrillators are mounted by reception on every floor. On the fire alarm, leave by the nearest stairwell, never the lifts, and assemble at the marked point across the street; wardens sweep the floor, so tell them if a colleague needs assistance evacuating. Report accidents and near-misses in the safety portal within 24 hours, however minor — trend data drives fixes. Personal emergency evacuation plans are arranged confidentially through HR for anyone needing one.",
  },

  // ================================================================ Billing
  {
    title: "Understand your monthly invoice and line items",
    category: "Billing",
    tags: ["invoice", "bill", "charges", "line items", "monthly"],
    content:
      "Invoices are generated on the first of each month and emailed to the billing contact on the account; you can also download them from the billing portal under 'Invoices'. The base subscription line covers your plan tier for the current month; usage lines show any metered services consumed in the previous month, which is why the total can vary. Discounts and credits appear as negative lines below the subtotal. Tax is calculated based on the billing address on file — update it before the first of the month if you have moved jurisdictions. If a charge looks wrong, do not pay around it: open a billing query in the portal with the invoice number and the disputed line, and the team will issue a corrected invoice if needed.",
  },
  {
    title: "Update billing email, address and payment method",
    category: "Billing",
    tags: ["billing email", "payment method", "card", "address", "update"],
    content:
      "Sign in to the billing portal and open 'Billing Settings' to change the contact email, postal address or payment method. The billing email is where invoices, payment receipts and dunning notices are sent — set it to a shared mailbox such as accounts-payable@netlink.com so changes in staff do not interrupt payments. New cards take effect on the next billing cycle; to use a new card immediately, pay the open invoice manually after adding it. For ACH or wire transfer setup, contact billing support — these methods require a one-time verification deposit. Always keep at least one backup payment method on file to avoid service interruption if the primary card expires.",
  },
  {
    title: "Request a refund or service credit",
    category: "Billing",
    tags: ["refund", "credit", "downgrade", "cancel", "prorate"],
    content:
      "Refund and credit requests are reviewed case-by-case; open a billing ticket with the invoice number, the amount in question and a one-sentence reason. Refunds for cancellations are prorated by day for monthly plans and not issued on annual prepaid plans, but unused months can usually be converted to a service credit. Approved credits appear on your next invoice as a negative line rather than a cash refund unless the account is closing. Charges resulting from an outage covered by the SLA are credited automatically — you do not need to ask. Allow up to 10 business days for refunds to land on the original card; ACH refunds can take up to 15 business days depending on your bank.",
  },
  {
    title: "Upgrade, downgrade or cancel your plan",
    category: "Billing",
    tags: ["upgrade", "downgrade", "cancel", "plan", "subscription"],
    content:
      "Change your plan in the billing portal under 'Subscription' — upgrades take effect immediately with a prorated charge for the rest of the cycle, while downgrades take effect at the next renewal so you keep what you paid for. Cancelling stops the next renewal but does not refund the current period; your data is retained for 30 days after the period ends in case you reactivate. Annual plans can be changed at renewal, or mid-term by contacting billing support for a tailored quote. Before downgrading, check the feature and seat limits of the lower tier so you do not lose access you rely on. Account closure with data export is handled by support to make sure nothing is lost.",
  },
  {
    title: "Set up purchase orders and net payment terms",
    category: "Billing",
    tags: ["purchase order", "po", "net terms", "procurement", "invoice"],
    content:
      "If your organisation pays by purchase order, add the PO number in 'Billing Settings' so it prints on every invoice; invoices without a required PO are often delayed by accounts-payable teams. Net payment terms (such as Net 30) are available on annual plans above a spend threshold and are arranged through billing support with a short credit check. Send remittance advice to the address on the invoice so payments are matched promptly. If a PO is running low, update it before it is exhausted to avoid a billing hold. For tax-exempt organisations, upload your exemption certificate in the portal so tax is removed from future invoices.",
  },
  {
    title: "Add, remove or reassign licensed seats",
    category: "Billing",
    tags: ["seats", "licence", "add user", "reassign", "subscription"],
    content:
      "Seat counts are managed in the billing portal under 'Subscription > Seats'. Adding seats mid-cycle bills a prorated amount immediately and the new capacity is usable within minutes; removing seats takes effect at the next renewal, so plan reductions before the renewal date. Reassigning a seat from a leaver to a joiner is free and instant — deactivate the old user first so their content is preserved and transferable to the new owner. Seat usage reports in the portal show who has not signed in for 60 days, which is the standard hygiene list before adding more seats. Enterprise agreements with committed seat bands should route additions through your account manager to stay inside the negotiated rate.",
  },
  {
    title: "Failed payments, dunning notices and service holds",
    category: "Billing",
    tags: ["failed payment", "dunning", "overdue", "card declined", "suspension"],
    content:
      "When a payment fails, the system retries automatically on day 3 and day 7 and emails the billing contact each time — most failures are an expired card or a bank fraud block, so update the card or approve the transaction with your bank, then click 'Retry payment' on the invoice to settle immediately. Accounts unpaid after 14 days enter a grace period with banner warnings; after 30 days the subscription is placed on a service hold, which is read-only rather than deletion. Data is retained throughout the hold and for 30 days after cancellation. If an invoice is disputed, tell billing support before the due date so dunning is paused on the disputed line while the remainder is paid normally. Finance teams can subscribe additional recipients to payment notices under Billing Settings so a single absent mailbox never causes a hold.",
  },
];

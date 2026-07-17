// =============================================================================
// generate-test-plan.mjs
//
// Generates qa/Netlink-Support-Manual-Test-Plan.xlsx — a manual (human-run)
// UI test plan for the Netlink Support ITSM app.
//
// Dependency-free: writes the Office Open XML (SpreadsheetML) parts by hand and
// packages them into a valid .xlsx using a tiny built-in ZIP writer (STORED /
// uncompressed entries + CRC-32). No npm packages required.
//
// Run:  node qa/generate-test-plan.mjs
// =============================================================================

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(HERE, "Netlink-Support-Manual-Test-Plan.xlsx");
const SHEET_NAME = "Manual Test Cases";

// -----------------------------------------------------------------------------
// Test-case data model
//
//   add(section, title, steps, expected, priority)
//     steps    : string[]  -> auto-numbered "1. ... / 2. ..."
//     expected : string | string[]  (arrays render as "- " bullet lines)
//     priority : "High" | "Medium" | "Low"
//
// TC IDs are assigned automatically in array order (TC-001, TC-002, ...).
// The Status column is left blank for the tester to fill with one of:
//   Pass / Fail / Skip / Block
// -----------------------------------------------------------------------------

const cases = [];
const add = (section, title, steps, expected, priority = "Medium") =>
  cases.push({ section, title, steps, expected, priority });

// ------------------------------ Setup & Environment --------------------------
add(
  "Setup & Environment",
  "Start the app in demo (zero-infra) mode",
  ["Open a terminal in the project root.", "Run: npm install", "Run: npm run dev", "Open http://localhost:3000 in a browser."],
  ["App boots and seeds itself on first run.", "Unauthenticated visit redirects to /signin."],
  "High"
);
add(
  "Setup & Environment",
  "Seeded demo accounts reference (no password needed)",
  [
    "Use any of these seeded emails on /signin (demo mode = passwordless).",
    "super_admin: vikram.rao@netlink.com",
    "tenant_admin: priya.sharma@netlink.com",
    "manager: meera.nair@netlink.com",
    "agent: arjun.mehta@netlink.com (also sarah.johnson, luis.moreno, anita.desai)",
    "requester: dana.lee@netlink.com (also sam.patel, ravi.kumar, emily.chen)",
  ],
  ["Reference only. Each listed email signs in as the stated role."],
  "Low"
);

// ------------------------------ Authentication & Session ---------------------
add(
  "Authentication & Session",
  "Demo email sign-in as agent",
  ['Open /signin.', 'In the "Work email" field type arjun.mehta@netlink.com.', 'Click "Continue".'],
  ['Button shows "Signing in..." then lands on Home (/).', "Agent workspace rail is shown (Home, Tickets, Problems, Changes, etc.)."],
  "High"
);
add(
  "Authentication & Session",
  "Quick demo identity card sign-in",
  ["Open /signin.", 'Under "Quick demo identities", click a card (e.g. Dana Lee - Requester).'],
  ["Signs in as that user without typing an email.", "Requester lands on My Requests (/tickets)."],
  "Medium"
);
add(
  "Authentication & Session",
  "Sign in as each role and verify workspace",
  ["Sign in one at a time as requester, agent, manager, tenant_admin, super_admin."],
  ["Requester gets the Self-Service Portal chrome.", "agent/manager/tenant_admin/super_admin get the agent workspace.", "Triage nav appears only for manager/tenant_admin/super_admin."],
  "High"
);
add(
  "Authentication & Session",
  "Sign out clears the session",
  ["Open the user menu (avatar, top-right).", 'Click "Sign out".', "After redirect, manually visit / again."],
  ['Redirected to /signin.', "Visiting a protected route now redirects back to /signin (session cleared)."],
  "High"
);
add(
  "Authentication & Session",
  "Non-seeded email is rejected",
  ["Open /signin.", "Type notarealuser@example.com in Work email.", 'Click "Continue".'],
  ["Sign-in fails; no session is created; user stays on /signin."],
  "Medium"
);
add(
  "Authentication & Session",
  "SSO button visibility in demo mode",
  ["Open /signin and observe the card."],
  ['"Sign in with Microsoft" appears only when Entra ID is configured.', 'In demo mode the email field, quick identities, and help text "Demo credentials - any seeded email works." are shown.'],
  "Low"
);
add(
  "Authentication & Session",
  "Sign-in page has no app chrome",
  ["Visit /signin."],
  ["No left sidebar, TopBar, or mobile drawer is rendered - it is a standalone full-height page."],
  "Low"
);

// ------------------------------ Navigation & App Shell -----------------------
add(
  "Navigation & App Shell",
  "Agent navigation rail items",
  ["Sign in as an agent.", "Inspect the left navigation rail."],
  ["Rail shows Home, Tickets, Problems, Changes, Assets & CMDB, Knowledge, Insights, Audit.", 'Footer has Settings and a Theme toggle; a primary "Create Ticket" button is present.'],
  "High"
);
add(
  "Navigation & App Shell",
  "Requester navigation rail items",
  ["Sign in as a requester.", "Inspect the left navigation rail."],
  ['Rail shows only My Requests, Raise a Request, Help Center and a "New Request" button.', "No Home, Settings, Triage, or agent-only items."],
  "High"
);
add(
  "Navigation & App Shell",
  "Triage nav visible only to manager/admin",
  ["Sign in as an agent and check the rail (Operations group).", "Switch to a manager and check again."],
  ["Agent: no Triage link.", "Manager/tenant_admin/super_admin: Triage link present under Operations."],
  "Medium"
);
add(
  "Navigation & App Shell",
  "Global search (agent only)",
  ["Sign in as an agent.", 'In the TopBar search ("Search tickets, requesters, IDs..."), type a term and submit.'],
  ["Navigates to /tickets?q=term and the list filters to matches.", "Requesters do not see a global search."],
  "Medium"
);
add(
  "Navigation & App Shell",
  "Primary create button routing",
  ["Click the primary create button in the rail/TopBar as agent, then as requester."],
  ["Agent -> /tickets?new=1 opens the New ticket form.", "Requester -> /portal."],
  "Medium"
);
add(
  "Navigation & App Shell",
  "Breadcrumbs reflect current location",
  ["Navigate across pages (ticket detail, Settings, Profile)."],
  ["TopBar breadcrumb updates, e.g. Operations > Tickets > Ticket; Workspace > Settings."],
  "Low"
);

// ------------------------------ RBAC & Record Security -----------------------
add(
  "RBAC & Record Security",
  "Requester redirected away from agent-only routes",
  ["Sign in as a requester.", "Manually visit /, then /settings, then /audit."],
  ["Each redirects to /tickets."],
  "High"
);
add(
  "RBAC & Record Security",
  "Agent redirected away from /triage",
  ["Sign in as an agent.", "Manually visit /triage."],
  ["Redirected to / (triage is manager/admin only)."],
  "High"
);
add(
  "RBAC & Record Security",
  "Requester sees only their own tickets",
  ["Sign in as a requester.", "Open /tickets (My Requests)."],
  ["Only tickets whose requester matches the signed-in email are listed; no other users' tickets appear."],
  "High"
);
add(
  "RBAC & Record Security",
  "Requester cannot open another user's ticket by URL",
  ["Sign in as dana.lee@netlink.com.", "Navigate directly to /tickets/{an-id-owned-by-someone-else}."],
  ['"Ticket not found" is shown; no ticket data leaks.'],
  "High"
);
add(
  "RBAC & Record Security",
  "Requester has no agent controls on a ticket",
  ["Sign in as a requester and open one of your own tickets."],
  ["No Properties editor, SLA panel, internal notes, AI analysis, merge/link, or solve/close controls are visible."],
  "High"
);
add(
  "RBAC & Record Security",
  "Agent cannot perform admin-only Settings writes",
  ["Sign in as an agent.", "Open /settings and try to toggle an automation rule."],
  ['Action fails with an error toast (e.g. "Could not update automation" / Forbidden).'],
  "Medium"
);
add(
  "RBAC & Record Security",
  "Only managers/admins can decide approvals",
  ["Open a ticket/change awaiting approval as an agent, then as a manager."],
  ['Agent sees "manager decides" / cannot act.', "Manager sees Approve / Reject controls."],
  "High"
);
add(
  "RBAC & Record Security",
  "Persona/user switcher only in demo mode",
  ["Open the user menu and observe the switch-user lists."],
  ['In demo mode, "Switch user" lists (Leadership / Agents / Requesters) are present; production SSO-only hides them.'],
  "Low"
);

// ------------------------------ Profile & Preferences ------------------------
add(
  "Profile & Preferences",
  "Edit and save profile fields",
  ["Open /profile.", 'Click "Edit profile".', "Change Job title, Phone, Department, Location.", 'Click "Save changes".', "Reload the page."],
  ['Button shows "Saving..." then a "Profile updated" toast; values persist after reload.'],
  "Medium"
);
add(
  "Profile & Preferences",
  "Email field is locked",
  ["On /profile, enter edit mode and inspect the Email (sign-in identity) field."],
  ["Email is read-only / cannot be edited."],
  "Medium"
);
add(
  "Profile & Preferences",
  "Detect time zone",
  ["In profile edit mode, click the Detect control next to Time zone."],
  ["Time zone field is populated with the detected zone."],
  "Low"
);
add(
  "Profile & Preferences",
  "Notification preference toggles persist",
  ["Toggle Email notifications, Desktop notifications, and Weekly digest.", "Reload / sign out and back in."],
  ["Toggle states persist (stored on the server User record)."],
  "Medium"
);
add(
  "Profile & Preferences",
  "Manager-only Monthly report preference",
  ["View Preferences as an agent, then as a manager."],
  ['"Monthly report" preference is shown only for manager/tenant_admin/super_admin.'],
  "Low"
);
add(
  "Profile & Preferences",
  "Agent availability toggle",
  ['As an agent, toggle "Available for new tickets".'],
  ["Presence chip switches between Available and Away."],
  "Low"
);
add(
  "Profile & Preferences",
  "Share profile link",
  ['On /profile click "Share".'],
  ['Shows "Copied!" and the profile URL is copied to the clipboard.'],
  "Low"
);
add(
  "Profile & Preferences",
  "Stat tiles navigate to tickets",
  ["Click a profile stat tile (e.g. Open)."],
  ["Navigates to /tickets."],
  "Low"
);

// ------------------------------ Notifications --------------------------------
add(
  "Notifications",
  "Open notifications dropdown",
  ['Click the bell ("Notifications") in the TopBar.'],
  ['Dropdown opens listing items, or the empty state "You\'re all caught up - no notifications yet."'],
  "Medium"
);
add(
  "Notifications",
  "Unread badge and mark-all-read",
  ["With unread notifications present, note the red count badge (caps at 9+).", "Open the bell."],
  ["Opening the panel marks all as read and the badge clears."],
  "Medium"
);
add(
  "Notifications",
  "Click a linked notification",
  ["Open the bell and click a notification that has a link."],
  ["Navigates to the linked record (e.g. the ticket) and closes the panel."],
  "Medium"
);
add(
  "Notifications",
  "Close on outside click",
  ["Open the notifications panel, then click anywhere outside it."],
  ["Panel closes."],
  "Low"
);

// ------------------------------ Portal (Self-Service) ------------------------
add(
  "Portal (Self-Service)",
  "Portal hero and catalog render",
  ["Sign in as a requester and open /portal."],
  ['Shows "How can we help?", a search box, quick chips, catalog cards (New laptop, Software install, Application access, Guest Wi-Fi) and the "Browse the help center" section.'],
  "Medium"
);
add(
  "Portal (Self-Service)",
  "Portal search returns matches (min 3 chars)",
  ['In the portal search type "vpn".'],
  ['A "Top matches for \'vpn\'" panel appears listing article titles + snippets.'],
  "Medium"
);
add(
  "Portal (Self-Service)",
  "Quick chip fills search",
  ['Click a quick chip (e.g. "Reset password").'],
  ["Search input is filled/focused and matching results are shown."],
  "Low"
);
add(
  "Portal (Self-Service)",
  "Submit a custom request",
  ['Click "Submit a custom request".', "Fill Subject and Describe your issue.", 'Click "Submit request".'],
  ['Shows "Submitting..." then a success banner "Request {reference} created"; form clears and the request appears under recent requests.'],
  "High"
);
add(
  "Portal (Self-Service)",
  "Catalog request with no approval",
  ['Click "Request" on Guest Wi-Fi (badge "No approval needed").', "Submit."],
  ["Ticket is created and runs the normal pipeline (may auto-resolve)."],
  "Medium"
);
add(
  "Portal (Self-Service)",
  "Catalog request requiring approval goes on hold",
  ['Click "Application access" (badge "Approval required").', "Submit the request."],
  ['Success banner mentions "awaiting manager approval"; the resulting ticket status is On hold.'],
  "High"
);
add(
  "Portal (Self-Service)",
  "Requester email is locked in the request dialog",
  ["As a requester, open the request dialog."],
  ['"Your email" field is disabled and set to the signed-in email.'],
  "Medium"
);
add(
  "Portal (Self-Service)",
  "Agent email is editable in the request dialog",
  ["As an agent, open /portal and open the request dialog."],
  ["The email field is editable."],
  "Low"
);
add(
  "Portal (Self-Service)",
  "Recent requests and View all",
  ["As a requester with existing tickets, view the portal."],
  ['Up to 3 recent request cards show; "View all ->" goes to /tickets; a card click opens /tickets/{id}.'],
  "Low"
);
add(
  "Portal (Self-Service)",
  "Close request dialog (Esc / backdrop / Cancel)",
  ["Open the request dialog.", "Press Esc, then reopen and click the backdrop, then reopen and click Cancel."],
  ["Dialog closes in each case."],
  "Low"
);

// ------------------------------ Knowledge Base -------------------------------
add(
  "Knowledge Base",
  "Search filters articles",
  ["Open /knowledge-base.", 'Type in the search box ("Search titles, content, or #tags...").'],
  ["Article cards filter client-side by title, content, or tags."],
  "Medium"
);
add(
  "Knowledge Base",
  "Category chips filter",
  ["Click a category chip (e.g. IT), then click the active chip again."],
  ["List filters to the category; clicking the active chip returns to All topics."],
  "Low"
);
add(
  "Knowledge Base",
  "Open the article reader",
  ['Click "Read" on a card (or open /knowledge-base?focus={id}).'],
  ["A right-side reader drawer opens with the full content, tags, and version."],
  "Medium"
);
add(
  "Knowledge Base",
  "Agent adds an article",
  ['As an agent click "Add article".', "Fill Title, Content, Category, Tags.", 'Click "Save article".'],
  ['Toast "Article saved"; a new card appears marked PUBLISHED, v1.'],
  "High"
);
add(
  "Knowledge Base",
  "Editing an article increments the version",
  ['Open an article, click "Edit article", change the content, click "Save changes".'],
  ['Toast "Article updated"; version increments (e.g. v1 -> v2).'],
  "Medium"
);
add(
  "Knowledge Base",
  "Agent deletes an article",
  ['Open an article, click "Delete", confirm "Delete this article?".'],
  ['Toast "Article deleted"; the card is removed.'],
  "Medium"
);
add(
  "Knowledge Base",
  "Requester has read-only KB",
  ["As a requester open the Help Center and open an article."],
  ['No "Add article", Edit, or Delete controls are available.'],
  "High"
);
add(
  "Knowledge Base",
  "KB empty / no-match states",
  ["Search for a term with no matches."],
  ['Shows "Nothing matches" with a "Clear filters" action.'],
  "Low"
);

// ------------------------------ Tickets - List & Views -----------------------
add(
  "Tickets - List & Views",
  "Agent saved views and counts",
  ["As an agent open /tickets.", "Switch between Your unsolved tickets, Unassigned tickets, All unsolved tickets, Pending, Recently updated, Recently solved, All tickets."],
  ["List updates per view; each view shows a count badge."],
  "Medium"
);
add(
  "Tickets - List & Views",
  "Agent list columns and row open",
  ["Inspect the columns (Status, Subject, Requester, Priority, Group, Assignee, SLA, Updated).", "Click a row."],
  ["Columns render; clicking a row opens /tickets/{id}."],
  "Medium"
);
add(
  "Tickets - List & Views",
  "Agent search via ?q=",
  ["Open /tickets?q=INC (or use global search)."],
  ['List filters by subject/requester/reference; subtitle shows matching "INC" with a "clear" link.'],
  "Low"
);
add(
  "Tickets - List & Views",
  "Open New ticket form via ?new=1",
  ["As an agent open /tickets?new=1."],
  ["The inline New ticket form opens on load."],
  "Low"
);
add(
  "Tickets - List & Views",
  "Requester My Requests KPI filters",
  ["As a requester open /tickets.", "Click the KPI cards (Active, Waiting, Resolved, Escalated)."],
  ["Each card toggles the corresponding filter on/off."],
  "Medium"
);
add(
  "Tickets - List & Views",
  "Requester filter pills, sort, and search",
  ["Use the filter pills (All, Active, Waiting, Resolved, Closed).", "Change sort (Recently updated / Oldest first / By priority).", "Type in the search box."],
  ["The request list updates according to each control."],
  "Medium"
);
add(
  "Tickets - List & Views",
  "Requester reopen from list",
  ['On a resolved (non-cancelled) request card click "Reopen".'],
  ['Shows "Reopening..." then toast "Request reopened"; the request returns to active.'],
  "Medium"
);
add(
  "Tickets - List & Views",
  "Requester ?new=1 redirects to portal",
  ["As a requester open /tickets?new=1."],
  ["Redirected to /portal (no inline create for requesters)."],
  "Low"
);
add(
  "Tickets - List & Views",
  "List empty states",
  ["Open a view/filter that has no matches."],
  ['Shows an empty state ("Nothing in this view" / "Nothing matches this filter") with action buttons.'],
  "Low"
);

// ------------------------------ Tickets - Creation ---------------------------
add(
  "Tickets - Creation",
  "Agent creates an incident",
  ["Open the New ticket form.", "Set Type = Incident.", "Fill Subject, Body, Requester.", "Set Impact and Urgency.", 'Click "Create & answer".'],
  ['Shows "Finding an answer..."; the ticket is created and a status-based toast appears.'],
  "High"
);
add(
  "Tickets - Creation",
  "Agent creates a service request",
  ["Open the New ticket form.", "Set Type = Service request.", "Fill required fields and submit."],
  ["A service-request ticket is created."],
  "Medium"
);
add(
  "Tickets - Creation",
  "Create form validation",
  ["Open the New ticket form and leave Subject, Body, or Requester empty."],
  ['"Create & answer" stays disabled until subject, body, and requester are all filled.'],
  "Medium"
);
add(
  "Tickets - Creation",
  "Post-create status toasts",
  ["Create tickets whose content triggers auto-resolve, agent draft, and approval paths."],
  ["Correct toast per outcome: Ticket auto-resolved / Draft ready for an agent / Awaiting approval / Routed to a person."],
  "Medium"
);
add(
  "Tickets - Creation",
  "Priority derived from impact x urgency",
  ["In the New ticket form set Impact = high and Urgency = high."],
  ['Derived priority is P1; hint reads "Priority is derived from impact x urgency (ITIL matrix)."'],
  "Medium"
);
add(
  "Tickets - Creation",
  "Requester creation happens via portal",
  ["As a requester attempt to create a ticket."],
  ["There is no incident/request picker for requesters; the portal path creates the ticket."],
  "Low"
);

// ------------------------------ Tickets - Detail & Conversation --------------
add(
  "Tickets - Detail & Conversation",
  "Ticket header badges",
  ["Open a ticket as an agent."],
  ["Header shows reference, Subject, Status, Priority (e.g. P1-critical), Category.", "Agent also sees SLA badge, Requester, Assignee, and any linked CIs."],
  "Medium"
);
add(
  "Tickets - Detail & Conversation",
  "Post a public reply",
  ["On the Public reply tab, type a message.", 'Click "Send".'],
  ['Toast "Reply sent"; the message appears in the conversation thread.'],
  "High"
);
add(
  "Tickets - Detail & Conversation",
  "Internal note is hidden from requester",
  ["As an agent add an Internal note.", "Open the same ticket as the requester."],
  ['Agent sees the yellow "Internal note"; the requester does NOT see it.'],
  "High"
);
add(
  "Tickets - Detail & Conversation",
  "Insert a macro",
  ['In the composer click "Macros" and pick a macro.'],
  ["Macro text is inserted; each option shows a Reply or Note badge."],
  "Low"
);
add(
  "Tickets - Detail & Conversation",
  "Translate a message",
  ['On a message click "Translate", choose Hindi, click "Go".'],
  ['Translated text is shown; "Hide" reverts to the original.'],
  "Low"
);
add(
  "Tickets - Detail & Conversation",
  "Typing indicators",
  ["Open the same ticket in two sessions (agent + requester) and type in each composer."],
  ['The other side shows "{name} typing..."; internal-note typing is hidden from the requester.'],
  "Medium"
);
add(
  "Tickets - Detail & Conversation",
  "Requester sees public thread only",
  ["As a requester open one of your tickets."],
  ["Only public messages are shown; your own messages appear right-aligned labelled You."],
  "Medium"
);

// ------------------------------ Tickets - Properties & Priority --------------
add(
  "Tickets - Properties & Priority",
  "Change assignee",
  ["In Properties, set Assignee to an agent."],
  ['Toast "Assignee updated".'],
  "Medium"
);
add(
  "Tickets - Properties & Priority",
  "Change assignment group",
  ["In Properties, set Assignment group."],
  ['Toast "Group updated".'],
  "Low"
);
add(
  "Tickets - Properties & Priority",
  "Impact/Urgency recalculates priority",
  ["Change Impact and Urgency in Properties."],
  ['Toast confirms "priority recalculated"; the Priority value updates.'],
  "Medium"
);
add(
  "Tickets - Properties & Priority",
  "Priority override requires justification",
  ["In Properties change Priority to a value different from the derived one."],
  ['A prompt asks for a justification; entering text saves with a "Priority overridden" toast; Cancel aborts; a hint notes the override.'],
  "High"
);
add(
  "Tickets - Properties & Priority",
  "Change category",
  ["In Properties select a different Category."],
  ['Toast "Category updated".'],
  "Low"
);
add(
  "Tickets - Properties & Priority",
  "Save subcategory and tags",
  ['Edit Subcategory then click "Save subcategory".', 'Edit Tags then click "Save tags".'],
  ["Both save when dirty and persist after reload."],
  "Low"
);
add(
  "Tickets - Properties & Priority",
  "Link CIs and edit custom fields",
  ['Toggle an "Affected CIs (CMDB)" checkbox.', "Edit a custom field and save."],
  ['Toast "CI linked"/"CI unlinked"; custom field shows "{label} updated".'],
  "Medium"
);

// ------------------------------ Tickets - Composer Actions -------------------
add(
  "Tickets - Composer Actions",
  "Run AI on an open ticket",
  ['In the composer click "Run AI".'],
  ["Auto-resolved / Draft ready / Escalated toast appears depending on confidence."],
  "Medium"
);
add(
  "Tickets - Composer Actions",
  "Approve an AI draft",
  ['On a pending-agent ticket click "Approve draft".'],
  ['Toast "Draft sent"; ticket is resolved.'],
  "Medium"
);
add(
  "Tickets - Composer Actions",
  "Escalate a pending-agent ticket",
  ['On a pending-agent ticket click "Escalate".'],
  ['Status becomes escalated; toast "Escalated".'],
  "Medium"
);
add(
  "Tickets - Composer Actions",
  "On hold pauses SLA",
  ['On an active ticket click "On hold".'],
  ['Status becomes Pending; toast "Put on hold - SLA paused"; the SLA panel shows paused.'],
  "High"
);
add(
  "Tickets - Composer Actions",
  "Submit as Solved",
  ['Click "Submit as Solved".'],
  ["Status becomes Resolved; success toast; requester is notified."],
  "High"
);
add(
  "Tickets - Composer Actions",
  "Close a ticket",
  ['Click "Close".'],
  ['Toast "Ticket closed".'],
  "Medium"
);
add(
  "Tickets - Composer Actions",
  "Reopen a resolved/closed ticket",
  ['On a resolved ticket click "Reopen ticket".'],
  ['Toast "Reopened"; ticket returns to the active queue and the composer textarea is re-enabled.'],
  "Medium"
);

// ------------------------------ Tickets - Attachments ------------------------
add(
  "Tickets - Attachments",
  "Upload an attachment",
  ['In the Attachments panel click "Attach" and pick a valid file (e.g. PDF or PNG).'],
  ['Shows "Uploading..." then toast "File attached"; the file row shows its size.'],
  "Medium"
);
add(
  "Tickets - Attachments",
  "Download an attachment",
  ["Click an attached file name."],
  ["The file downloads (forced as an attachment)."],
  "Low"
);
add(
  "Tickets - Attachments",
  "Delete attachment (agent only)",
  ["As an agent click the trash icon on a file and confirm the delete."],
  ['Toast "Attachment deleted"; requesters have no delete control.'],
  "Medium"
);
add(
  "Tickets - Attachments",
  "Upload limits and blocked types",
  ["Try to attach more than 5 files at once, an oversized file (>10MB), or a blocked extension (.exe, .js)."],
  ['Upload is rejected with an "Upload failed"/validation message.'],
  "Medium"
);
add(
  "Tickets - Attachments",
  "Requester can upload on own ticket",
  ['As a requester open your ticket and click "Attach".'],
  ["Upload works; no delete control is shown."],
  "Low"
);

// ------------------------------ Tickets - Merge & Link -----------------------
add(
  "Tickets - Merge & Link",
  "Link a related ticket",
  ['In Related tickets choose a ticket from "Select a ticket..." and click "Link".'],
  ['Toast "Ticket linked"; it appears in the linked list.'],
  "Medium"
);
add(
  "Tickets - Merge & Link",
  "Unlink a related ticket",
  ['Click "Unlink" on a linked ticket.'],
  ["The ticket is removed from the linked list."],
  "Low"
);
add(
  "Tickets - Merge & Link",
  "Merge a ticket with confirmation",
  ['Click "Merge into...", pick a target, and confirm the merge dialog.'],
  ['Toast "Merged into {reference}"; the source ticket becomes cancelled, a merged banner shows, and link/merge controls hide.'],
  "High"
);
add(
  "Tickets - Merge & Link",
  "Merged banner links to target",
  ["Open a merged source ticket."],
  ['"This ticket was merged into {reference}." banner links to the target ticket.'],
  "Low"
);

// ------------------------------ Tickets - SLA --------------------------------
add(
  "Tickets - SLA",
  "SLA panel shows progress",
  ["Open a ticket with an active SLA (agent view)."],
  ["First response and Resolution rows show countdown/progress with a status badge (On track / At risk / Breached)."],
  "Medium"
);
add(
  "Tickets - SLA",
  "SLA pauses when pending",
  ["Put a ticket On hold."],
  ['SLA badge shows "SLA paused" with "Clock paused - {N}m accrued".'],
  "High"
);
add(
  "Tickets - SLA",
  "SLA at-risk / breach states (observational)",
  ["Locate a ticket near or past its deadline."],
  ['Shows "At risk" at ~80% of the window and "Breached" past the deadline.'],
  "Low"
);

// ------------------------------ Tickets - Approvals --------------------------
add(
  "Tickets - Approvals",
  "Manager approves a request",
  ['As a manager open a ticket pending approval and click "Approve".'],
  ['Toast "Request approved"; fulfilment resumes (SLA un-pauses).'],
  "High"
);
add(
  "Tickets - Approvals",
  "Manager rejects a request",
  ['As a manager click "Reject" on a pending-approval ticket.'],
  ['Toast "Request rejected"; the request is cancelled and the requester notified.'],
  "Medium"
);
add(
  "Tickets - Approvals",
  "Agent cannot decide an approval",
  ["As an agent open the same pending-approval ticket."],
  ['Shows "Only managers or admins can decide this request." with no Approve/Reject buttons.'],
  "Medium"
);

// ------------------------------ Tickets - Requester Reply & CSAT -------------
add(
  "Tickets - Requester Reply & CSAT",
  "Reply reopens a resolved request",
  ["As a requester on a resolved ticket, type a reply and click Send reply."],
  ['Toast "Reply sent"; the ticket reopens.'],
  "Medium"
);
add(
  "Tickets - Requester Reply & CSAT",
  "CSAT - confirm resolved",
  ['On a resolved ticket click "Yes, resolved".'],
  ['Toast "Thanks for confirming"; status becomes Closed.'],
  "Medium"
);
add(
  "Tickets - Requester Reply & CSAT",
  "CSAT - not resolved",
  ['On a resolved ticket click "Not yet".'],
  ['Toast "Reopened"; status becomes Reopened.'],
  "Medium"
);
add(
  "Tickets - Requester Reply & CSAT",
  "Cancelled request cannot be reopened",
  ["As a requester open a cancelled ticket."],
  ["No Reopen control; the server rejects reopening a cancelled request."],
  "Low"
);
add(
  "Tickets - Requester Reply & CSAT",
  "Reply to on-hold moves to in progress",
  ["As a requester reply on a ticket that is On hold (not held for approval)."],
  ["Status moves to in_progress."],
  "Low"
);

// ------------------------------ Triage ---------------------------------------
add(
  "Triage",
  "Triage access gating",
  ["Open /triage as a manager, then as an agent."],
  ["Manager: page loads.", "Agent: redirected to /."],
  "High"
);
add(
  "Triage",
  "Unassigned queue",
  ['As a manager inspect the "Unassigned queue".'],
  ['Rows show reference, priority, category, time, and subject; when empty it shows "Nothing waiting - every open ticket is assigned."'],
  "Medium"
);
add(
  "Triage",
  "Selecting a ticket shows the assign panel",
  ["Click a queue row."],
  ['Panel shows "Assign {REFERENCE}" with Specialists and Common agent lists (availability + load).'],
  "Medium"
);
add(
  "Triage",
  "Assign a ticket from triage",
  ['Click "Assign" on an agent row.'],
  ['Toast "Ticket assigned"; the ticket leaves the queue and the board refreshes.'],
  "High"
);
add(
  "Triage",
  "Team workload panel",
  ['Inspect the "Team workload" panel.'],
  ["Lists all agents with load; no Assign buttons here."],
  "Low"
);

// ------------------------------ Problem Management ---------------------------
add(
  "Problem Management",
  "Create a problem",
  ['On /problems click "+ New problem".', "Fill Title and Description; set Impact/Urgency/Category.", 'Click "Create problem".'],
  ['Toast "Problem created"; the new problem is selected in the list.'],
  "Medium"
);
add(
  "Problem Management",
  "Problem create validation",
  ["Open the new problem form and leave Title or Description empty."],
  ['"Create problem" is disabled.'],
  "Low"
);
add(
  "Problem Management",
  "Create a problem from an AI cluster",
  ['In "AI incident cluster analysis" click "Create problem" on a cluster.'],
  ['Toast "Problem created from cluster"; status is investigating and incidents are auto-linked.'],
  "Medium"
);
add(
  "Problem Management",
  "Status transitions",
  ['On a problem click the status buttons (e.g. "-> Investigating", "-> Known Error", "-> Resolved").'],
  ["Status updates immediately and the list refreshes."],
  "Medium"
);
add(
  "Problem Management",
  "AI suggested root cause - apply/dismiss",
  ['Click "Suggest root cause with AI"; then use "Apply" and "Dismiss".'],
  ["Apply saves the root cause and closes the panel; Dismiss just hides the panel."],
  "Medium"
);
add(
  "Problem Management",
  "Publish workaround to KB",
  ["Enter workaround text (saves on blur).", 'Click "Publish workaround to KB".'],
  ['Badge "Published to knowledge base" appears; the problem is marked a known error.'],
  "Medium"
);
add(
  "Problem Management",
  "Link and unlink incidents",
  ['Use "Link an incident..." + "Link"; then click "Unlink" on a linked incident.'],
  ["Incident is added then removed; the linked-incident counts update."],
  "Medium"
);
add(
  "Problem Management",
  "Raise a change for the permanent fix",
  ['Click "Raise a change for the permanent fix ->".'],
  ['Badge "Change raised" appears; a new change titled "Permanent fix: {problem title}" exists on /changes.'],
  "Medium"
);
add(
  "Problem Management",
  "Add a note",
  ['Type in "Add a note..." and click "Add".'],
  ["The note appears with author and timestamp."],
  "Low"
);
add(
  "Problem Management",
  "List filters and search",
  ['Use the filter pills and "Search problems..." box.'],
  ["The list filters by status and by reference/title."],
  "Low"
);

// ------------------------------ Change Management (CAB) ----------------------
add(
  "Change Management (CAB)",
  "Create a change with AI risk",
  ['On /changes click "+ New change".', "Fill Title and Description; choose a Type.", 'Click "Create change".'],
  ['Shows "Assessing risk..." then toast "Change created with an AI risk assessment"; a Risk badge and "AI risk assessment" panel appear; status is Draft.'],
  "Medium"
);
add(
  "Change Management (CAB)",
  "Change create validation",
  ["Open the new change form and leave Title or Description empty."],
  ['"Create change" is disabled.'],
  "Low"
);
add(
  "Change Management (CAB)",
  "Submit for CAB approval",
  ['On a draft change click "Submit for CAB approval".'],
  ['Toast "Submitted for CAB approval"; stepper moves to CAB review; approver rows appear as pending.'],
  "High"
);
add(
  "Change Management (CAB)",
  "Approve through CAB",
  ['As a manager click "Approve" on each pending approver row.'],
  ['Toast "Approval recorded"; the vote meter fills; when all approve, status becomes Approved.'],
  "High"
);
add(
  "Change Management (CAB)",
  "Reject through CAB",
  ['As a manager click "Reject" on an approver row.'],
  ['Toast "Rejection recorded"; the change shows rejected and advancement buttons hide.'],
  "Medium"
);
add(
  "Change Management (CAB)",
  "Advance change lifecycle",
  ['After approval click "Schedule ->", then "Start implementation ->", "Move to review ->", "Close change ->".'],
  ["Status advances with a toast each step; the stepper ends at Closed."],
  "Medium"
);
add(
  "Change Management (CAB)",
  "Agent cannot approve a change",
  ["As an agent view a change pending approval."],
  ['Shows "manager decides"; no Approve/Reject controls.'],
  "Medium"
);
add(
  "Change Management (CAB)",
  "Risk gauge color and label",
  ["Observe the Risk badge on changes."],
  ["High (red) >=66, medium (amber) >=33, low (green) <33; tooltip reads AI risk score N/100."],
  "Low"
);

// ------------------------------ Assets & CMDB -------------------------------
add(
  "Assets & CMDB",
  "Add an asset",
  ["On /assets in the Assets form fill Tag and Name, pick a type.", 'Click "Add".'],
  ['Shows "Adding..." then toast "Asset added"; a new row appears with status in stock.'],
  "Medium"
);
add(
  "Assets & CMDB",
  "Add asset validation",
  ["Leave Tag or Name empty in the Assets form."],
  ['"Add" is disabled.'],
  "Low"
);
add(
  "Assets & CMDB",
  "Add a configuration item",
  ['In the CI form enter a CI name, pick a type, click "Add".'],
  ['Toast "Configuration item added"; new CI shows status operational.'],
  "Medium"
);
add(
  "Assets & CMDB",
  "Link a CI dependency",
  ['Choose Source CI and Target CI (different), click "Link".'],
  ['Shows "Linking..." then toast "Dependency linked".'],
  "Medium"
);
add(
  "Assets & CMDB",
  "Impact analysis",
  ['Click "Impact" on a CI row.'],
  ['Shows "Impact analysis - {CI}" with Dependent CIs and Related tickets lists; "Close" hides it.'],
  "Medium"
);
add(
  "Assets & CMDB",
  "Ticket-CI relation surfaces in impact",
  ["Link a ticket to a CI via ticket Properties, then open that CI's Impact."],
  ["The ticket appears under Related tickets and its link opens /tickets/{id}."],
  "Medium"
);
add(
  "Assets & CMDB",
  "Asset create role gating",
  ["As a requester (via URL) attempt to add an asset."],
  ["POST is forbidden (asset.write required)."],
  "Low"
);

// ------------------------------ Analytics / Insights ------------------------
add(
  "Analytics / Insights",
  "KPI bands render",
  ["As an agent open /analytics."],
  ["Volume, AI performance, Speed, SLA & quality, and Value bands show values with progress bars."],
  "Medium"
);
add(
  "Analytics / Insights",
  "Trend charts",
  ['Observe "Ticket volume - last 30 days" and "SLA outcomes - last 30 days".'],
  ["A line chart and a stacked bar chart render with hover tooltips."],
  "Low"
);
add(
  "Analytics / Insights",
  "Download CSV report",
  ['Click "Download CSV".'],
  ["Downloads netlink-support-report.csv with the documented columns (reference, type, status, priority, ...)."],
  "Medium"
);
add(
  "Analytics / Insights",
  "Download PDF report",
  ['Click "Download PDF".'],
  ["Downloads netlink-support-report.pdf."],
  "Low"
);
add(
  "Analytics / Insights",
  "Agent leaderboard",
  ['Inspect the Agent leaderboard and click "Open tickets ->".'],
  ["Ranked agent rows show; the link goes to /tickets."],
  "Low"
);
add(
  "Analytics / Insights",
  "Requester forbidden panel",
  ["As a requester open /analytics."],
  ['Shows an "Insights require an agent role" error panel instead of metrics.'],
  "Medium"
);

// ------------------------------ Audit Chain ---------------------------------
add(
  "Audit Chain",
  "Audit auto-verifies on load",
  ["As an agent open /audit."],
  ['Stats (Records in chain, Intact, Last recorded event) and a green "Chain verified" banner are shown.'],
  "Medium"
);
add(
  "Audit Chain",
  "Verify integrity button",
  ['Click "Verify integrity".'],
  ['Shows "Verifying..." then toast "Chain verified"; the banner stays green.'],
  "High"
);
add(
  "Audit Chain",
  "Filter the chain",
  ["Use the filter box and the action dropdown."],
  ['The list filters; when nothing matches it shows "Nothing matches this filter."'],
  "Low"
);
add(
  "Audit Chain",
  "Expand a block and copy a hash",
  ['Click a chain row to expand it, then click "Copy" on a hash field.'],
  ["Detail (hash / prevHash / payloadHash / payload) expands; the hash is copied to the clipboard."],
  "Low"
);
add(
  "Audit Chain",
  "Requester redirected from audit",
  ["As a requester open /audit."],
  ["Redirected to /tickets."],
  "Medium"
);

// ------------------------------ Home Dashboard ------------------------------
add(
  "Home Dashboard",
  "Dashboard loads for agent",
  ["Sign in as an agent and open /."],
  ["Greeting, SLA Health strip, KPI spotlight cards, ops bar, panels, and the Agent performance table render."],
  "Medium"
);
add(
  "Home Dashboard",
  "Refresh dashboard",
  ['Click "Refresh".'],
  ['Shows "Refreshing..."; metrics, recent tickets, users, and audit verification reload.'],
  "Low"
);
add(
  "Home Dashboard",
  "Dashboard drill-through links",
  ['Click the "Auto-resolved by AI" card, "View all ->", a recent ticket, and the "Chain verified" badge.'],
  ["Navigate to /tickets, /tickets/{id}, and /audit respectively."],
  "Low"
);
add(
  "Home Dashboard",
  "Requester redirected from home",
  ["As a requester visit /."],
  ["Redirected to /tickets."],
  "Medium"
);

// ------------------------------ Settings ------------------------------------
add(
  "Settings",
  "Settings access gating",
  ["Open /settings as an agent, then as a requester."],
  ["Agent: page loads.", "Requester: redirected to /tickets."],
  "Medium"
);
add(
  "Settings",
  "Data & health read-only",
  ["Inspect the Data & health section."],
  ["Service, Data driver, and Features are shown read-only."],
  "Low"
);
add(
  "Settings",
  "SLA policies display",
  ["Inspect the SLA policies section."],
  ["P1-P5 respond/resolve values are shown (default matrix if none configured)."],
  "Low"
);
add(
  "Settings",
  "Group auto-assign strategy (admin)",
  ["As tenant_admin change a group's Auto-assign (manual / round robin / least loaded)."],
  ['Toast "Strategy updated"; non-admins see it read-only.'],
  "Medium"
);
add(
  "Settings",
  "Create and delete a business calendar (admin)",
  ['As tenant_admin click "+ New calendar", fill Name, IANA timezone, holidays, click "Create calendar"; then "Delete" and confirm.'],
  ["Calendar is created then removed."],
  "Medium"
);
add(
  "Settings",
  "Create and delete a macro",
  ['Click "+ New macro", set name/visibility/body, click "Create macro"; then "Delete".'],
  ["Macro is added (with Reply/Note badge) then removed."],
  "Low"
);
add(
  "Settings",
  "Create and delete a custom field (admin)",
  ['As tenant_admin click "+ New field", set label/type/options/required, click "Create field"; then "Delete".'],
  ["Field is added (and appears on ticket Properties) then removed."],
  "Medium"
);
add(
  "Settings",
  "Automation rule builder (admin)",
  ['Click "+ New rule"; set a name and trigger; add conditions (ALL/ANY, "+ condition") and actions ("+ action"); click "Create rule".'],
  ['Rule is created and shows "on {trigger} - ran N times".'],
  "Medium"
);
add(
  "Settings",
  "Automation toggle gating",
  ["Toggle a rule's enable switch as an admin, then as an agent."],
  ['Admin: succeeds. Agent: fails with "Could not update automation".'],
  "Medium"
);
add(
  "Settings",
  "API key create / copy / revoke (admin)",
  ['As tenant_admin enter a Key name, pick a role, click "Create key"; copy the one-time key ("Copy"/"Done"); then "Revoke".'],
  ["Key is shown once for copying; Revoke removes it."],
  "High"
);
add(
  "Settings",
  "Appearance theme toggle",
  ["In Settings > Appearance switch between Light and Dark."],
  ['Theme switches and shows "Currently {theme} mode".'],
  "Low"
);

// ------------------------------ Common / Cross-Cutting ----------------------
add(
  "Common / Cross-Cutting",
  "Protected routes require sign-in",
  ["Sign out.", "Visit /, /tickets, /problems, /changes, /assets, /knowledge-base, /analytics, /audit, /settings, /profile, /portal directly."],
  ["Each redirects to /signin?callbackUrl=..."],
  "High"
);
add(
  "Common / Cross-Cutting",
  "Role-based route redirects (consolidated)",
  ["Verify the redirect rules by role."],
  ["Requester -> /tickets from /, /settings, /audit.", "Agent -> / from /triage."],
  "Medium"
);
add(
  "Common / Cross-Cutting",
  "Theme preference persists (cookie)",
  ["Toggle the theme (rail / profile / settings).", "Reload, then sign out and back in."],
  ["Theme persists across reloads and sessions via a cookie (no localStorage)."],
  "Medium"
);
add(
  "Common / Cross-Cutting",
  "Success and error toasts",
  ["Perform any create/update (e.g. save profile, add a KB article) and also a failing action."],
  ["A success toast appears on success and an error toast on failure."],
  "Low"
);
add(
  "Common / Cross-Cutting",
  "Responsive layout",
  ["Resize the browser across widths: >=1280px, 768-1279px, <768px."],
  [">=1280: full rail with labels.", "768-1279: collapsed icon-only rail.", '<768: rail hidden; "Open navigation" hamburger opens a drawer; tapping the overlay closes it.'],
  "Medium"
);
add(
  "Common / Cross-Cutting",
  "Persona / user switcher (demo)",
  ["Open the user menu and pick a user from Leadership / Agents / Requesters."],
  ["Re-signs in as that user and lands on / (requester -> /tickets); the active user is marked with a check."],
  "Medium"
);
add(
  "Common / Cross-Cutting",
  "List search / filter / sort baseline",
  ["On any list (tickets, problems, KB) apply a search term and a filter, then clear them."],
  ["Results narrow to matches and restore fully when cleared."],
  "Low"
);
add(
  "Common / Cross-Cutting",
  "Live updates (SSE)",
  ["Open a ticket in two sessions and change it in one.", "Also watch the notifications bell."],
  ["The other view updates without a manual refresh; notifications update via SSE plus ~120s polling."],
  "Low"
);

// =============================================================================
// Agent test-coverage classification
//
// Marks who/how each case can be executed:
//   "Agent (automated)"  - I can verify it headlessly (API e2e smoke and/or
//                          the Vitest suite) with no browser.
//   "Partial (API only)" - the underlying behaviour is API-verifiable, but the
//                          actual UI element/rendering still needs a human.
//   "Human (UI)"         - pure browser/visual/interaction; no headless check.
// =============================================================================

const SECTION_DEFAULT = {
  "Setup & Environment": "Human (UI)",
  "Authentication & Session": "Human (UI)",
  "Navigation & App Shell": "Human (UI)",
  "RBAC & Record Security": "Agent (automated)",
  "Profile & Preferences": "Human (UI)",
  "Notifications": "Human (UI)",
  "Portal (Self-Service)": "Human (UI)",
  "Knowledge Base": "Human (UI)",
  "Tickets - List & Views": "Human (UI)",
  "Tickets - Creation": "Agent (automated)",
  "Tickets - Detail & Conversation": "Human (UI)",
  "Tickets - Properties & Priority": "Agent (automated)",
  "Tickets - Composer Actions": "Agent (automated)",
  "Tickets - Attachments": "Agent (automated)",
  "Tickets - Merge & Link": "Agent (automated)",
  "Tickets - SLA": "Partial (API only)",
  "Tickets - Approvals": "Agent (automated)",
  "Tickets - Requester Reply & CSAT": "Agent (automated)",
  "Triage": "Human (UI)",
  "Problem Management": "Agent (automated)",
  "Change Management (CAB)": "Agent (automated)",
  "Assets & CMDB": "Agent (automated)",
  "Analytics / Insights": "Partial (API only)",
  "Audit Chain": "Human (UI)",
  "Home Dashboard": "Partial (API only)",
  "Settings": "Agent (automated)",
  "Common / Cross-Cutting": "Human (UI)",
};

// Per-case overrides (exact Test Case title -> coverage)
const COVERAGE_OVERRIDE = {
  "Start the app in demo (zero-infra) mode": "Agent (automated)",
  "Demo email sign-in as agent": "Agent (automated)",
  "Non-seeded email is rejected": "Agent (automated)",
  "Quick demo identity card sign-in": "Partial (API only)",
  "Sign in as each role and verify workspace": "Partial (API only)",
  "Sign out clears the session": "Partial (API only)",
  "Agent redirected away from /triage": "Partial (API only)",
  "Requester has no agent controls on a ticket": "Partial (API only)",
  "Persona/user switcher only in demo mode": "Human (UI)",
  "Edit and save profile fields": "Agent (automated)",
  "Notification preference toggles persist": "Agent (automated)",
  "Agent availability toggle": "Partial (API only)",
  "Unread badge and mark-all-read": "Agent (automated)",
  "Submit a custom request": "Agent (automated)",
  "Catalog request with no approval": "Agent (automated)",
  "Catalog request requiring approval goes on hold": "Agent (automated)",
  "Portal hero and catalog render": "Partial (API only)",
  "Portal search returns matches (min 3 chars)": "Partial (API only)",
  "Agent adds an article": "Agent (automated)",
  "Editing an article increments the version": "Agent (automated)",
  "Agent deletes an article": "Agent (automated)",
  "Requester has read-only KB": "Partial (API only)",
  "Requester reopen from list": "Agent (automated)",
  "Agent saved views and counts": "Partial (API only)",
  "Requester ?new=1 redirects to portal": "Partial (API only)",
  "Create form validation": "Partial (API only)",
  "Post-create status toasts": "Partial (API only)",
  "Requester creation happens via portal": "Partial (API only)",
  "Post a public reply": "Agent (automated)",
  "Internal note is hidden from requester": "Agent (automated)",
  "Requester sees public thread only": "Agent (automated)",
  "Priority override requires justification": "Partial (API only)",
  "Upload limits and blocked types": "Partial (API only)",
  "Requester can upload on own ticket": "Partial (API only)",
  "Merged banner links to target": "Human (UI)",
  "SLA pauses when pending": "Agent (automated)",
  "Triage access gating": "Agent (automated)",
  "Assign a ticket from triage": "Agent (automated)",
  "Unassigned queue": "Partial (API only)",
  "Problem create validation": "Partial (API only)",
  "List filters and search": "Human (UI)",
  "Change create validation": "Partial (API only)",
  "Risk gauge color and label": "Human (UI)",
  "Add asset validation": "Partial (API only)",
  "Download CSV report": "Agent (automated)",
  "Download PDF report": "Agent (automated)",
  "Requester forbidden panel": "Agent (automated)",
  "Audit auto-verifies on load": "Agent (automated)",
  "Verify integrity button": "Agent (automated)",
  "Requester redirected from audit": "Agent (automated)",
  "Dashboard drill-through links": "Human (UI)",
  "Appearance theme toggle": "Human (UI)",
  "Settings access gating": "Partial (API only)",
  "Protected routes require sign-in": "Agent (automated)",
  "Role-based route redirects (consolidated)": "Partial (API only)",
  "Live updates (SSE)": "Partial (API only)",
};

function coverageFor(section, title) {
  return (
    COVERAGE_OVERRIDE[title] ?? SECTION_DEFAULT[section] ?? "Partial (API only)"
  );
}

// Keep ONLY the cases that require a human in the browser; drop everything that
// can be verified headlessly ("Agent (automated)") or via API ("Partial (API
// only)"). This makes the workbook a purely manual test plan. Flip ONLY_HUMAN to
// false to restore the full suite.
const ONLY_HUMAN = true;
if (ONLY_HUMAN) {
  for (let i = cases.length - 1; i >= 0; i--) {
    if (coverageFor(cases[i].section, cases[i].title) !== "Human (UI)") {
      cases.splice(i, 1);
    }
  }
}

// =============================================================================
// XLSX writer (OOXML SpreadsheetML + minimal STORED-entry ZIP)
// =============================================================================

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cell(ref, styleId, text) {
  return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

const HEADERS = [
  "TC ID",
  "Section / Feature",
  "Test Case",
  "Steps (How to Test)",
  "Expected Results",
  "Priority",
  "Status (Pass / Fail / Skip / Block)",
];

// Style ids (see styles.xml below): 1 = header, 2 = body left-wrap, 3 = body center-wrap
const CENTER_COLS = new Set([1, 6, 7]); // TC ID, Priority, Status

function buildSheetXml() {
  const lastRow = cases.length + 1;
  let rows = "";

  rows +=
    `<row r="1">` +
    HEADERS.map((h, i) => cell(colLetter(i + 1) + "1", 1, h)).join("") +
    `</row>`;

  cases.forEach((c, idx) => {
    const r = idx + 2;
    const tcId = "TC-" + String(idx + 1).padStart(3, "0");
    const steps = (Array.isArray(c.steps) ? c.steps : [c.steps])
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n");
    const expected = Array.isArray(c.expected)
      ? c.expected.map((s) => "- " + s).join("\n")
      : c.expected;

    const values = [tcId, c.section, c.title, steps, expected, c.priority, ""];
    rows +=
      `<row r="${r}">` +
      values
        .map((v, i) =>
          cell(colLetter(i + 1) + r, CENTER_COLS.has(i + 1) ? 3 : 2, v)
        )
        .join("") +
      `</row>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${colLetter(HEADERS.length)}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>
<col min="1" max="1" width="9" customWidth="1"/>
<col min="2" max="2" width="26" customWidth="1"/>
<col min="3" max="3" width="34" customWidth="1"/>
<col min="4" max="4" width="62" customWidth="1"/>
<col min="5" max="5" width="52" customWidth="1"/>
<col min="6" max="6" width="10" customWidth="1"/>
<col min="7" max="7" width="14" customWidth="1"/>
</cols>
<sheetData>${rows}</sheetData>
</worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlEscape(SHEET_NAME)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

// ---- tiny ZIP (STORED / no compression) ------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralStart = offset;
  const centralSize = centralParts.reduce((n, b) => n + b.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

// ---- build + write ----------------------------------------------------------

const parts = [
  { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
  { name: "_rels/.rels", data: Buffer.from(ROOT_RELS, "utf8") },
  { name: "xl/workbook.xml", data: Buffer.from(WORKBOOK_XML, "utf8") },
  { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(WORKBOOK_RELS, "utf8") },
  { name: "xl/styles.xml", data: Buffer.from(STYLES_XML, "utf8") },
  { name: "xl/worksheets/sheet1.xml", data: Buffer.from(buildSheetXml(), "utf8") },
];

mkdirSync(HERE, { recursive: true });
const xlsx = zip(parts);
writeFileSync(OUT_FILE, xlsx);

// ---- self-verification ------------------------------------------------------

function verify() {
  const buf = readFileSync(OUT_FILE);
  // locate End Of Central Directory (no zip comment -> last 22 bytes)
  const eocdSig = 0x06054b50;
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === eocdSig) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) throw new Error("EOCD not found - zip is malformed");
  const total = buf.readUInt16LE(eocdPos + 10);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  let entriesSeen = 0;
  let p = cdOffset;
  while (p < eocdPos && buf.readUInt32LE(p) === 0x02014b50) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    entriesSeen++;
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (entriesSeen !== total || total !== parts.length) {
    throw new Error(
      `Central directory mismatch: header=${total}, scanned=${entriesSeen}, expected=${parts.length}`
    );
  }
  return { total, bytes: buf.length };
}

const info = verify();
const sections = [...new Set(cases.map((c) => c.section))];

console.log("Wrote: " + OUT_FILE);
console.log(
  `Manual (human) test cases: ${cases.length} | Sections: ${sections.length} | Rows (incl. header): ${cases.length + 1}`
);
console.log(`Workbook parts: ${info.total} | File size: ${info.bytes} bytes`);
console.log("Verification: OK (valid ZIP central directory).");

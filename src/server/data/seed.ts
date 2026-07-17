// =============================================================================
// Seed dataset.
//
// Builds a realistic Netlink workspace: one internal tenant, agents/manager/
// requester users, SLA policies, a starter knowledge base (embedded on build),
// a service-request catalog, demo tickets across ITIL types, and a couple of
// assets/CIs. Used by the in-memory store on first run and by the Prisma seed
// script (prisma/seed.ts), so both drivers start from the same content.
// =============================================================================

import { createHash } from "node:crypto";
import { embed } from "../ai/embeddings";
import { KB_ARTICLES } from "../../lib/kbArticles.data";
import { minutesAgo, newId, now, reference, ticketReference } from "../domain/ids";
import type {
  ApiKeyRow,
  ApprovalRow,
  ArticleRow,
  AssetRow,
  AssignmentGroupRow,
  AutomationRow,
  BusinessCalendarRow,
  CIRelationshipRow,
  CIRow,
  CatalogItemRow,
  ChangeRow,
  CustomFieldDefRow,
  DepartmentRow,
  ImpactLevel,
  MacroRow,
  NotificationRow,
  ProblemRow,
  SlaPolicyRow,
  TenantRow,
  TicketEventRow,
  TicketMessageRow,
  TicketRow,
  UserRow,
} from "../domain/models";

export interface SeedData {
  tenants: TenantRow[];
  departments: DepartmentRow[];
  users: UserRow[];
  groups: AssignmentGroupRow[];
  calendars: BusinessCalendarRow[];
  slaPolicies: SlaPolicyRow[];
  articles: ArticleRow[];
  catalogItems: CatalogItemRow[];
  tickets: TicketRow[];
  messages: TicketMessageRow[];
  events: TicketEventRow[];
  problems: ProblemRow[];
  changes: ChangeRow[];
  approvals: ApprovalRow[];
  assets: AssetRow[];
  cis: CIRow[];
  ciRelationships: CIRelationshipRow[];
  notifications: NotificationRow[];
  apiKeys: ApiKeyRow[];
  automations: AutomationRow[];
  macros: MacroRow[];
  customFieldDefs: CustomFieldDefRow[];
}

export const NETLINK_TENANT_ID = "tenant_netlink";

// Knowledge base content comes from the shared dataset (src/lib/kbArticles.data.ts).

const GROUP_SERVICE_DESK = "grp_service_desk";
const GROUP_NETWORK = "grp_network";
const GROUP_PEOPLE_OPS = "grp_people_ops";
const GROUP_ACCESS = "grp_access";
const GROUP_HARDWARE = "grp_hardware";
const GROUP_SOFTWARE = "grp_software";

const TICKETS: {
  type: TicketRow["type"];
  subject: string;
  body: string;
  category: TicketRow["category"];
  subcategory?: string;
  impact: ImpactLevel;
  urgency: ImpactLevel;
  priority: TicketRow["priority"];
  status: TicketRow["status"];
  requesterEmail: string;
  assigneeId?: string;
  assignmentGroupId?: string;
  linkCI?: string; // seed CI name to link
  agedMins: number;
  agentReply?: string;
  internalNote?: string;
}[] = [
  {
    type: "incident",
    subject: "Can't connect to the VPN from home",
    body: "Since this morning GlobalProtect keeps saying 'connection failed' when I try to reach vpn.netlink.com. I'm working from home and can't get to any internal apps.",
    category: "Network",
    subcategory: "VPN",
    impact: "high",
    urgency: "medium",
    priority: "high",
    status: "open",
    requesterEmail: "dana.lee@netlink.com",
    assigneeId: "user_arjun",
    assignmentGroupId: GROUP_NETWORK,
    linkCI: "GlobalProtect VPN",
    agedMins: 38,
  },
  {
    type: "service_request",
    subject: "New laptop for incoming analyst",
    body: "We have a new analyst starting next Monday in the Pune office. Please provision a standard Windows laptop with the finance software image.",
    category: "Hardware",
    subcategory: "Laptop",
    impact: "medium",
    urgency: "medium",
    priority: "medium",
    status: "pending",
    requesterEmail: "meera.nair@netlink.com",
    assigneeId: "user_priya",
    assignmentGroupId: GROUP_SERVICE_DESK,
    agedMins: 220,
  },
  {
    type: "incident",
    subject: "Outlook stopped syncing new email",
    body: "Outlook hasn't pulled any new mail since last night. The web version works fine. I've already restarted twice.",
    category: "Software",
    subcategory: "Email",
    impact: "medium",
    urgency: "medium",
    priority: "medium",
    status: "auto_resolved",
    requesterEmail: "sam.patel@netlink.com",
    assignmentGroupId: GROUP_SERVICE_DESK,
    linkCI: "Microsoft 365",
    agedMins: 90,
    agentReply:
      "Thanks Sam — this is usually a stale local cache. Please close Outlook, delete the OST file, and reopen so it rebuilds. That clears the sync in almost all cases.",
  },
  {
    type: "incident",
    subject: "Locked out after too many password attempts",
    body: "I forgot my password and now I'm locked out. Can you help me reset it? I have a client call in an hour.",
    category: "Access",
    subcategory: "Password",
    impact: "high",
    urgency: "high",
    priority: "critical",
    status: "escalated",
    requesterEmail: "ravi.kumar@netlink.com",
    assigneeId: "user_priya",
    assignmentGroupId: GROUP_SERVICE_DESK,
    agedMins: 12,
    internalNote: "Verified identity over Teams video. Eligible for self-service reset once unlocked.",
  },
  {
    type: "incident",
    subject: "Microsoft Teams keeps signing me out",
    body: "Teams signs me out every couple of hours on both desktop and web. Re-authenticating constantly is killing my day.",
    category: "Software",
    subcategory: "Collaboration",
    impact: "medium",
    urgency: "low",
    priority: "low",
    status: "closed",
    requesterEmail: "dana.lee@netlink.com",
    assigneeId: "user_arjun",
    assignmentGroupId: GROUP_SERVICE_DESK,
    agedMins: 1440,
    agentReply: "Cleared the Teams credential cache and re-registered the device. Should stay signed in now.",
  },
  {
    type: "service_request",
    subject: "Update payroll bank details before the next cycle",
    body: "I've switched banks and need my salary account updated before this month's payroll run. Happy to share the new details over a secure channel.",
    category: "HR",
    subcategory: "Payroll",
    impact: "medium",
    urgency: "high",
    priority: "high",
    status: "in_progress",
    requesterEmail: "sam.patel@netlink.com",
    assigneeId: "user_anita",
    assignmentGroupId: GROUP_PEOPLE_OPS,
    agedMins: 150,
    agentReply:
      "Hi Sam — I've sent you a secure form link to submit the new account details. Once you fill it in, the change lands in this month's run.",
  },
  {
    type: "incident",
    subject: "External monitor not detected at hot desk 12F",
    body: "The docking station at hot desk 12F won't detect my external monitor. Tried re-plugging the USB-C cable and restarting — laptop screen works fine.",
    category: "Hardware",
    subcategory: "Peripherals",
    impact: "low",
    urgency: "medium",
    priority: "low",
    status: "in_progress",
    requesterEmail: "emily.chen@netlink.com",
    assigneeId: "user_sarah",
    assignmentGroupId: GROUP_SERVICE_DESK,
    agedMins: 65,
    internalNote: "Dock at 12F flagged before — likely firmware. Taking a spare dock over after standup.",
  },
  {
    type: "incident",
    subject: "Printer offline on the 3rd floor",
    body: "The shared printer near the 3rd-floor kitchen shows offline for everyone. Power-cycling didn't help.",
    category: "Hardware",
    subcategory: "Printer",
    impact: "low",
    urgency: "low",
    priority: "very_low",
    status: "new",
    requesterEmail: "emily.chen@netlink.com",
    assignmentGroupId: GROUP_HARDWARE,
    agedMins: 4,
  },
  {
    type: "incident",
    subject: "VPN is slow after the latest client update",
    body: "Since updating GlobalProtect, throughput over the VPN dropped noticeably. Downloads crawl.",
    category: "Network",
    subcategory: "VPN",
    impact: "medium",
    urgency: "medium",
    priority: "medium",
    status: "pending_agent",
    requesterEmail: "dana.lee@netlink.com",
    assignmentGroupId: GROUP_NETWORK,
    linkCI: "GlobalProtect VPN",
    agedMins: 22,
    agentReply:
      "Draft: This is often the split-tunnel setting after an update. Try toggling split-tunnel off, reconnect, and re-test throughput.",
  },
  {
    type: "service_request",
    subject: "Password reset for the shared finance mailbox",
    body: "Please reset the password for finance-shared@netlink.com and share it securely.",
    category: "Access",
    subcategory: "Password",
    impact: "medium",
    urgency: "medium",
    priority: "medium",
    status: "resolved",
    requesterEmail: "sam.patel@netlink.com",
    assigneeId: "user_arjun",
    assignmentGroupId: GROUP_ACCESS,
    agedMins: 320,
    agentReply: "Done — the shared mailbox password was reset and sent to you via the secure vault link.",
  },
  {
    type: "incident",
    subject: "External monitor flickering again after the last fix",
    body: "The flicker is back on my external display. You swapped the dock last month but it has returned.",
    category: "Hardware",
    subcategory: "Peripherals",
    impact: "low",
    urgency: "medium",
    priority: "low",
    status: "reopened",
    requesterEmail: "emily.chen@netlink.com",
    assigneeId: "user_sarah",
    assignmentGroupId: GROUP_HARDWARE,
    agedMins: 760,
    agentReply: "Reopening is fine — we'll ship another dock and check the cable run. Keeping this open while we investigate.",
  },
  {
    type: "service_request",
    subject: "Duplicate laptop request — please ignore",
    body: "I accidentally raised this twice. This one can be cancelled.",
    category: "Hardware",
    subcategory: "Laptop",
    impact: "low",
    urgency: "low",
    priority: "very_low",
    status: "cancelled",
    requesterEmail: "ravi.kumar@netlink.com",
    assignmentGroupId: GROUP_HARDWARE,
    agedMins: 520,
  },
  {
    type: "service_request",
    subject: "Salesforce access for a new account executive",
    body: "Requesting Salesforce access for a new AE joining the Pune sales team. Manager approval required.",
    category: "Access",
    subcategory: "Application",
    impact: "medium",
    urgency: "medium",
    priority: "medium",
    status: "pending",
    requesterEmail: "ravi.kumar@netlink.com",
    assignmentGroupId: GROUP_ACCESS,
    agedMins: 55,
  },
  {
    type: "incident",
    subject: "Payroll portal down before the cutoff",
    body: "The payroll portal returns 502 errors and the monthly cutoff is in a few hours. This is blocking the whole finance team.",
    category: "Software",
    subcategory: "Payroll",
    impact: "high",
    urgency: "high",
    priority: "high",
    status: "escalated",
    requesterEmail: "sam.patel@netlink.com",
    assigneeId: "user_arjun",
    assignmentGroupId: GROUP_SERVICE_DESK,
    linkCI: "Payroll App",
    agedMins: 500,
    internalNote: "Escalated to the app team — suspected DB connection pool exhaustion on PROD-01.",
  },
];

export async function buildSeed(): Promise<SeedData> {
  const tenantId = NETLINK_TENANT_ID;
  const tenant: TenantRow = {
    id: tenantId,
    name: "Netlink Software Group America",
    slug: "netlink",
    brand: "Netlink Support",
    isInternal: true,
    createdAt: now(),
    updatedAt: now(),
  };

  const users: UserRow[] = [
    mkUser("user_priya", tenantId, "Priya Sharma", "priya.sharma@netlink.com", "tenant_admin", "IT Operations Lead", "PS", {
      department: "IT Service Desk",
      phone: "+91 80 4012 8890",
      location: "Bengaluru, IN",
      timezone: "Asia/Kolkata (IST)",
      bio: "Leads day-to-day IT operations and incident response for Netlink. Focused on automation, SLA health, and keeping the service desk fast and predictable.",
    }),
    mkUser("user_arjun", tenantId, "Arjun Mehta", "arjun.mehta@netlink.com", "agent", "Service Desk Engineer", "AM", {
      department: "IT Service Desk",
      phone: "+91 80 4012 8917",
      location: "Bengaluru, IN",
      timezone: "Asia/Kolkata (IST)",
      bio: "First responder on the queue — triages incoming tickets, handles access and software requests, and escalates the tricky ones.",
    }),
    mkUser("user_meera", tenantId, "Meera Nair", "meera.nair@netlink.com", "manager", "IT Manager", "MN", {
      department: "IT Service Desk",
      phone: "+91 80 4012 8901",
      location: "Bengaluru, IN",
      timezone: "Asia/Kolkata (IST)",
      bio: "Manages the service desk. Approves service requests and changes, and watches SLA health across the team.",
    }),
    mkUser("user_sarah", tenantId, "Sarah Johnson", "sarah.johnson@netlink.com", "agent", "Desktop Support Engineer", "SJ", {
      department: "IT Service Desk",
      phone: "+1 (628) 555-0122",
      location: "San Francisco, US",
      timezone: "America/Los_Angeles (PT)",
      bio: "Handles endpoint hardware, peripherals, and workplace tech for the US offices.",
    }),
    mkUser("user_luis", tenantId, "Luis Moreno", "luis.moreno@netlink.com", "agent", "Network Engineer", "LM", {
      department: "Network Operations",
      phone: "+1 (512) 555-0187",
      location: "Austin, US",
      timezone: "America/Chicago (CT)",
      bio: "Runs VPN, Wi-Fi, and site connectivity. On the escalation path for network incidents.",
    }),
    mkUser("user_anita", tenantId, "Anita Desai", "anita.desai@netlink.com", "agent", "HR Operations Partner", "AD", {
      department: "People Operations",
      phone: "+91 22 4890 3311",
      location: "Mumbai, IN",
      timezone: "Asia/Kolkata (IST)",
      bio: "Owns HR service requests — onboarding, payroll queries, and policy questions.",
    }),
    mkUser("user_vikram", tenantId, "Vikram Rao", "vikram.rao@netlink.com", "super_admin", "Platform Administrator", "VR", {
      department: "Platform Engineering",
      phone: "+91 80 4012 8800",
      location: "Bengaluru, IN",
      timezone: "Asia/Kolkata (IST)",
      bio: "Administers the Netlink Support platform itself — tenants, integrations, API keys, and audit.",
    }),
    mkUser("user_dana", tenantId, "Dana Lee", "dana.lee@netlink.com", "requester", "Marketing Specialist", "DL", {
      department: "Marketing",
      phone: "+1 (415) 555-0148",
      location: "San Francisco, US",
      timezone: "America/Los_Angeles (PT)",
      bio: "Part of the marketing team. Uses the help center for IT and HR requests.",
    }),
    mkUser("user_sam", tenantId, "Sam Patel", "sam.patel@netlink.com", "requester", "Financial Analyst", "SP", {
      department: "Finance",
      phone: "+1 (212) 555-0165",
      location: "New York, US",
      timezone: "America/New_York (ET)",
      bio: "Works in FP&A. Raises requests for finance systems, payroll, and reporting access.",
    }),
    mkUser("user_ravi", tenantId, "Ravi Kumar", "ravi.kumar@netlink.com", "requester", "Account Executive", "RK", {
      department: "Sales",
      phone: "+91 98 2011 4455",
      location: "Pune, IN",
      timezone: "Asia/Kolkata (IST)",
      bio: "Field sales. Depends on CRM, VPN, and mobile access while travelling.",
    }),
    mkUser("user_emily", tenantId, "Emily Chen", "emily.chen@netlink.com", "requester", "Product Designer", "EC", {
      department: "Design",
      phone: "+1 (206) 555-0139",
      location: "Seattle, US",
      timezone: "America/Los_Angeles (PT)",
      bio: "Product design team. Occasional requests for creative software and hardware.",
    }),
  ];

  // First-class departments derived from the seeded user department labels;
  // each user is linked by departmentId while `department` keeps the label.
  const deptNames = [...new Set(users.map((u) => u.department).filter(Boolean))] as string[];
  const departments: DepartmentRow[] = deptNames.map((name) => ({
    id: newId("dept"),
    tenantId,
    name,
    description: null,
    createdAt: now(),
    updatedAt: now(),
  }));
  const deptIdByName = new Map(departments.map((d) => [d.name, d.id]));
  for (const u of users) {
    u.departmentId = u.department ? deptIdByName.get(u.department) ?? null : null;
  }

  // Specialist "profiles" own one request-type category each and use the
  // `manual` strategy, so intake routes a ticket to the group but leaves it
  // unassigned for a human dispatcher to assign from the Triage queue. The
  // generalist Service Desk handles the common/leftover categories. Categories
  // are non-overlapping so category -> group routing is unambiguous.
  const groups: AssignmentGroupRow[] = [
    {
      id: GROUP_ACCESS,
      tenantId,
      name: "Access & Identity",
      description: "Application access, accounts, SSO/MFA, and permissions.",
      memberIds: ["user_arjun", "user_sarah"],
      categories: ["Access"],
      leadId: "user_arjun",
      strategy: "manual",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: GROUP_NETWORK,
      tenantId,
      name: "Network Operations",
      description: "Connectivity, VPN, guest Wi-Fi, and network infrastructure.",
      memberIds: ["user_arjun", "user_luis"],
      categories: ["Network"],
      leadId: "user_luis",
      strategy: "manual",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: GROUP_HARDWARE,
      tenantId,
      name: "Endpoint & Hardware",
      description: "Laptops, peripherals, and workplace hardware provisioning.",
      memberIds: ["user_sarah", "user_luis"],
      categories: ["Hardware"],
      leadId: "user_sarah",
      strategy: "manual",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: GROUP_SOFTWARE,
      tenantId,
      name: "Software & Apps",
      description: "Software installs, licensing, and application support.",
      memberIds: ["user_arjun", "user_sarah"],
      categories: ["Software"],
      leadId: "user_arjun",
      strategy: "manual",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: GROUP_SERVICE_DESK,
      tenantId,
      name: "Service Desk",
      description: "Generalist first-line support for common IT, billing, and other requests.",
      memberIds: ["user_priya", "user_arjun", "user_sarah"],
      categories: ["IT", "Billing", "Other"],
      leadId: "user_priya",
      strategy: "manual",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: GROUP_PEOPLE_OPS,
      tenantId,
      name: "People Operations",
      description: "HR service requests — onboarding, payroll, benefits, and policy questions.",
      memberIds: ["user_anita"],
      categories: ["HR"],
      leadId: "user_anita",
      strategy: "round_robin",
      lastAssignedIndex: 0,
      createdAt: now(),
      updatedAt: now(),
    },
  ];

  // Spec SLA matrix: P1 15m/2h, P2 1h/4h, P3 2h/24h, P4 4h/3d, P5 8h/5d.
  const slaDefaults: [TicketRow["priority"], number, number][] = [
    ["critical", 15, 2 * 60],
    ["high", 60, 4 * 60],
    ["medium", 2 * 60, 24 * 60],
    ["low", 4 * 60, 3 * 24 * 60],
    ["very_low", 8 * 60, 5 * 24 * 60],
  ];
  const slaPolicies: SlaPolicyRow[] = slaDefaults.map(([priority, responseMins, resolveMins]) => ({
    id: newId("sla"),
    tenantId,
    name: "Default",
    priority,
    responseMins,
    resolveMins,
    businessHoursOnly: false,
    createdAt: now(),
    updatedAt: now(),
  }));

  const articles: ArticleRow[] = [];
  for (const a of KB_ARTICLES) {
    const { vector, model } = await embed(`${a.title}. ${a.tags.join(" ")}. ${a.content}`);
    articles.push({
      id: newId("kb"),
      tenantId,
      title: a.title,
      content: a.content,
      category: a.category,
      tags: a.tags,
      status: "published",
      version: 1,
      authorId: "user_priya",
      isPublic: true,
      embedding: vector,
      embeddingModel: model,
      createdAt: now(),
      updatedAt: now(),
    });
  }

  const catalogItems: CatalogItemRow[] = [
    mkCatalog(tenantId, "New laptop", "Request a standard managed laptop for a new or existing employee.", "Hardware", true),
    mkCatalog(tenantId, "Software install", "Request installation of approved software not in Company Portal.", "Software", true),
    mkCatalog(tenantId, "Application access", "Request access to a business application (manager approval required).", "Access", true),
    mkCatalog(tenantId, "Guest Wi-Fi", "Request temporary guest Wi-Fi credentials for a visitor.", "Network", false),
  ];

  const assets: AssetRow[] = [
    mkAsset(tenantId, "NL-LT-0418", "Dell Latitude 7440", "laptop", "assigned", "dana.lee@netlink.com"),
    mkAsset(tenantId, "NL-SV-0007", "App Server PROD-01", "server", "assigned", "infra-team"),
  ];
  const cis: CIRow[] = [
    mkCI(tenantId, "GlobalProtect VPN", "service"),
    mkCI(tenantId, "Microsoft 365", "application"),
    mkCI(tenantId, "PROD-01 App Server", "server", assets[1].id),
    mkCI(tenantId, "Payroll App", "application"),
    mkCI(tenantId, "Core Database", "database"),
    mkCI(tenantId, "Primary Firewall", "network"),
  ];
  const ciByName = new Map(cis.map((c) => [c.name, c.id]));
  const slaByPriority = new Map(slaPolicies.map((p) => [p.priority, p]));

  const tickets: TicketRow[] = [];
  const messages: TicketMessageRow[] = [];
  const events: TicketEventRow[] = [];

  for (const t of TICKETS) {
    const id = newId("tkt");
    const createdAt = minutesAgo(t.agedMins);
    const resolved = t.status === "auto_resolved" || t.status === "closed" || t.status === "resolved";
    const linkedCI = t.linkCI ? ciByName.get(t.linkCI) : undefined;
    const slaPolicy = slaByPriority.get(t.priority);
    const slaActive = !resolved && t.status !== "cancelled";
    const paused = t.status === "pending";
    tickets.push({
      id,
      reference: ticketReference(t.type),
      tenantId,
      type: t.type,
      subject: t.subject,
      body: t.body,
      status: t.status,
      priority: t.priority,
      impact: t.impact,
      urgency: t.urgency,
      category: t.category,
      subcategory: t.subcategory ?? null,
      channel: "portal",
      source: "seed",
      tags: [],
      customFields: null,
      requesterEmail: t.requesterEmail,
      requesterId: null,
      assigneeId: t.assigneeId ?? null,
      assignmentGroupId: t.assignmentGroupId ?? null,
      problemId: null,
      changeId: null,
      catalogItemId: null,
      ciIds: linkedCI ? [linkedCI] : [],
      linkedTicketIds: [],
      mergedIntoId: null,
      satisfaction: null,
      resolutionNotes: null,
      firstRespondedAt: t.agentReply ? minutesAgo(Math.max(0, t.agedMins - 20)) : null,
      resolvedAt: resolved ? minutesAgo(Math.max(0, t.agedMins - 30)) : null,
      closedAt: t.status === "closed" ? minutesAgo(Math.max(0, t.agedMins - 30)) : null,
      dueResponseAt: slaPolicy && slaActive ? addMins(createdAt, slaPolicy.responseMins) : null,
      dueResolveAt: slaPolicy && slaActive ? addMins(createdAt, slaPolicy.resolveMins) : null,
      slaPolicyId: slaPolicy ? slaPolicy.id : null,
      slaPausedAt: paused ? minutesAgo(Math.max(0, t.agedMins - 15)) : null,
      slaPausedMins: paused ? 15 : 0,
      createdAt,
      updatedAt: createdAt,
    });

    events.push(mkEvent(id, "created", `Ticket ingested via portal.`, createdAt));
    if (t.assigneeId) events.push(mkEvent(id, "assigned", `Assigned to an agent.`, minutesAgo(t.agedMins - 5)));
    if (t.internalNote) {
      messages.push(mkMessage(id, "agent", "Priya Sharma", "internal", t.internalNote, minutesAgo(t.agedMins - 8)));
      events.push(mkEvent(id, "note_added", "An internal note was added.", minutesAgo(t.agedMins - 8)));
    }
    if (t.agentReply) {
      messages.push(mkMessage(id, "agent", "Service Desk", "public", t.agentReply, minutesAgo(t.agedMins - 20)));
      events.push(mkEvent(id, "reply_sent", "A public reply was sent to the requester.", minutesAgo(t.agedMins - 20)));
    }
  }

  const vpnProblem: ProblemRow = {
    id: newId("prb"),
    reference: reference("PRB"),
    tenantId,
    title: "Recurring VPN drops for remote staff on UDP",
    description:
      "Multiple remote users report GlobalProtect dropping every 20-30 minutes on UDP. Switching to TCP is a reliable workaround.",
    status: "known_error",
    priority: "high",
    impact: "high",
    urgency: "medium",
    category: "Network",
    rootCause: "ISP-level UDP throttling affecting the default GlobalProtect transport.",
    rcaMethod: "five_whys",
    workaround: "Set GlobalProtect transport to TCP for affected users until the gateway change ships.",
    knownError: true,
    publishedArticleId: null,
    changeId: null,
    reviewNotes: null,
    notes: [],
    assigneeId: "user_arjun",
    createdAt: minutesAgo(3000),
    updatedAt: minutesAgo(200),
  };
  const onboardingProblem: ProblemRow = {
    id: newId("prb"),
    reference: reference("PRB"),
    tenantId,
    title: "New hires missing application access on day one",
    description:
      "Several new joiners this quarter could not access role-based apps on their first day, creating duplicate access tickets.",
    status: "investigating",
    priority: "medium",
    impact: "medium",
    urgency: "medium",
    category: "Access",
    rootCause: null,
    rcaMethod: null,
    workaround: "Service desk grants temporary access manually while the joiner provisioning workflow is investigated.",
    knownError: false,
    publishedArticleId: null,
    changeId: null,
    reviewNotes: null,
    notes: [],
    assigneeId: "user_priya",
    createdAt: minutesAgo(5000),
    updatedAt: minutesAgo(1000),
  };
  const problems: ProblemRow[] = [vpnProblem, onboardingProblem];

  // Link the seeded VPN incident to the VPN problem for a realistic demo.
  const vpnIncident = tickets.find((t) => t.subject.toLowerCase().includes("vpn"));
  if (vpnIncident) vpnIncident.problemId = vpnProblem.id;

  const automations: AutomationRow[] = [
    {
      id: newId("auto"),
      tenantId,
      name: "Auto-assign network incidents to the network pod",
      enabled: true,
      trigger: "ticket.created",
      conditions: [{ field: "category", op: "eq", value: "Network" }],
      actions: [{ type: "assign", assigneeId: "user_arjun" }],
      runCount: 0,
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: newId("auto"),
      tenantId,
      name: "Escalate critical (P1) tickets immediately",
      enabled: true,
      trigger: "ticket.created",
      conditions: [{ field: "priority", op: "eq", value: "critical" }],
      actions: [{ type: "set_status", status: "escalated" }, { type: "notify", target: "manager" }],
      runCount: 0,
      createdAt: now(),
      updatedAt: now(),
    },
  ];

  const macros: MacroRow[] = [
    {
      id: newId("macro"),
      tenantId,
      name: "Ask for more details",
      body: "Hi {{requester_name}}, thanks for reaching out about {{reference}}. To help us resolve this quickly, could you share a screenshot of the error and the approximate time it started?",
      visibility: "public",
      category: "General",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: newId("macro"),
      tenantId,
      name: "VPN reset steps",
      body: "Please try these steps:\n1. Fully quit the VPN client.\n2. Restart your machine.\n3. Reconnect using your Netlink credentials.\nLet us know if the issue persists and we'll dig deeper.",
      visibility: "public",
      category: "Network",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: newId("macro"),
      tenantId,
      name: "Internal: awaiting vendor",
      body: "Holding this with the vendor — follow up if no response within 24h.",
      visibility: "internal",
      category: "General",
      createdAt: now(),
      updatedAt: now(),
    },
  ];

  const customFieldDefs: CustomFieldDefRow[] = [
    {
      id: newId("cfd"),
      tenantId,
      key: "cost_center",
      label: "Cost center",
      type: "text",
      options: [],
      required: false,
      order: 0,
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: newId("cfd"),
      tenantId,
      key: "environment",
      label: "Environment",
      type: "select",
      options: ["Production", "Staging", "Development"],
      required: false,
      order: 1,
      createdAt: now(),
      updatedAt: now(),
    },
  ];

  // ---- Business calendar (SLA working hours) -------------------------------
  const calendars: BusinessCalendarRow[] = [
    {
      id: newId("cal"),
      tenantId,
      name: "India Support Hours",
      timezone: "Asia/Kolkata",
      workDays: [1, 2, 3, 4, 5],
      startHour: 9,
      endHour: 18,
      holidays: ["2026-01-26", "2026-08-15", "2026-10-02"],
      createdAt: now(),
      updatedAt: now(),
    },
  ];
  const mediumPolicy = slaPolicies.find((p) => p.priority === "medium");
  if (mediumPolicy) mediumPolicy.calendarId = calendars[0].id;

  // ---- Change management (full CAB lifecycle) ------------------------------
  const changes: ChangeRow[] = [
    mkChange(tenantId, "Upgrade core switch firmware", "Apply vendor firmware 9.4 to the core switches during the maintenance window.", "normal", "draft", 42, "Moderate blast radius; rollback plan documented. Off-hours reduces impact.", 200),
    mkChange(tenantId, "Migrate mailboxes to a new M365 region", "Move 400 mailboxes to the new data region for latency and compliance.", "normal", "awaiting_approval", 68, "High user impact and a long migration window; needs CAB sign-off.", 320),
    mkChange(tenantId, "Rotate public TLS certificates", "Scheduled rotation of public TLS certificates before expiry.", "standard", "approved", 15, "Pre-approved standard change; low risk, well rehearsed.", 90),
    mkChange(tenantId, "Quarterly firewall ruleset review", "Review and prune stale firewall rules.", "normal", "scheduled", 55, "Medium risk; a mistaken rule change could block traffic.", 500),
    mkChange(tenantId, "Emergency VPN gateway patch", "Patch a critical CVE on the VPN gateway.", "emergency", "implementing", 80, "High urgency and risk; an active exploit is circulating.", 60),
    mkChange(tenantId, "Decommission legacy file server", "Retire FS-OLD-02 after data migration completes.", "normal", "closed", 30, "Low risk; data already migrated and verified.", 4000),
    mkChange(tenantId, "Open RDP to a vendor subnet", "Vendor requested direct RDP access for support.", "normal", "rejected", 92, "Unacceptable exposure; violates the zero-trust policy.", 700),
  ];
  const changeByStatus = (s: ChangeRow["status"]) => changes.find((c) => c.status === s)!;

  // ---- Approvals (ticket service-request + CAB) ----------------------------
  const salesforceTicket = tickets.find((t) => t.subject.toLowerCase().includes("salesforce"));
  if (salesforceTicket) {
    salesforceTicket.catalogItemId = catalogItems.find((c) => c.name === "Application access")?.id ?? null;
  }
  const awaitingChange = changeByStatus("awaiting_approval");
  const approvedChange = changeByStatus("approved");
  const rejectedChange = changeByStatus("rejected");
  const approvals: ApprovalRow[] = [
    ...(salesforceTicket
      ? [mkApproval({ ticketId: salesforceTicket.id, approverId: "user_meera", approverName: "Meera Nair", state: "pending", agedMins: 50 })]
      : []),
    mkApproval({ changeId: awaitingChange.id, approverId: "user_meera", approverName: "Meera Nair", state: "pending", agedMins: 300 }),
    mkApproval({ changeId: awaitingChange.id, approverId: "user_priya", approverName: "Priya Sharma", state: "pending", agedMins: 300 }),
    mkApproval({ changeId: approvedChange.id, approverId: "user_meera", approverName: "Meera Nair", state: "approved", comment: "Low risk, well rehearsed.", agedMins: 80, decided: true }),
    mkApproval({ changeId: rejectedChange.id, approverId: "user_meera", approverName: "Meera Nair", state: "rejected", comment: "Security risk too high.", agedMins: 680, decided: true }),
  ];

  // ---- CI dependency graph (impact analysis) -------------------------------
  const rel = (srcName: string, tgtName: string, kind = "depends_on"): CIRelationshipRow => ({
    id: newId("rel"),
    sourceId: ciByName.get(srcName)!,
    targetId: ciByName.get(tgtName)!,
    kind,
  });
  const ciRelationships: CIRelationshipRow[] = [
    rel("Payroll App", "Core Database"),
    rel("Payroll App", "PROD-01 App Server"),
    rel("GlobalProtect VPN", "Primary Firewall"),
    rel("Microsoft 365", "Primary Firewall"),
  ];

  // ---- Notifications (in-app feed: unread + read) --------------------------
  const vpnTicket = tickets.find((t) => t.subject.toLowerCase().includes("vpn"));
  const vpnLink = vpnTicket ? `/tickets/${vpnTicket.id}` : "/tickets";
  const notifications: NotificationRow[] = [
    mkNotif(tenantId, "arjun.mehta@netlink.com", "Ticket assigned to you", "A network incident was routed to you.", vpnLink, false, 30),
    mkNotif(tenantId, "arjun.mehta@netlink.com", "SLA at risk", "A ticket has passed 80% of its resolution window.", vpnLink, false, 12),
    mkNotif(tenantId, "arjun.mehta@netlink.com", "New reply from requester", "The requester added a comment to a ticket.", vpnLink, true, 140),
    mkNotif(tenantId, "meera.nair@netlink.com", "Approval needed", "A service request is awaiting your approval.", salesforceTicket ? `/tickets/${salesforceTicket.id}` : "/tickets", false, 48),
    mkNotif(tenantId, "meera.nair@netlink.com", "Change awaiting CAB", "A change is awaiting CAB approval.", "/changes", false, 55),
  ];

  // ---- API integrations (seeded; secrets are not recoverable) --------------
  const apiKeys: ApiKeyRow[] = [
    mkApiKey(tenantId, "Zabbix monitoring", "agent", ["user_luis"], "Monitoring alerts open incidents automatically."),
    mkApiKey(tenantId, "Statuspage sync", "agent", ["user_arjun", "user_sarah"], "Publishes incident status to the public page."),
  ];

  // ---- Extra problems (status coverage) + linkages -------------------------
  problems.push(
    {
      id: newId("prb"),
      reference: reference("PRB"),
      tenantId,
      title: "Intermittent SSO failures at peak login",
      description: "Users report sporadic SSO timeouts between 9-10am when login volume peaks.",
      status: "open",
      priority: "high",
      impact: "high",
      urgency: "medium",
      category: "Access",
      rootCause: null,
      rcaMethod: null,
      workaround: null,
      knownError: false,
      publishedArticleId: null,
      changeId: null,
      reviewNotes: null,
      notes: [],
      assigneeId: "user_priya",
      createdAt: minutesAgo(2600),
      updatedAt: minutesAgo(120),
    },
    {
      id: newId("prb"),
      reference: reference("PRB"),
      tenantId,
      title: "Email delivery delays (resolved)",
      description: "Outbound email was delayed due to a greylisting misconfiguration after the relay upgrade.",
      status: "resolved",
      priority: "medium",
      impact: "medium",
      urgency: "medium",
      category: "Software",
      rootCause: "Greylisting threshold set too aggressively after the mail relay upgrade.",
      rcaMethod: "timeline",
      workaround: "Whitelist internal relays.",
      knownError: false,
      publishedArticleId: null,
      changeId: null,
      reviewNotes: "Fixed by adjusting the relay config; monitoring for recurrence.",
      notes: [],
      assigneeId: "user_arjun",
      createdAt: minutesAgo(8000),
      updatedAt: minutesAgo(3000),
    }
  );
  // The known-error VPN problem: published to KB and with a permanent-fix change.
  vpnProblem.publishedArticleId = articles[0]?.id ?? null;
  vpnProblem.changeId = changeByStatus("draft").id;

  // ---- KB status coverage (draft + in review) ------------------------------
  for (const d of [
    { title: "Draft: New VPN split-tunnel policy", status: "draft" as const, tags: ["vpn", "policy"] },
    { title: "In review: Laptop refresh eligibility", status: "in_review" as const, tags: ["hardware", "policy"] },
  ]) {
    const { vector, model } = await embed(`${d.title}. ${d.tags.join(" ")}.`);
    articles.push({
      id: newId("kb"),
      tenantId,
      title: d.title,
      content: `${d.title}\n\nThis article is ${d.status.replace("_", " ")} and not yet published.`,
      category: "IT",
      tags: d.tags,
      status: d.status,
      version: 1,
      authorId: "user_arjun",
      isPublic: false,
      embedding: vector,
      embeddingModel: model,
      createdAt: now(),
      updatedAt: now(),
    });
  }

  return {
    tenants: [tenant],
    departments,
    users,
    groups,
    calendars,
    slaPolicies,
    articles,
    catalogItems,
    tickets,
    messages,
    events,
    problems,
    changes,
    approvals,
    assets,
    cis,
    ciRelationships,
    notifications,
    apiKeys,
    automations,
    macros,
    customFieldDefs,
  };
}

// ---- small builders --------------------------------------------------------

function mkUser(
  id: string,
  tenantId: string,
  name: string,
  email: string,
  role: UserRow["role"],
  title: string,
  initials: string,
  profile: Partial<Pick<UserRow, "department" | "phone" | "location" | "timezone" | "bio">> = {}
): UserRow {
  return {
    id,
    tenantId,
    name,
    email,
    role,
    title,
    department: profile.department ?? null,
    initials,
    active: true,
    externalId: null,
    phone: profile.phone ?? null,
    location: profile.location ?? null,
    timezone: profile.timezone ?? null,
    bio: profile.bio ?? null,
    preferences: {
      emailNotifications: true,
      desktopNotifications: false,
      weeklyDigest: true,
      mentionAlerts: true,
    },
    available: true,
    createdAt: now(),
    updatedAt: now(),
  };
}

function mkCatalog(
  tenantId: string,
  name: string,
  description: string,
  category: CatalogItemRow["category"],
  requiresApproval: boolean
): CatalogItemRow {
  return {
    id: newId("cat"),
    tenantId,
    name,
    description,
    category,
    requiresApproval,
    formSchema: null,
    active: true,
    createdAt: now(),
    updatedAt: now(),
  };
}

function mkMessage(
  ticketId: string,
  authorKind: TicketMessageRow["authorKind"],
  authorName: string,
  visibility: TicketMessageRow["visibility"],
  body: string,
  at: string
): TicketMessageRow {
  return { id: newId("msg"), ticketId, authorKind, authorName, visibility, body, createdAt: at };
}

function mkEvent(ticketId: string, type: string, message: string, at: string): TicketEventRow {
  return { id: newId("evt"), ticketId, type, message, meta: null, createdAt: at };
}

function mkAsset(
  tenantId: string,
  tag: string,
  name: string,
  type: string,
  status: AssetRow["status"],
  owner: string
): AssetRow {
  return {
    id: newId("ast"),
    tenantId,
    tag,
    name,
    type,
    status,
    owner,
    purchasedAt: null,
    warrantyEnd: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

function mkCI(tenantId: string, name: string, type: CIRow["type"], assetId?: string): CIRow {
  return {
    id: newId("ci"),
    tenantId,
    name,
    type,
    status: "operational",
    assetId: assetId ?? null,
    attributes: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

/** Add minutes to an ISO timestamp (for SLA due dates relative to createdAt). */
function addMins(iso: string, m: number): string {
  return new Date(new Date(iso).getTime() + m * 60000).toISOString();
}

function mkChange(
  tenantId: string,
  title: string,
  description: string,
  type: ChangeRow["type"],
  status: ChangeRow["status"],
  riskScore: number,
  riskRationale: string,
  agedMins: number
): ChangeRow {
  const at = minutesAgo(agedMins);
  return {
    id: newId("chg"),
    reference: reference("CHG"),
    tenantId,
    title,
    description,
    type,
    status,
    riskScore,
    riskRationale,
    plannedStart: null,
    plannedEnd: null,
    implementer: null,
    createdAt: at,
    updatedAt: at,
  };
}

function mkApproval(input: {
  changeId?: string;
  ticketId?: string;
  approverId: string;
  approverName: string;
  state: ApprovalRow["state"];
  comment?: string;
  agedMins: number;
  decided?: boolean;
}): ApprovalRow {
  const at = minutesAgo(input.agedMins);
  return {
    id: newId("apr"),
    changeId: input.changeId ?? null,
    ticketId: input.ticketId ?? null,
    approverId: input.approverId,
    approverName: input.approverName,
    state: input.state,
    comment: input.comment ?? null,
    decidedAt: input.decided ? at : null,
    createdAt: at,
  };
}

function mkNotif(
  tenantId: string,
  to: string,
  subject: string,
  body: string,
  link: string | null,
  read: boolean,
  agedMins: number
): NotificationRow {
  const at = minutesAgo(agedMins);
  return {
    id: newId("ntf"),
    tenantId,
    channel: "in_app",
    toAddress: to,
    subject,
    body,
    link,
    sent: true,
    sentAt: at,
    readAt: read ? at : null,
    createdAt: at,
  };
}

function mkApiKey(
  tenantId: string,
  name: string,
  role: UserRow["role"],
  agentIds: string[],
  description: string
): ApiKeyRow {
  const secret = `nlk_${newId("k")}`;
  return {
    id: newId("key"),
    tenantId,
    name,
    prefix: secret.slice(0, 10),
    keyHash: createHash("sha256").update(secret, "utf8").digest("hex"),
    role,
    agentIds,
    description,
    active: true,
    lastUsedAt: null,
    expiresAt: null,
    createdBy: "Seed",
    createdAt: now(),
    updatedAt: now(),
  };
}

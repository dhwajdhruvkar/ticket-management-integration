// =============================================================================
// Tooltip copy deck.
//
// Every "i" hover hint in the product resolves to a string in here so the
// wording stays consistent and reviewable in one place. Keep entries to one or
// two plain sentences: they explain what a field/metric means and, where it
// matters, what changing it will do. Grouped roughly by the screen they serve.
// =============================================================================

import type { CustomFieldType } from "@/server/domain/models";

export const HINTS = {
  // --- Ticket fields (ITIL) -------------------------------------------------
  assignee: "The individual agent who owns this ticket. Assigning notifies them and moves the ticket into their queue.",
  assignmentGroup:
    "The team responsible for this ticket. Groups can auto-assign a member using their routing strategy (manual, round robin, or least loaded).",
  impact:
    "How widely the issue is felt: one person (low), a team or site (medium), or the whole organisation (high). Half of the priority calculation.",
  urgency:
    "How quickly the issue must be fixed, independent of how many people it affects. The other half of the priority calculation.",
  derivedPriority:
    "P1 to P5, calculated from impact x urgency using the ITIL matrix. Overriding it manually requires a justification and is recorded in the audit trail.",
  category: "The service area this ticket belongs to. Drives group routing, automation rules, and reporting breakdowns.",
  subcategory: "A free-text refinement of the category (for example VPN under Network). Used for reporting and trend spotting.",
  affectedCIs:
    "Configuration items from the CMDB that this ticket affects. Linking them powers impact analysis and shows every open ticket touching the same infrastructure.",
  tags: "Free-form labels for searching and filtering. Automation rules can add tags, for example sla_breached.",
  ticketType: "Incident means something is broken and needs restoring. Service request means someone needs something provided or granted.",
  customField: "A custom field defined by your administrators in Settings. Its value is stored on the ticket and included in exports.",

  // --- SLA ------------------------------------------------------------------
  sla: "The response and resolution deadlines from the SLA policy that matched this ticket's priority.",
  slaFirstResponse: "The deadline for the first public reply to the requester. It stops as soon as an agent responds.",
  slaResolution: "The deadline for restoring service. It stops when the ticket is resolved or closed.",
  slaAtRisk: "80% or more of the SLA window has elapsed and the ticket is still open. A warning has been sent to the owner and their group.",
  slaBreached: "The SLA deadline passed before the ticket was answered or resolved. Breaches escalate automatically and are tagged for reporting.",
  slaPaused:
    "The SLA clock stops while a ticket is on hold waiting for the requester or an approval, and resumes when it becomes active again.",
  slaPolicy:
    "Response and resolution targets per priority. Attach a business calendar to count only working hours instead of wall-clock time.",
  slaCompliance: "The share of tickets at each priority that met their SLA target, so you can see which priority band is under pressure.",
  businessCalendar:
    "Working hours, timezone, and holidays used for SLA maths. Without one, deadlines count every hour of the day.",

  // --- AI -------------------------------------------------------------------
  aiAnalysis: "What the assistant found when it triaged this ticket: its classification, the knowledge it used, and the action it took.",
  aiConfidence:
    "How certain the assistant is about its answer, from 0 to 100%. Below the assist threshold it hands the ticket to a human instead of replying.",
  aiSources: "The knowledge base articles the assistant retrieved and cited when drafting its answer.",
  aiCitationScore: "How closely this article matched the ticket, from the semantic search. Higher means a stronger match.",
  aiProcessed: "Tickets the assistant has triaged and classified, whether or not it went on to answer them.",
  aiDeflection: "The share of tickets the assistant resolved end to end with no agent involvement.",
  aiContainment: "The share of tickets the assistant handled without escalating, counting both auto-resolutions and accepted drafts.",
  aiSummary: "A short assistant-written recap of the whole conversation so you can pick a long thread up quickly.",
  aiClusters: "Groups of similar recent incidents the assistant spotted. Each cluster is a candidate for a single underlying problem record.",
  aiRootCause: "An assistant-suggested root cause based on the linked incidents. Always review it before recording it as the confirmed cause.",
  aiRiskScore: "An assistant-estimated risk score for this change, based on its type, scope, and affected configuration items.",

  // --- Metrics --------------------------------------------------------------
  mttr: "Mean time to resolve: the average time from ticket creation to resolution.",
  firstResponseTime: "The average time between a ticket arriving and an agent's first public reply.",
  csat: "Customer satisfaction: the share of requesters who confirmed their ticket was actually resolved.",
  costSaved: "An estimate of agent time avoided by auto-resolved tickets, priced at a standard handling cost per ticket.",
  reopenRate: "The share of resolved tickets that were reopened, a quality signal for whether fixes actually stuck.",
  backlogByGroup: "Open tickets per assignment group, so you can see which team is falling behind.",
  agentWorkload: "How many tickets are currently open and assigned to this agent. Least-loaded routing uses this number.",
  auditChain:
    "Every action is hashed with SHA-256 and linked to the previous one, so any tampering with history is detectable.",

  // --- Audit ----------------------------------------------------------------
  auditRecords: "The total number of actions recorded for this tenant. Records are append-only and can never be edited.",
  auditBlock: "This record's position in the chain. Verification walks the chain from the first block to the last.",
  auditHash: "SHA-256 of this record's contents plus the previous record's hash, which is what links the chain together.",
  auditPrevHash: "The hash of the record before this one. If it does not match, the chain has been broken at this point.",
  auditPayloadHash: "A hash of just this record's payload, so you can prove the details were not altered.",

  // --- Problem management ---------------------------------------------------
  problem: "A problem records the underlying cause behind one or more incidents. Fixing it stops the incidents from recurring.",
  knownError: "A problem with a documented workaround but no permanent fix yet. Agents can apply the workaround while the fix is developed.",
  linkedIncidents: "The incidents caused by this problem. Resolving the problem lets you close them together.",
  rootCause: "The confirmed underlying cause, established through analysis. This is what a permanent fix must address.",
  workaround: "A temporary way to restore service while the permanent fix is pending. Shared with agents handling related incidents.",
  permanentFix: "The change that removes the root cause for good, usually delivered through change management.",

  // --- Change management ----------------------------------------------------
  changeStandard: "A pre-approved, low-risk, repeatable change. It skips CAB review and can be scheduled immediately.",
  changeNormal: "A change that must be assessed and approved by the CAB before it can be scheduled.",
  changeEmergency: "An urgent change to restore service or close a security gap. It gets expedited approval and a retrospective review.",
  cab: "Change Advisory Board: the reviewers who approve or reject a change. All of them must approve before it can be scheduled.",
  cabStages: "The change lifecycle: draft, assessing, CAB review, approved, scheduled, implementing, review, then closed.",
  changeRisk: "The assessed likelihood and blast radius of this change going wrong. Higher risk demands more reviewers and a tighter window.",

  // --- Assets and CMDB ------------------------------------------------------
  itam: "IT asset management: the hardware and licences you own, who holds them, and when they expire.",
  cmdb: "Configuration management database: the services, servers, applications, and networks you run, plus how they depend on each other.",
  ciDependency: "Direction matters: the source CI depends on the target. If the target fails, the source is affected.",
  ciImpact: "Everything that breaks downstream if this configuration item fails, plus the tickets already referencing it.",

  // --- Routing and automation ----------------------------------------------
  assignStrategy: "How tickets routed to this group get an owner: left in the queue, spread evenly, or given to whoever has the fewest open tickets.",
  assignManual: "Tickets land in the group queue and an agent picks them up. Nobody is auto-assigned.",
  assignRoundRobin: "Each new ticket goes to the next member in turn, spreading volume evenly across the group.",
  assignLeastLoaded: "Each new ticket goes to the member with the fewest open tickets right now.",
  automation: "Rules that watch for a trigger, check conditions, and apply actions automatically, so routine handling needs no agent time.",
  automationTrigger: "The event that makes this rule evaluate: a ticket being created or updated, or an SLA going at risk or breaching.",
  automationMatchAll: "Every condition must be true for the rule to run.",
  automationMatchAny: "The rule runs as soon as any one condition is true.",
  automationActions: "What the rule does when it matches, for example assigning a group, raising priority, or notifying someone.",

  // --- Settings and admin ---------------------------------------------------
  dataDriver: "Where data is stored right now. Memory is a seeded demo store that resets on restart; Postgres is durable.",
  featureFlags: "Which optional integrations are currently configured, such as the LLM provider, email channel, and chat channels.",
  apiKeys: "Machine credentials for scripts and integrations. The full key is shown once at creation and only its hash is stored.",
  apiActingRole: "The identity an integration acts as. Its permissions cap what anything using this key is allowed to do.",
  customFields: "Extra ticket fields for this tenant. They appear on the ticket form and in exports without changing the core schema.",
  customFieldHelp: "Optional help text shown to agents and requesters when they hover the field's info icon.",
  macros: "Saved replies and internal notes agents can insert in one click, for the answers you send over and over.",
  organizations: "The tenants on this deployment. Each tenant's tickets, users, and settings are fully isolated from the others.",
  departments: "Used to group requesters for reporting and to route their tickets to the right team.",
  vipUser: "VIP requesters get an automatic urgency bump at intake, so their tickets are prioritised ahead of the general queue.",

  // --- Conversation ---------------------------------------------------------
  publicReply: "Visible to the requester and emailed to them. This is what stops the first-response SLA clock.",
  internalNote: "Only visible to agents. Requesters never see notes, in the portal or in email.",
  onHold: "Park the ticket while you wait on the requester or a third party. The SLA clock pauses until it becomes active again.",
  runAi: "Ask the assistant to re-triage this ticket and draft an answer using the current conversation and knowledge base.",
  approveDraft: "Send the assistant's draft to the requester as a public reply, crediting the assist in the metrics.",
  escalate: "Hand the ticket to a human specialist and mark it escalated for reporting.",
  mergeTicket: "Fold this ticket into another one. The conversation moves across and this ticket is closed as a duplicate.",
  relatedTickets: "Other tickets linked to this one, for duplicates, related symptoms, or a shared underlying problem.",
  translate: "Translate the conversation into another language, so agents and requesters can work in whichever they prefer.",

  // --- Triage ---------------------------------------------------------------
  triageQueue: "Tickets that have arrived but do not yet have an owner. Assign them to get the SLA clock working for you.",
  triageEscalations: "Tickets an agent could not resolve and handed back, with the reason they gave. Reassigning one clears it from this lane.",
  triageSpecialists: "Agents in the assignment group that matches this ticket's category, so they are the closest fit.",
  triageCommon: "Every other available agent, for when the specialist group is at capacity.",
  teamWorkload: "Current open tickets per agent, so you can assign to whoever has room rather than whoever is nearest the top.",

  // --- Portal and requester -------------------------------------------------
  needsApproval: "This catalogue item needs a manager's approval before work starts. You will be notified once it is decided.",
  fulfilmentDetails: "Extra information the fulfilling team needs to complete this request without coming back to ask.",
  instantlySolved: "Requests the assistant answered immediately, with no waiting for an agent.",
  waitingOnYou: "These need a reply from you before anyone can carry on working on them.",
  availableForTickets: "Turn this off when you are away, and auto-assignment will skip you until you turn it back on.",
  weeklyDigest: "A Monday summary email of your queue, SLA position, and anything that breached over the week.",
} as const;

export type HintKey = keyof typeof HINTS;

const FIELD_TYPE_NOUNS: Record<CustomFieldType, string> = {
  text: "text field",
  number: "number",
  select: "single-select",
  date: "date",
  checkbox: "yes/no toggle",
};

/**
 * Hover text for a tenant-defined custom field. Prefers the help text an admin
 * wrote in Settings and otherwise describes the field from its own definition,
 * so every custom field has something useful to say.
 */
export function customFieldHint(def: {
  description?: string | null;
  type: CustomFieldType;
  required: boolean;
  options: string[];
}): string {
  const authored = def.description?.trim();
  if (authored) return authored;

  const parts = [`${def.required ? "Required" : "Optional"} ${FIELD_TYPE_NOUNS[def.type]}.`];
  if (def.type === "select" && def.options.length > 0) {
    parts.push(`Options: ${def.options.join(", ")}.`);
  }
  parts.push("Custom field for this tenant; its value is saved on the ticket and included in exports.");
  return parts.join(" ");
}

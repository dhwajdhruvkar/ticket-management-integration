// =============================================================================
// AI service — the LLM woven into every module.
//
// Each capability tries the LLM and degrades to a deterministic heuristic so it
// always returns something useful with zero infrastructure:
//   - classifyTicket: category + impact x urgency (-> priority) + sentiment
//   - suggestTags: short topical tags for a ticket (auto-tagging on intake)
//   - summarizeThread: short summary of a conversation
//   - translateText: translate ticket/reply text to a target language
//   - assessChangeRisk: 0-100 risk score + rationale for Change Management
//   - suggestProblemClusters: group similar open incidents (Problem Mgmt)
// =============================================================================

import { complete } from "./llm";
import { cosineSimilarity, embed } from "./embeddings";
import { derivePriority } from "../domain/priority";
import type {
  ImpactLevel,
  TicketCategory,
  TicketMessageRow,
  TicketPriority,
  TicketRow,
} from "../domain/models";

const CATEGORIES: TicketCategory[] = [
  "IT", "HR", "Access", "Software", "Hardware", "Network", "Billing", "Other",
];

const LEVELS: ImpactLevel[] = ["low", "medium", "high"];

export interface Classification {
  category: TicketCategory;
  impact: ImpactLevel;
  urgency: ImpactLevel;
  /** Derived from impact x urgency via the ITIL matrix. */
  priority: TicketPriority;
  sentiment: "positive" | "neutral" | "negative";
}

export async function classifyTicket(subject: string, body: string): Promise<Classification> {
  const text = `${subject}\n${body}`;
  const llm = await complete(
    "You classify IT/HR support tickets following ITIL. Respond ONLY with compact JSON.",
    `Classify this ticket. "impact" is the scope of business effect; "urgency" is the time sensitivity. Return JSON {"category": one of ${JSON.stringify(CATEGORIES)}, "impact": one of ["low","medium","high"], "urgency": one of ["low","medium","high"], "sentiment": one of ["positive","neutral","negative"]}.\n\nTICKET:\n${text}`
  );
  const parsed = safeJson(llm);
  if (parsed && isClassification(parsed)) {
    const impact = parsed.impact as ImpactLevel;
    const urgency = parsed.urgency as ImpactLevel;
    return {
      category: parsed.category as TicketCategory,
      impact,
      urgency,
      priority: derivePriority(impact, urgency),
      sentiment: parsed.sentiment as Classification["sentiment"],
    };
  }
  return heuristicClassify(text);
}

/** Suggest short topical tags for a ticket (used for auto-tagging on intake). */
export async function suggestTags(subject: string, body: string): Promise<string[]> {
  const text = `${subject}\n${body}`;
  const llm = await complete(
    "You suggest short lowercase tags for IT/HR support tickets. Respond ONLY with compact JSON.",
    `Suggest 2-5 concise tags (lowercase, single words or hyphenated, no spaces). Return JSON {"tags": ["tag1","tag2"]}.\n\nTICKET:\n${text}`
  );
  const parsed = safeJson(llm);
  if (parsed && Array.isArray(parsed.tags)) {
    const tags = (parsed.tags as unknown[])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
      .filter(Boolean);
    if (tags.length) return [...new Set(tags)].slice(0, 6);
  }
  return heuristicTags(text);
}

export interface Translation {
  translated: string;
  detectedLang?: string;
}

/** Translate arbitrary ticket/reply text to a target language (offline: passthrough). */
export async function translateText(text: string, targetLang: string): Promise<Translation> {
  const trimmed = text.trim();
  if (!trimmed) return { translated: "" };
  const llm = await complete(
    "You are a translator for IT/HR support messages. Preserve technical terms and formatting. Respond ONLY with the translated text — no preamble, notes, or quotes.",
    `Translate the following into ${targetLang}:\n\n${trimmed}`
  );
  if (llm) return { translated: llm.trim() };
  // Offline fallback: return the original so the UI degrades gracefully.
  return { translated: trimmed, detectedLang: "unknown" };
}

export async function summarizeThread(
  ticket: TicketRow,
  messages: TicketMessageRow[]
): Promise<string> {
  const transcript = [
    `Subject: ${ticket.subject}`,
    `Body: ${ticket.body}`,
    ...messages.map((m) => `${m.authorName} (${m.visibility}): ${m.body}`),
  ].join("\n");
  const llm = await complete(
    "You summarize support ticket conversations for an agent. 2-3 sentences, factual.",
    `Summarize the current state and next step for this ticket:\n\n${transcript}`
  );
  if (llm) return llm;
  // Heuristic: first line of body + last message.
  const last = messages[messages.length - 1];
  return `${ticket.subject}. ${last ? `Latest: ${last.body.slice(0, 160)}` : ticket.body.slice(0, 160)}`;
}

export interface ChangeRisk {
  score: number; // 0-100
  rationale: string;
}

export async function assessChangeRisk(input: {
  title: string;
  description: string;
  type: string;
}): Promise<ChangeRisk> {
  const llm = await complete(
    "You are a change-management risk assessor. Respond ONLY with JSON.",
    `Assess deployment risk. Return JSON {"score": 0-100 integer, "rationale": short string}.\n\nType: ${input.type}\nTitle: ${input.title}\nDescription: ${input.description}`
  );
  const parsed = safeJson(llm);
  if (parsed && typeof parsed.score === "number") {
    return { score: clampInt(parsed.score, 0, 100), rationale: String(parsed.rationale ?? "") };
  }
  return heuristicRisk(input);
}

export interface ProblemCluster {
  theme: string;
  ticketIds: string[];
}

/** Group similar open incidents by embedding proximity (Problem candidates). */
export async function suggestProblemClusters(
  tickets: { id: string; subject: string; body: string }[],
  threshold = 0.6
): Promise<ProblemCluster[]> {
  if (tickets.length < 2) return [];
  const vectors = await Promise.all(
    tickets.map(async (t) => ({ id: t.id, subject: t.subject, vec: (await embed(`${t.subject} ${t.body}`)).vector }))
  );
  const used = new Set<string>();
  const clusters: ProblemCluster[] = [];
  for (let i = 0; i < vectors.length; i++) {
    if (used.has(vectors[i].id)) continue;
    const group = [vectors[i].id];
    for (let j = i + 1; j < vectors.length; j++) {
      if (used.has(vectors[j].id)) continue;
      if (cosineSimilarity(vectors[i].vec, vectors[j].vec) >= threshold) {
        group.push(vectors[j].id);
        used.add(vectors[j].id);
      }
    }
    if (group.length >= 2) {
      used.add(vectors[i].id);
      clusters.push({ theme: vectors[i].subject, ticketIds: group });
    }
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Heuristics & helpers
// ---------------------------------------------------------------------------

function heuristicClassify(text: string): Classification {
  const t = text.toLowerCase();
  let category: TicketCategory = "Other";
  if (/(vpn|wifi|network|connect|dns)/.test(t)) category = "Network";
  else if (/(password|login|locked|access|mfa|2fa|sso)/.test(t)) category = "Access";
  else if (/(laptop|monitor|keyboard|printer|device|hardware)/.test(t)) category = "Hardware";
  else if (/(install|software|app|outlook|teams|office|license)/.test(t)) category = "Software";
  else if (/(payroll|leave|hr|benefits|onboarding)/.test(t)) category = "HR";
  else if (/(invoice|billing|payment|refund)/.test(t)) category = "Billing";

  let impact: ImpactLevel = "medium";
  let urgency: ImpactLevel = "medium";
  if (/(urgent|asap|immediately|critical|down|outage|can't work|cannot work)/.test(t)) {
    impact = "high";
    urgency = "high";
  } else if (/(soon|important|blocked|deadline)/.test(t)) {
    urgency = "high";
  } else if (/(whenever|no rush|minor|low)/.test(t)) {
    impact = "low";
  }

  const sentiment: Classification["sentiment"] = /(angry|frustrat|terrible|unacceptable|furious)/.test(t)
    ? "negative"
    : /(thanks|great|appreciate|please)/.test(t)
    ? "positive"
    : "neutral";

  return { category, impact, urgency, priority: derivePriority(impact, urgency), sentiment };
}

function heuristicTags(text: string): string[] {
  const t = text.toLowerCase();
  const tags = new Set<string>();
  const rules: [RegExp, string][] = [
    [/\bvpn\b/, "vpn"],
    [/(wifi|wi-fi|network|connect|dns)/, "network"],
    [/(password|login|locked|mfa|2fa|sso|access)/, "access"],
    [/(laptop|monitor|keyboard|printer|device|hardware|dock)/, "hardware"],
    [/(install|software|app|outlook|teams|office|license)/, "software"],
    [/(payroll|leave|benefits|onboarding|\bhr\b)/, "hr"],
    [/(invoice|billing|payment|refund)/, "billing"],
    [/(email|mailbox)/, "email"],
    [/(slow|performance|lag|freez)/, "performance"],
    [/(outage|down|unavailable|offline)/, "outage"],
  ];
  for (const [re, tag] of rules) if (re.test(t)) tags.add(tag);
  return [...tags].slice(0, 6);
}

function heuristicRisk(input: { type: string; description: string }): ChangeRisk {
  let score = input.type === "emergency" ? 70 : input.type === "standard" ? 20 : 45;
  const d = input.description.toLowerCase();
  if (/(database|migration|production|prod|network|firewall)/.test(d)) score += 20;
  if (/(rollback|tested|staging|maintenance window)/.test(d)) score -= 10;
  return { score: clampInt(score, 0, 100), rationale: "Heuristic estimate from change type and keywords." };
}

function safeJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isClassification(obj: Record<string, unknown>): boolean {
  return (
    CATEGORIES.includes(obj.category as TicketCategory) &&
    LEVELS.includes(obj.impact as ImpactLevel) &&
    LEVELS.includes(obj.urgency as ImpactLevel) &&
    ["positive", "neutral", "negative"].includes(obj.sentiment as string)
  );
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

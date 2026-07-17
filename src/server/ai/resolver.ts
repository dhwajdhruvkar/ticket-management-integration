// =============================================================================
// Auto-resolution engine (server-side).
//
// retrieve (vector search) -> generate (grounded answer) -> score confidence ->
// guardrails -> decide -> act -> audit. Ported from the browser build to the
// DataStore + server LLM. Decision policy:
//   confidence >= AUTO_RESOLVE_THRESHOLD -> auto_resolve (reply + resolve)
//   confidence >= SUGGEST_THRESHOLD      -> suggest (draft for an agent)
//   otherwise                            -> escalate (human queue)
// Guardrails: P1 (critical) never auto-closes; "ESCALATE:" answer or no hits escalate.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { newId, now } from "../domain/ids";
import { addMessage, getTicket, mutateTicket, recordEvent } from "../services/ticketService";
import { generateAnswer } from "./llm";
import { search, snippetFor, type SearchHit } from "./vectorSearch";
import { BOW_MODEL } from "./embeddings";
import type { CitationRow, ResolutionDecision, ResolutionRow, TicketRow } from "../domain/models";

const TOP_K = 4;

interface Thresholds {
  autoResolve: number;
  suggest: number;
}

/** Tenant-configurable thresholds (env override now; per-tenant settings hook). */
function thresholds(_tenantId: string): Thresholds {
  const auto = Number(process.env.RESOLVE_AUTO_THRESHOLD ?? 0.78);
  const suggest = Number(process.env.RESOLVE_SUGGEST_THRESHOLD ?? 0.55);
  return { autoResolve: auto, suggest };
}

const CALIBRATION: Record<string, { rel: number; dom: number }> = {
  [BOW_MODEL]: { rel: 0.55, dom: 0.2 },
};
const DEFAULT_CAL = { rel: 0.62, dom: 0.22 };

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function scoreConfidence(hits: SearchHit[], model: string) {
  if (hits.length === 0) return { confidence: 0, relevance: 0, dominance: 0 };
  const cal = CALIBRATION[model] ?? DEFAULT_CAL;
  const top = Math.max(0, hits[0].score);
  const second = Math.max(0, hits[1]?.score ?? 0);
  const relevance = clamp01(top / cal.rel);
  const dominance = clamp01((top - second) / cal.dom);
  const confidence = clamp01(0.7 * relevance + 0.3 * dominance);
  return { confidence, relevance, dominance };
}

function decide(
  confidence: number,
  ticket: TicketRow,
  modelEscalated: boolean,
  hasHits: boolean,
  th: Thresholds
): { decision: ResolutionDecision; reasoning: string } {
  if (!hasHits) return { decision: "escalate", reasoning: "No knowledge base matches were found for this request." };
  if (modelEscalated)
    return { decision: "escalate", reasoning: "The assistant judged the retrieved context insufficient to answer safely." };
  if (confidence >= th.autoResolve) {
    if (ticket.priority === "critical") {
      return {
        decision: "suggest",
        reasoning: `Confidence ${(confidence * 100).toFixed(0)}% cleared the bar, but the P1 (critical) guardrail keeps a human in the loop.`,
      };
    }
    return {
      decision: "auto_resolve",
      reasoning: `Confidence ${(confidence * 100).toFixed(0)}% >= auto-resolve threshold with a clear top match.`,
    };
  }
  if (confidence >= th.suggest) {
    return {
      decision: "suggest",
      reasoning: `Confidence ${(confidence * 100).toFixed(0)}% is in the assist band. Drafted a reply for an agent to review.`,
    };
  }
  return {
    decision: "escalate",
    reasoning: `Confidence ${(confidence * 100).toFixed(0)}% is below the assist threshold. Routed to a human agent.`,
  };
}

export async function resolveTicket(ticketId: string): Promise<TicketRow | null> {
  const ticket = await getTicket(ticketId);
  if (!ticket) return null;
  const store = await getStore();
  const started = Date.now();
  const query = `${ticket.subject}\n${ticket.body}`;

  // 1. Retrieve
  const { hits, model: embeddingModel } = await search(ticket.tenantId, query, TOP_K);
  await appendAudit({
    tenantId: ticket.tenantId,
    actor: "rag-engine",
    action: "ticket.retrieval",
    ticketId,
    payload: {
      query: ticket.subject,
      embeddingModel,
      hits: hits.map((h) => ({ articleId: h.article.id, score: Number(h.score.toFixed(4)) })),
    },
  });

  // 2. Generate
  const { answer, model } = await generateAnswer(ticket.subject, ticket.body, hits);
  const modelEscalated = answer.trim().toUpperCase().startsWith("ESCALATE");

  // 3. Score + 4. Decide
  const { confidence, relevance, dominance } = scoreConfidence(hits, embeddingModel);
  const th = thresholds(ticket.tenantId);
  const { decision, reasoning } = decide(confidence, ticket, modelEscalated, hits.length > 0, th);

  // Persist resolution + citations
  const resolution: ResolutionRow = {
    id: newId("res"),
    ticketId,
    answer,
    confidence: Number(confidence.toFixed(4)),
    decision,
    reasoning,
    model,
    embeddingModel,
    latencyMs: Date.now() - started,
    createdAt: now(),
  };
  // Replace any prior resolution for idempotent re-runs.
  for (const old of await store.resolutions.list({ ticketId })) {
    await store.resolutions.remove(old.id);
    for (const c of await store.citations.list({ resolutionId: old.id })) await store.citations.remove(c.id);
  }
  await store.resolutions.create(resolution);
  for (const h of hits) {
    const citation: CitationRow = {
      id: newId("cit"),
      resolutionId: resolution.id,
      articleId: h.article.id,
      title: h.article.title,
      score: Number(h.score.toFixed(4)),
      snippet: snippetFor(h.article),
    };
    await store.citations.create(citation);
  }

  await appendAudit({
    tenantId: ticket.tenantId,
    actor: "rag-engine",
    action: `ticket.decision.${decision}`,
    ticketId,
    payload: {
      decision,
      confidence: resolution.confidence,
      relevance: Number(relevance.toFixed(4)),
      dominance: Number(dominance.toFixed(4)),
      model,
      reasoning,
    },
  });

  // 5. Act
  if (decision === "auto_resolve") {
    await addMessage(ticketId, {
      authorKind: "assistant",
      authorName: "Netlink Assistant",
      visibility: "public",
      body: answer,
    });
    const updated = await mutateTicket(
      ticketId,
      { status: "auto_resolved", firstRespondedAt: ticket.firstRespondedAt ?? now(), resolvedAt: now() },
      { type: "resolved", message: `Auto-resolved by the assistant (confidence ${(confidence * 100).toFixed(0)}%).`, meta: { decision } }
    );
    await appendAudit({ tenantId: ticket.tenantId, actor: "delivery", action: "ticket.reply.sent", ticketId, payload: { delivered: true } });
    return updated;
  }

  if (decision === "suggest") {
    return mutateTicket(
      ticketId,
      { status: "pending_agent" },
      { type: "suggested", message: `Drafted a suggested reply for an agent (confidence ${(confidence * 100).toFixed(0)}%).`, meta: { decision } }
    );
  }

  return mutateTicket(
    ticketId,
    { status: "escalated" },
    { type: "escalated", message: reasoning, meta: { decision } }
  );
}

/** Agent accepts the drafted suggestion: deliver it and resolve. */
export async function acceptSuggestion(ticketId: string, agentName: string): Promise<TicketRow | null> {
  const ticket = await getTicket(ticketId);
  if (!ticket) return null;
  const store = await getStore();
  const resolution = (await store.resolutions.list({ ticketId }))[0];
  if (!resolution) return null;

  await addMessage(ticketId, {
    authorKind: "assistant",
    authorName: "Netlink Assistant",
    visibility: "public",
    body: resolution.answer,
  });
  const updated = await mutateTicket(
    ticketId,
    { status: "resolved", firstRespondedAt: ticket.firstRespondedAt ?? now(), resolvedAt: now() },
    { type: "agent_action", message: `${agentName} approved the drafted reply and sent it.` }
  );
  await appendAudit({
    tenantId: ticket.tenantId,
    actor: `agent:${agentName}`,
    action: "ticket.suggestion.accepted",
    ticketId,
    payload: { delivered: true },
  });
  return updated;
}

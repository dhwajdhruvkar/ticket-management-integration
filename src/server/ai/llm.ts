// =============================================================================
// Server-side LLM generation.
//
// Provider order: explicit LLM_PROVIDER, else Azure OpenAI (if configured),
// else Gemini, else Groq, else a deterministic offline grounded template so
// resolution never breaks. The key never leaves the server.
// =============================================================================

import { config } from "../config";
import type { SearchHit } from "./vectorSearch";

export const TEMPLATE_MODEL = "helpdesk-offline-template";

export interface GeneratedAnswer {
  answer: string;
  model: string;
}

const SYSTEM_PROMPT = `You are the Netlink Support Assistant, an automated agent that resolves IT and HR support tickets.
Rules:
- Answer ONLY using the provided knowledge base context. Never invent steps or policies.
- Be concise, friendly, and write numbered steps the user can follow.
- Cite the knowledge base articles you used with [#] markers matching the context.
- If the context does not contain the answer, reply exactly: "ESCALATE: insufficient knowledge base coverage."`;

function buildUserPrompt(subject: string, body: string, hits: SearchHit[]): string {
  const context = hits
    .map((h, i) => `[${i + 1}] (${h.article.category}) ${h.article.title}\n${h.article.content}`)
    .join("\n\n");
  return `KNOWLEDGE BASE CONTEXT:\n${context}\n\nTICKET\nSubject: ${subject}\nBody: ${body}\n\nWrite the resolution now.`;
}

export async function generateAnswer(
  subject: string,
  body: string,
  hits: SearchHit[]
): Promise<GeneratedAnswer> {
  if (hits.length === 0) {
    return { answer: "ESCALATE: insufficient knowledge base coverage.", model: TEMPLATE_MODEL };
  }
  const system = SYSTEM_PROMPT;
  const user = buildUserPrompt(subject, body, hits);

  try {
    const result = await chat(system, user);
    if (result && result.text.trim()) return { answer: result.text.trim(), model: result.model };
  } catch (err) {
    console.error("[llm] provider failed, using offline template:", err);
  }
  return { answer: templateAnswer(hits), model: TEMPLATE_MODEL };
}

/** Free-form completion for the AI service (classification, summaries, drafts). */
export async function complete(system: string, user: string): Promise<string | null> {
  try {
    const result = await chat(system, user);
    return result?.text?.trim() ?? null;
  } catch (err) {
    console.error("[llm] complete failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider routing
// ---------------------------------------------------------------------------

type ChatResult = { text: string; model: string };

async function chat(system: string, user: string): Promise<ChatResult | null> {
  const forced = config.llmProvider?.toLowerCase();
  const order = forced
    ? [forced]
    : [config.features.azureOpenAI ? "azure-openai" : null, "gemini", "groq"].filter(Boolean);

  for (const provider of order as string[]) {
    if (provider === "azure-openai" && config.features.azureOpenAI) {
      return { text: await azureChat(system, user), model: `azure:${config.azureOpenAI.chatDeployment}` };
    }
    if (provider === "gemini" && process.env.GEMINI_API_KEY) {
      const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
      return { text: await geminiChat(process.env.GEMINI_API_KEY.trim(), model, system, user), model: `gemini:${model}` };
    }
    if (provider === "groq" && process.env.GROQ_API_KEY) {
      const model = process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
      return { text: await groqChat(process.env.GROQ_API_KEY.trim(), model, system, user), model: `groq:${model}` };
    }
  }
  return null;
}

async function azureChat(system: string, user: string): Promise<string> {
  const { endpoint, apiKey, chatDeployment, apiVersion } = config.azureOpenAI;
  const url = `${endpoint}/openai/deployments/${chatDeployment}/chat/completions?api-version=${apiVersion}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey ?? "" },
    body: JSON.stringify({
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Azure OpenAI chat ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

async function groqChat(apiKey: string, model: string, system: string, user: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

async function geminiChat(apiKey: string, model: string, system: string, user: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

// ---------------------------------------------------------------------------
// Offline grounded template
// ---------------------------------------------------------------------------

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function templateAnswer(hits: SearchHit[]): string {
  const top = hits[0];
  const greeting = "Hi there — thanks for reaching out. Here's how to resolve this:";
  const steps: string[] = [];
  hits.slice(0, 2).forEach((hit, idx) => {
    splitSentences(hit.article.content)
      .slice(0, 4)
      .forEach((s) => {
        if (steps.length < 6) steps.push(`${s} [${idx + 1}]`);
      });
  });
  const stepBlock = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const closer =
    "If this doesn't fully resolve your issue, just reply to this ticket and a specialist will take over.";
  return `${greeting}\n\n${stepBlock}\n\nThis guidance is based primarily on "${top.article.title}". ${closer}`;
}

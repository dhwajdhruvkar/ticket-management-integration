import { describe, it, expect } from "vitest";
import { applyBusinessRules, classifyTicket, type Classification } from "@/server/ai/aiService";

// With no LLM provider configured in the test env, classification falls back to
// the deterministic heuristic — so these assertions are stable.
describe("classifyTicket (heuristic)", () => {
  it("classifies a VPN outage as a critical (P1) network issue via impact x urgency", async () => {
    const c = await classifyTicket(
      "VPN down",
      "Urgent outage — I cannot work, the vpn will not connect."
    );
    expect(c.category).toBe("Network");
    expect(c.impact).toBe("high");
    expect(c.urgency).toBe("high");
    expect(c.priority).toBe("critical");
    expect(c.source).toBe("rules");
    expect(c.explanation).toContain("impact");
  });

  it("classifies a password reset as an access request", async () => {
    const c = await classifyTicket("Password help", "I am locked out and need a password reset.");
    expect(c.category).toBe("Access");
  });
});

const base = (overrides: Partial<Classification> = {}): Classification => ({
  source: "rules", explanation: "Base assessment.", category: "Software", impact: "low", urgency: "low",
  priority: "very_low", sentiment: "neutral", factors: [], ...overrides,
});

describe("applyBusinessRules (context and text floors)", () => {
  it("raises urgency when the requester cannot work", () => {
    const result = applyBusinessRules(base(), "Excel will not open", { workStopped: true });
    expect(result.urgency).toBe("high");
    expect(result.factors).toContain("Requester cannot work");
    expect(result.priority).toBe("medium");
  });

  it("raises impact for many affected people, and to medium for a whole team", () => {
    const many = applyBusinessRules(base(), "Shared drive is slow", { affectedPeople: "many" });
    expect(many.impact).toBe("high");
    expect(many.factors).toContain("Many people affected");
    expect(many.priority).toBe("medium");
    const team = applyBusinessRules(base(), "Shared drive is slow", { affectedPeople: "team" });
    expect(team.impact).toBe("medium");
    expect(team.factors).toContain("Whole team affected");
    expect(team.priority).toBe("low");
  });

  it("forces at least high impact, medium urgency and high priority for security wording", () => {
    const result = applyBusinessRules(base(), "I received a phishing email asking for my password", {});
    expect(result.impact).toBe("high");
    expect(result.urgency).toBe("medium");
    expect(result.priority).toBe("high");
    expect(result.factors).toContain("Possible security incident");
  });

  it("never lowers an already-high result", () => {
    const critical = base({ impact: "high", urgency: "high", priority: "critical" });
    const result = applyBusinessRules(critical, "Printer question", { affectedPeople: "one", workStopped: false, vip: false });
    expect(result.impact).toBe("high");
    expect(result.urgency).toBe("high");
    expect(result.priority).toBe("critical");
    expect(result.factors).toEqual([]);
  });

  it("lists the factors in the explanation", () => {
    const result = applyBusinessRules(base({ explanation: "Heuristic." }), "Shared drive is slow", { workStopped: true, affectedPeople: "many" });
    expect(result.explanation).toBe("Heuristic. Factors: Requester cannot work; Many people affected.");
  });

  it("raises urgency for VIP requesters and keeps the requester's chosen category", () => {
    const result = applyBusinessRules(base({ category: "Other" }), "Question about my invoice", { vip: true, category: "Billing" });
    expect(result.urgency).toBe("high");
    expect(result.factors).toContain("VIP requester");
    expect(result.category).toBe("Billing");
  });

  it("classifies identically without context when the text has no signals", async () => {
    const plain = await classifyTicket("Printer label", "The label printer needs new paper");
    const empty = await classifyTicket("Printer label", "The label printer needs new paper", {});
    expect(empty).toEqual(plain);
    expect(plain.factors).toEqual([]);
    expect(plain.priority).toBe("medium");
  });
});

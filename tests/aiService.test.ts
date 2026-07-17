import { describe, it, expect } from "vitest";
import { classifyTicket } from "@/server/ai/aiService";

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
  });

  it("classifies a password reset as an access request", async () => {
    const c = await classifyTicket("Password help", "I am locked out and need a password reset.");
    expect(c.category).toBe("Access");
  });
});

import { describe, it, expect } from "vitest";
import { derivePriority, priorityCode, PRIORITY_ORDER } from "@/server/domain/priority";

// Spec TC3 — the ITIL impact x urgency matrix (P1 critical .. P5 very_low).
describe("derivePriority (impact x urgency matrix)", () => {
  it("maps every matrix cell to the spec priority", () => {
    expect(derivePriority("high", "high")).toBe("critical");
    expect(derivePriority("high", "medium")).toBe("high");
    expect(derivePriority("medium", "high")).toBe("high");
    expect(derivePriority("high", "low")).toBe("medium");
    expect(derivePriority("medium", "medium")).toBe("medium");
    expect(derivePriority("low", "high")).toBe("medium");
    expect(derivePriority("medium", "low")).toBe("low");
    expect(derivePriority("low", "medium")).toBe("low");
    expect(derivePriority("low", "low")).toBe("very_low");
  });

  it("defaults to medium when either dimension is unset", () => {
    expect(derivePriority(undefined, "high")).toBe("medium");
    expect(derivePriority("high", null)).toBe("medium");
    expect(derivePriority(null, null)).toBe("medium");
  });

  it("labels priorities P1..P5 in order", () => {
    expect(PRIORITY_ORDER).toEqual(["critical", "high", "medium", "low", "very_low"]);
    expect(priorityCode("critical")).toBe("P1");
    expect(priorityCode("very_low")).toBe("P5");
  });
});

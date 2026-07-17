import { describe, it, expect } from "vitest";
import { bowEmbed, cosineSimilarity, EMBEDDING_DIM } from "@/server/ai/embeddings";

describe("embeddings", () => {
  it("produces normalized 384-dim vectors", () => {
    const v = bowEmbed("reset my corporate password");
    expect(v.length).toBe(EMBEDDING_DIM);
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("ranks related text above unrelated text", () => {
    const a = bowEmbed("cannot connect to the vpn from home");
    const b = bowEmbed("vpn connection keeps failing");
    const c = bowEmbed("payroll tax form for HR");
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });
});

import { describe, expect, it } from "vitest";
import { GET as health } from "@/app/api/v1/health/route";
import { getScreenshotAnalysisService } from "@/server/ai/screenshotAnalysis";
import { config } from "@/server/config";

describe("screenshot analysis seam", () => {
  it("has no service wired", () => {
    expect(getScreenshotAnalysisService()).toBeNull();
    expect(config.features.screenshotAnalysis).toBe(false);
  });
  it("is reported as unavailable by the health endpoint", async () => {
    const body = (await (await health()).json()) as { features: Record<string, boolean> };
    expect(body.features.screenshotAnalysis).toBe(false);
  });
});

// =============================================================================
// Screenshot-analysis seam (types only).
//
// Nothing calls a model today: the factory returns null and the UI says
// analysis is unavailable. A future provider implements ScreenshotAnalysisService
// and is returned from getScreenshotAnalysisService() behind
// config.features.screenshotAnalysis. Attachments are read through the existing
// authenticated attachment service, never through new endpoints.
// =============================================================================

export interface ScreenshotAnalysisInput {
  tenantId: string;
  ticketId: string;
  attachmentIds: string[];
  /** The requester's notes (customFields.issueContext.notes). */
  notes?: string;
  subject: string;
  body: string;
  /** Knowledge-base excerpts the provider may ground its answer in. */
  kbContext?: string;
}

export interface ScreenshotAnalysisSuggestion {
  type?: string;
  category?: string;
  subcategory?: string;
  priority?: string;
  assignmentGroupId?: string;
}

export interface ScreenshotAnalysisResult {
  status: "completed" | "needs_more_info" | "failed";
  detectedIssue?: string;
  extractedErrors?: string[];
  suggestion?: ScreenshotAnalysisSuggestion;
  kbArticleIds?: string[];
  confidence?: number;
  explanation?: string;
  missingInformation?: string[];
  provider: string;
  /** ISO timestamp. */
  analyzedAt: string;
}

export interface ScreenshotAnalysisService {
  analyze(input: ScreenshotAnalysisInput, signal?: AbortSignal): Promise<ScreenshotAnalysisResult>;
}

/** No provider is configured, so this is always null. */
export function getScreenshotAnalysisService(): ScreenshotAnalysisService | null {
  return null;
}

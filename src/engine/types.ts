export type DataCategory =
  | "email"
  | "name"
  | "phone"
  | "physical_address"
  | "payment_info"
  | "government_id"
  | "device_id"
  | "ip_address"
  | "location"
  | "analytics_usage"
  | "authentication_credentials"
  | "childrens_data"
  | "health_data"
  | "microphone_audio"
  | "camera_video"
  | "generic_pii";

export type Confidence = "high" | "medium" | "low";

export type ResolutionOutcome = "resolved" | "declined" | "unresolved";

export interface LlmResolution {
  outcome: ResolutionOutcome;
  reason: string | null;
  provider: string;
  model: string | null;
  resolvedDataCategories?: DataCategory[];
  resolvedDescription?: string;
}

export interface CodeLocation {
  file: string;
  line: number;
  column: number;
}

export interface Finding {
  id: string;
  dataCategories: DataCategory[];
  processor: string | null;
  description: string;
  confidence: Confidence;
  source: "sdk-rule" | "framework-rule" | "web-api-rule" | "html-input-rule" | "openapi" | "graphql" | "zod-rule" | "type-rule";
  location: CodeLocation;
  evidence: string;
  requiresReview: boolean;
  /**
   * Present only for findings that were run through Layer 2 resolution.
   * Absent means: free tier, --no-llm, or requiresReview was already false —
   * this finding was never sent to an LLM at all.
   */
  llmResolution?: LlmResolution;
  /**
   * Present ONLY for findings whose confidence/requiresReview are provisional, pending the
   * protected-logic scoring call (src/cloud/protectedLogicClient.ts) — the fields captured here are
   * exactly what that endpoint needs (field names and derived yes/no signals, never source code).
   * Until scored, `confidence`/`requiresReview` hold the safe fallback ("low"/true). Absent entirely
   * for findings whose confidence is fixed locally (sdkRules, webApiRules, htmlRules, schema parsers)
   * and never sent anywhere.
   */
  confidenceFactors?: Record<string, boolean | number | string | null>;
}

export interface ProcessorProfile {
  name: string;
  dataCategories: DataCategory[];
  disclosureNotes: string;
}

export interface ProjectManifest {
  root: string;
  kind: "node" | "unknown";
  manifestPath: string | null;
}

export interface ScanResult {
  projects: ProjectManifest[];
  findings: Finding[];
  ambiguousCount: number;
  filesScanned: number;
  unsupportedStackWarning: string | null;
  /**
   * Files that look like they might define a Zod schema used to validate incoming request data —
   * unconfirmed, since the actual schema/anchor detection is protected logic and runs server-side.
   * Resolved (or, on failure, honestly left unresolved) by resolveProtectedLogic() in
   * commands/scan.ts, exactly like requiresReview findings are resolved by Layer 2's
   * resolveAmbiguousFindings() — not inside scan() itself, which stays pure/offline.
   */
  pendingZodCandidates: Array<{ id: string; codeFragment: string; fragmentLineToSourceLine: number[] }>;
  /** Relative paths of files whose extracted Zod fragment was too large to send safely and was
   *  dropped before ever reaching pendingZodCandidates -- surfaced in resolveProtectedLogic()'s
   *  warning so a schema going unchecked is never silent, just like a failed network call is. */
  oversizedZodFiles: string[];
}

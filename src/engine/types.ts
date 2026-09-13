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
  source: "sdk-rule" | "framework-rule" | "web-api-rule" | "html-input-rule" | "openapi" | "graphql";
  location: CodeLocation;
  evidence: string;
  requiresReview: boolean;
  /**
   * Present only for findings that were run through Layer 2 resolution.
   * Absent means: free tier, --no-llm, or requiresReview was already false —
   * this finding was never sent to an LLM at all.
   */
  llmResolution?: LlmResolution;
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
}

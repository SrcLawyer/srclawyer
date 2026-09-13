import type { DataCategory } from "../engine/types.js";

export interface LlmRequestItem {
  findingId: string;
  redactedEvidence: string;
  redactedDescription: string;
  dataCategories: DataCategory[];
  isHighStakes: boolean;
}

export interface LlmBatchRequest {
  items: LlmRequestItem[];
}

export interface LlmResponseItem {
  findingId: string;
  outcome: "resolved" | "declined";
  reason: string | null;
  resolvedDataCategories?: DataCategory[];
  resolvedDescription?: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  resolveBatch(request: LlmBatchRequest): Promise<LlmResponseItem[]>;
}

export interface ProviderResolution {
  provider: LlmProvider | null;
  /** Non-null means: do not run Layer 2, and this message must be surfaced
   *  loudly — never swallowed. */
  error: string | null;
}

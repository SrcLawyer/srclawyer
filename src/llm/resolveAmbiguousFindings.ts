import type { Finding, LlmResolution } from "../engine/types.js";
import { DATA_CATEGORY_LABELS } from "../policy/dataCategoryLabels.js";
import { buildRequestItem } from "./buildRequestItem.js";
import type { LlmProvider, LlmResponseItem } from "./types.js";

const KNOWN_CATEGORIES = new Set(Object.keys(DATA_CATEGORY_LABELS));

const DEFAULT_BATCH_SIZE = 15;
const DEFAULT_BATCH_CHAR_BUDGET = 6000;

export interface ResolveAmbiguousFindingsOptions {
  collectsChildrensData: boolean;
  batchSize?: number;
}

export async function resolveAmbiguousFindings(
  findings: Finding[],
  provider: LlmProvider,
  options: ResolveAmbiguousFindingsOptions
): Promise<Finding[]> {
  const batches = chunkFindings(findings, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const resolvedById = new Map<string, LlmResolution>();

  for (const batch of batches) {
    const items = batch.map((finding) => buildRequestItem(finding, options.collectsChildrensData));
    const isHighStakesById = new Map(items.map((item) => [item.findingId, item.isHighStakes]));

    let responses: LlmResponseItem[];
    try {
      responses = await provider.resolveBatch({ items });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const finding of batch) {
        resolvedById.set(finding.id, {
          outcome: "unresolved",
          reason: `API request failed: ${message}`,
          provider: provider.name,
          model: provider.model,
        });
      }
      continue;
    }

    const responseById = new Map(responses.map((response) => [response.findingId, response]));

    for (const finding of batch) {
      const response = responseById.get(finding.id);
      const isHighStakes = isHighStakesById.get(finding.id) ?? false;
      resolvedById.set(finding.id, toResolution(response, isHighStakes, provider));
    }
  }

  return findings.map((finding) => {
    const resolution = resolvedById.get(finding.id);
    return resolution ? { ...finding, llmResolution: resolution } : finding;
  });
}

function toResolution(response: LlmResponseItem | undefined, isHighStakes: boolean, provider: LlmProvider): LlmResolution {
  if (!response) {
    return {
      outcome: "unresolved",
      reason: "Response missing or malformed for this item",
      provider: provider.name,
      model: provider.model,
    };
  }

  // Hard code-level override: a high-stakes item can never come back "resolved",
  // regardless of what the model claims. This is enforced here, not just in the
  // prompt, since model output text is never trusted as sole enforcement.
  if (isHighStakes && response.outcome === "resolved") {
    return {
      outcome: "declined",
      reason: "High-stakes category (children's data) — always requires manual/legal review, never auto-resolved.",
      provider: provider.name,
      model: provider.model,
    };
  }

  if (response.outcome === "declined") {
    return {
      outcome: "declined",
      reason: response.reason ?? "The model declined to classify this item without giving a reason.",
      provider: provider.name,
      model: provider.model,
    };
  }

  const validCategories = (response.resolvedDataCategories ?? []).filter((category) => KNOWN_CATEGORIES.has(category));
  if (validCategories.length === 0 || !response.resolvedDescription) {
    return {
      outcome: "unresolved",
      reason: "Model reported a resolution but did not provide a recognized data category and description",
      provider: provider.name,
      model: provider.model,
    };
  }

  return {
    outcome: "resolved",
    reason: null,
    provider: provider.name,
    model: provider.model,
    resolvedDataCategories: validCategories,
    resolvedDescription: response.resolvedDescription,
  };
}

function chunkFindings(findings: Finding[], batchSize: number): Finding[][] {
  const batches: Finding[][] = [];
  let current: Finding[] = [];
  let currentChars = 0;

  for (const finding of findings) {
    const approxSize = finding.evidence.length + finding.description.length;
    if (current.length > 0 && (current.length >= batchSize || currentChars + approxSize > DEFAULT_BATCH_CHAR_BUDGET)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(finding);
    currentChars += approxSize;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

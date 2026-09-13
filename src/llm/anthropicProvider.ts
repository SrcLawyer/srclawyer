import type { LlmBatchRequest, LlmProvider, LlmResponseItem } from "./types.js";
import { DATA_CATEGORY_LABELS } from "../policy/dataCategoryLabels.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Confirm this is still current at implementation/release time.
const DEFAULT_MODEL = "claude-sonnet-5";
const REQUEST_TIMEOUT_MS = 30_000;

// Same source of truth resolveAmbiguousFindings.ts validates responses against (KNOWN_CATEGORIES) —
// constraining the tool schema to this enum means a legitimate resolution can no longer be discarded
// as "unrecognized category" just because the model wasn't told what vocabulary to stay inside.
const DATA_CATEGORY_VALUES = Object.keys(DATA_CATEGORY_LABELS);

const RESOLUTION_TOOL = {
  name: "report_resolutions",
  description: "Report a classification decision for each numbered data-collection finding provided.",
  input_schema: {
    type: "object",
    properties: {
      resolutions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            findingId: { type: "string" },
            outcome: { type: "string", enum: ["resolved", "declined"] },
            reason: {
              type: ["string", "null"],
              description: 'Required when outcome is "declined": explain concretely why this could not be confidently classified. Null when resolved.',
            },
            resolvedDataCategories: {
              type: "array",
              items: { type: "string", enum: DATA_CATEGORY_VALUES },
              description: "Only when outcome is \"resolved\". Must use these exact category values — never a category outside this list.",
            },
            resolvedDescription: { type: "string" },
          },
          required: ["findingId", "outcome", "reason"],
        },
      },
    },
    required: ["resolutions"],
  },
};

function buildSystemPrompt(): string {
  return [
    "You are assisting a static-analysis privacy-compliance tool. You will be given a list of code-derived findings that automated pattern matching could not confidently classify into a personal-data category.",
    "For each item, decide whether you can confidently classify what kind of personal data it represents based ONLY on the redacted evidence and description given — do not assume context that isn't shown.",
    'If confident, set outcome to "resolved" and provide resolvedDataCategories and a short resolvedDescription.',
    'If not confident, set outcome to "declined" and give a concrete, specific reason — never guess.',
    'Any item marked isHighStakes must ALWAYS be "declined" with a reason noting it requires manual/legal review, regardless of how confident you feel — this is a hard rule, not a suggestion.',
    "Respond only by calling the report_resolutions tool with exactly one entry per item given, in the same findingId order.",
  ].join(" ");
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async resolveBatch(request: LlmBatchRequest): Promise<LlmResponseItem[]> {
    const userContent = JSON.stringify(
      request.items.map((item) => ({
        findingId: item.findingId,
        dataCategories: item.dataCategories,
        isHighStakes: item.isHighStakes,
        evidence: item.redactedEvidence,
        description: item.redactedDescription,
      })),
      null,
      2
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          system: buildSystemPrompt(),
          messages: [{ role: "user", content: userContent }],
          tools: [RESOLUTION_TOOL],
          tool_choice: { type: "tool", name: "report_resolutions" },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic API request failed (${response.status}): ${body.slice(0, 200)}`);
    }

    const payload = (await response.json()) as {
      content?: Array<{ type: string; name?: string; input?: unknown }>;
    };

    const toolUse = payload.content?.find((block) => block.type === "tool_use" && block.name === "report_resolutions");
    if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
      throw new Error("Anthropic response did not include a valid report_resolutions tool call");
    }

    const input = toolUse.input as { resolutions?: unknown };
    if (!Array.isArray(input.resolutions)) {
      throw new Error("Anthropic tool response missing a resolutions array");
    }

    return input.resolutions.map(normalizeResponseItem).filter((item): item is LlmResponseItem => item !== null);
  }
}

// Anthropic's tool-use output reliably omits `reason` entirely for a "resolved" item — despite it being
// listed in `required` — rather than sending an explicit `null` (confirmed against a real response during
// live verification on 2026-09-13). Treating an omitted key as invalid, rather than as the `null` the field
// means when resolved, was silently discarding otherwise-correct resolutions as "malformed."
function normalizeResponseItem(value: unknown): LlmResponseItem | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.findingId !== "string") return null;
  if (item.outcome !== "resolved" && item.outcome !== "declined") return null;
  if (item.reason !== null && item.reason !== undefined && typeof item.reason !== "string") return null;

  return {
    findingId: item.findingId,
    outcome: item.outcome,
    reason: (item.reason as string | undefined) ?? null,
    resolvedDataCategories: item.resolvedDataCategories as LlmResponseItem["resolvedDataCategories"],
    resolvedDescription: item.resolvedDescription as string | undefined,
  };
}

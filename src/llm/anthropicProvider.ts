import type { LlmBatchRequest, LlmProvider, LlmResponseItem } from "./types.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Confirm this is still current at implementation/release time.
const DEFAULT_MODEL = "claude-sonnet-5";
const REQUEST_TIMEOUT_MS = 30_000;

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
            resolvedDataCategories: { type: "array", items: { type: "string" } },
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

    return input.resolutions.filter(isValidResponseItem);
  }
}

function isValidResponseItem(value: unknown): value is LlmResponseItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.findingId !== "string") return false;
  if (item.outcome !== "resolved" && item.outcome !== "declined") return false;
  if (item.reason !== null && typeof item.reason !== "string") return false;
  return true;
}

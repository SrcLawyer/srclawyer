import { describe, expect, it, vi, afterEach } from "vitest";
import { AnthropicProvider } from "../src/llm/anthropicProvider.js";
import { DATA_CATEGORY_LABELS } from "../src/policy/dataCategoryLabels.js";
import type { LlmRequestItem } from "../src/llm/types.js";

function anthropicResponse(resolutions: unknown[]): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: "tool_use", name: "report_resolutions", input: { resolutions } }],
    }),
    { status: 200 }
  );
}

function makeItem(overrides: Partial<LlmRequestItem>): LlmRequestItem {
  return {
    findingId: "f1",
    redactedEvidence: 'const { dateOfBirth } = await request.json();',
    redactedDescription: 'Request field "dateOfBirth" collected; could not confidently classify — needs review.',
    dataCategories: ["generic_pii"],
    isHighStakes: false,
    ...overrides,
  };
}

describe("AnthropicProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constrains resolvedDataCategories in the tool schema to the exact known DataCategory values", async () => {
    let capturedBody: any;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return anthropicResponse([]);
    });

    const provider = new AnthropicProvider("fake-key");
    await provider.resolveBatch({ items: [makeItem({})] });

    const schema = capturedBody.tools[0].input_schema.properties.resolutions.items.properties.resolvedDataCategories;
    expect(schema.items.enum.sort()).toEqual(Object.keys(DATA_CATEGORY_LABELS).sort());
  });

  it("regression: a dateOfBirth-style finding resolved with a valid enum category is no longer dropped", async () => {
    // This is the exact shape of finding that failed in the 2026-09-13 live verification run: the model
    // resolved it, but the schema didn't constrain resolvedDataCategories, so it used a category outside
    // our vocabulary and the response was discarded as unrecognized. With the enum in place, a model
    // response using one of our real category values (e.g. generic_pii, the honest catch-all) parses through.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      anthropicResponse([
        {
          findingId: "f1",
          outcome: "resolved",
          reason: null,
          resolvedDataCategories: ["generic_pii"],
          resolvedDescription: "Collects the user's date of birth.",
        },
      ])
    );

    const provider = new AnthropicProvider("fake-key");
    const [result] = await provider.resolveBatch({
      items: [
        makeItem({
          findingId: "f1",
          redactedEvidence: 'const { dateOfBirth } = await request.json();',
        }),
      ],
    });

    expect(result.outcome).toBe("resolved");
    expect(result.resolvedDataCategories).toEqual(["generic_pii"]);
  });
});

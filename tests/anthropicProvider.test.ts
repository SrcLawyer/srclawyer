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

  it("regression: a resolved item with `reason` omitted entirely (not sent as explicit null) is not discarded as malformed", async () => {
    // The exact raw shape Anthropic returned during live verification on 2026-09-13 for this same
    // dateOfBirth field: `reason` is absent from the object altogether, despite being listed in the tool
    // schema's `required` array — LLM tool-use doesn't guarantee every required key is literally present,
    // and an omitted key means the same thing here as an explicit null. The old isValidResponseItem check
    // rejected the whole item whenever `reason` was `undefined` rather than `null`, which silently turned a
    // correct resolution into "Response missing or malformed for this item" 3 times out of 4 real calls.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      anthropicResponse([
        {
          findingId: "field:app/api/account/route.ts:2:dateOfBirth",
          outcome: "resolved",
          resolvedDataCategories: ["generic_pii"],
          resolvedDescription: "Date of birth collected via API request body, representing personal identifying information.",
          // note: no `reason` key at all
        },
      ])
    );

    const provider = new AnthropicProvider("fake-key");
    const [result] = await provider.resolveBatch({
      items: [makeItem({ findingId: "field:app/api/account/route.ts:2:dateOfBirth" })],
    });

    expect(result).toBeDefined();
    expect(result.outcome).toBe("resolved");
    expect(result.reason).toBeNull();
    expect(result.resolvedDataCategories).toEqual(["generic_pii"]);
  });

  it("still rejects a genuinely malformed item (missing findingId)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      anthropicResponse([{ outcome: "resolved", resolvedDataCategories: ["email"], resolvedDescription: "x" }])
    );

    const provider = new AnthropicProvider("fake-key");
    const result = await provider.resolveBatch({ items: [makeItem({ findingId: "f1" })] });

    expect(result).toEqual([]);
  });
});

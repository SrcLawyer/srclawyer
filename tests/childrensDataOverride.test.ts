import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScan } from "../src/commands/scan.js";
import { CONFIG_FILENAME } from "../src/config/config.js";

/**
 * Confirms the one call site that reads config.collectsChildrensData for the Layer 2 high-stakes
 * override (src/commands/scan.ts, feeding resolveAmbiguousFindings -> buildRequestItem) coerces a
 * null (unanswered) config value to false -- i.e. leaving the question unanswered behaves exactly
 * like an explicit "no" for this safety check, never like an explicit "yes". The override's own
 * true/false behavior is already covered by tests/resolveAmbiguousFindings.test.ts; this test is
 * specifically about the config.ts -> scan.ts coercion boundary.
 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const ENV_VAR = "SRCLAWYER_TEST_CHILDRENS_OVERRIDE_KEY";

describe("collectsChildrensData null coerces to false for the Layer 2 override", () => {
  let dir: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    delete process.env[ENV_VAR];
    vi.restoreAllMocks();
  });

  async function runWithCollectsChildrensData(value: "null" | "true" | "false"): Promise<{ outcome: string; reason: string | null }> {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-childrens-override-"));
    process.env[ENV_VAR] = "sentinel-key-not-real";

    const collectsLine = value === "null" ? "" : `collectsChildrensData: ${value}`;
    writeFileSync(
      join(dir, CONFIG_FILENAME),
      [
        "entityLocation: US",
        "targetMarkets: []",
        "industry: null",
        collectsLine,
        "tier: byok",
        "llm:",
        "  provider: anthropic",
        `  apiKeyEnvVar: ${ENV_VAR}`,
      ]
        .filter(Boolean)
        .join("\n")
    );
    // An ambiguous, non-children's-category field -- isHighStakes should come only from
    // collectsChildrensData here, never from the finding's own category.
    writeFileSync(join(dir, "server.js"), "const { notes } = req.body;\n");

    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const href = String(url);
      if (href.includes("/v1/score-fields")) return jsonResponse({ results: [] });
      if (href.includes("api.anthropic.com")) {
        // Real findingIds, not guessed -- read them back out of the actual request this run sent, so
        // the mocked response always matches whatever buildRequestItem/resolveAmbiguousFindings
        // produced for this scan's real findings.
        const body = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ content: string }> };
        const items = JSON.parse(body.messages[0].content) as Array<{ findingId: string }>;
        return jsonResponse({
          content: [
            {
              type: "tool_use",
              name: "report_resolutions",
              input: {
                resolutions: items.map((item) => ({
                  findingId: item.findingId,
                  outcome: "resolved",
                  reason: null,
                  resolvedDataCategories: ["generic_pii"],
                  resolvedDescription: "A free-text note.",
                })),
              },
            },
          ],
        });
      }
      throw new Error(`unexpected fetch to ${href}`);
    });

    const results: { outcome: string; reason: string | null }[] = [];

    // --json's output is the simplest way to see the real per-finding llmResolution outcome.
    const originalLog = console.log;
    let jsonOutput = "";
    console.log = (msg?: unknown) => {
      if (typeof msg === "string" && msg.trim().startsWith("{")) jsonOutput = msg;
    };
    try {
      await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: true });
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(jsonOutput) as { findings: Array<{ llmResolution?: { outcome: string; reason: string | null } }> };
    const notesFinding = parsed.findings.find((f) => f.llmResolution !== undefined);
    if (notesFinding?.llmResolution) results.push(notesFinding.llmResolution);

    return results[0] ?? { outcome: "none", reason: null };
  }

  it("null (unanswered) does not force a decline -- behaves like false, not true", async () => {
    const resolution = await runWithCollectsChildrensData("null");
    expect(resolution.outcome).toBe("resolved");
  });

  it("explicit false does not force a decline", async () => {
    const resolution = await runWithCollectsChildrensData("false");
    expect(resolution.outcome).toBe("resolved");
  });

  it("explicit true forces a decline, even for an unrelated category", async () => {
    const resolution = await runWithCollectsChildrensData("true");
    expect(resolution.outcome).toBe("declined");
    expect(resolution.reason).toContain("High-stakes category");
  });
});

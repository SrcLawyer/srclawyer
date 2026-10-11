import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScan } from "../src/commands/scan.js";
import { CONFIG_FILENAME } from "../src/config/config.js";

// Every new policy-detail field, set to a distinctive, easy-to-grep sentinel value. None of these
// should ever appear in a request body sent to either external service -- both resolveProtectedLogic
// (src/cloud/resolveProtectedLogic.ts) and buildRequestItem (src/llm/buildRequestItem.ts) are
// structurally incapable of receiving the full config (confirmed by reading both directly: the former
// takes no config parameter at all, the latter takes a lone boolean) -- this test locks that in so a
// future refactor can't accidentally widen either function's input.
const SENTINELS = [
  "SENTINEL_COMPANY_NAME_7f3a",
  "SENTINEL_SITE_URL_7f3a",
  "SENTINEL_PRIVACY_EMAIL_7f3a",
  "SENTINEL_RETENTION_7f3a",
  "SENTINEL_DELETION_7f3a",
];

const ENV_VAR = "SRCLAWYER_TEST_SENTINEL_KEY";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("new config fields never reach the network", () => {
  let dir: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    delete process.env[ENV_VAR];
    vi.restoreAllMocks();
  });

  it("appears in no fetch call body, to either the protected-logic endpoint or the Anthropic provider", async () => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-no-leak-"));
    process.env[ENV_VAR] = "sentinel-api-key-not-real";

    writeFileSync(
      join(dir, CONFIG_FILENAME),
      [
        "entityLocation: US",
        "targetMarkets: []",
        "industry: null",
        "collectsChildrensData: false",
        "tier: byok",
        "llm:",
        "  provider: anthropic",
        `  apiKeyEnvVar: ${ENV_VAR}`,
        `companyName: "${SENTINELS[0]}"`,
        `siteUrl: "${SENTINELS[1]}"`,
        `privacyContactEmail: "${SENTINELS[2]}"`,
        "hasEuUkUsers: true",
        "hasCaliforniaUsers: true",
        "sellsOrSharesData: true",
        "usesDataForAdvertising: true",
        `dataRetentionPolicy: "${SENTINELS[3]}"`,
        `accountDeletionInstructions: "${SENTINELS[4]}"`,
        "minimumAge: 13",
        "sendsDataToAiServices: true",
      ].join("\n")
    );
    // An ambiguous field (triggers both protected-logic scoring and, since it stays requiresReview,
    // Layer 2 LLM resolution) plus a Zod schema (triggers the zod-detection endpoint too).
    writeFileSync(
      join(dir, "server.js"),
      [
        "import { z } from 'zod';",
        "const signupSchema = z.object({ notes: z.string(), email: z.string() });",
        "app.post('/signup', (req, res) => { signupSchema.parse(req.body); });",
      ].join("\n")
    );

    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("/v1/score-fields")) return jsonResponse({ results: [] });
      if (href.includes("/v1/detect-zod-schema")) return jsonResponse({ results: [] });
      if (href.includes("api.anthropic.com")) {
        return jsonResponse({
          content: [
            {
              type: "tool_use",
              name: "report_resolutions",
              input: { resolutions: [{ findingId: "x", outcome: "declined", reason: "test" }] },
            },
          ],
        });
      }
      throw new Error(`unexpected fetch to ${href}`);
    });

    await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: true });

    expect(fetchSpy.mock.calls.length).toBeGreaterThan(0);
    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      const body = typeof init?.body === "string" ? init.body : "";
      for (const sentinel of SENTINELS) {
        expect(body).not.toContain(sentinel);
      }
      expect(body).not.toContain("companyName");
      expect(body).not.toContain("siteUrl");
      expect(body).not.toContain("privacyContactEmail");
      expect(body).not.toContain("dataRetentionPolicy");
      expect(body).not.toContain("accountDeletionInstructions");
      expect(body).not.toContain("hasEuUkUsers");
      expect(body).not.toContain("hasCaliforniaUsers");
      expect(body).not.toContain("sellsOrSharesData");
      expect(body).not.toContain("usesDataForAdvertising");
      expect(body).not.toContain("sendsDataToAiServices");
      expect(body).not.toContain("minimumAge");
    }
  });
});

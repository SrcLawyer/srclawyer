import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScan } from "../src/commands/scan.js";

/**
 * These tests used to assert "zero fetch calls at all" for Layer 2's tier gating. That's no longer
 * literally true: confidence scoring (src/cloud/resolveProtectedLogic.ts) is Layer 1 infrastructure
 * now, unconditional and not tier-gated, so a scan with any classified field makes exactly one
 * protected-logic call regardless of LLM tier. What these tests actually care about — that a
 * free/unconfigured/--no-llm scan never reaches an LLM PROVIDER — is asserted directly below by
 * checking the URL of every fetch call, not just whether fetch was called at all. The protected-logic
 * call itself is expected to fail in this test environment (no real endpoint configured) and degrade
 * honestly, per resolveProtectedLogic's own error handling — that's covered by
 * tests/protectedLogicGating.test.ts, not here.
 */
function anthropicCalls(fetchSpy: ReturnType<typeof vi.spyOn>): unknown[] {
  return fetchSpy.mock.calls.filter(([url]) => typeof url === "string" && url.includes("api.anthropic.com"));
}

describe("runScan Layer 2 gating", () => {
  let dir: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-llm-gating-"));
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled in test"));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("makes zero calls to an LLM provider when the configured tier is free", async () => {
    writeFileSync(
      join(dir, ".privacypolicy.yml"),
      ["entityLocation: US", "targetMarkets: []", "industry: null", "collectsChildrensData: false", "tier: free"].join("\n")
    );
    // A field that would normally be ambiguous, to prove the gap isn't "no ambiguous items to send".
    writeFileSync(join(dir, "server.js"), 'const { notes } = req.body;\n');

    await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: true });

    expect(anthropicCalls(fetchSpy)).toHaveLength(0);
  });

  it("makes zero calls to an LLM provider when no .privacypolicy.yml exists at all", async () => {
    writeFileSync(join(dir, "server.js"), 'const { notes } = req.body;\n');

    await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: true });

    expect(anthropicCalls(fetchSpy)).toHaveLength(0);
  });

  it("makes zero calls to an LLM provider when --no-llm is passed, even with byok configured", async () => {
    writeFileSync(
      join(dir, ".privacypolicy.yml"),
      ["entityLocation: US", "targetMarkets: []", "industry: null", "collectsChildrensData: false", "tier: byok", "llm:", "  provider: anthropic", "  apiKeyEnvVar: SRCLAWYER_TEST_KEY_NOT_SET"].join(
        "\n"
      )
    );
    writeFileSync(join(dir, "server.js"), 'const { notes } = req.body;\n');

    await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: false });

    expect(anthropicCalls(fetchSpy)).toHaveLength(0);
  });
});

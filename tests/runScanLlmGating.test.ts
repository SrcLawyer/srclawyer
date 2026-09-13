import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScan } from "../src/commands/scan.js";

describe("runScan Layer 2 gating", () => {
  let dir: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-llm-gating-"));
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("makes zero network calls when the configured tier is free", async () => {
    writeFileSync(
      join(dir, ".privacypolicy.yml"),
      ["entityLocation: US", "targetMarkets: []", "industry: null", "collectsChildrensData: false", "tier: free"].join("\n")
    );
    // A field that would normally be ambiguous, to prove the gap isn't "no ambiguous items to send".
    writeFileSync(join(dir, "server.js"), 'const { notes } = req.body;\n');

    await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: true });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("makes zero network calls when no .privacypolicy.yml exists at all", async () => {
    writeFileSync(join(dir, "server.js"), 'const { notes } = req.body;\n');

    await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: true });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("makes zero network calls when --no-llm is passed, even with byok configured", async () => {
    writeFileSync(
      join(dir, ".privacypolicy.yml"),
      ["entityLocation: US", "targetMarkets: []", "industry: null", "collectsChildrensData: false", "tier: byok", "llm:", "  provider: anthropic", "  apiKeyEnvVar: SRCLAWYER_TEST_KEY_NOT_SET"].join(
        "\n"
      )
    );
    writeFileSync(join(dir, "server.js"), 'const { notes } = req.body;\n');

    await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: false });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

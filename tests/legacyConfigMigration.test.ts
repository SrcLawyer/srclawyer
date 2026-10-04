import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScan } from "../src/commands/scan.js";
import { CONFIG_FILENAME, LEGACY_CONFIG_FILENAME } from "../src/config/config.js";

describe("runScan legacy-config safeguard", () => {
  let dir: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-legacy-config-"));
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled in test"));
    process.exitCode = undefined;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("reports a rename-specific warning, not the generic 'no config' message, when only the legacy file exists", async () => {
    writeFileSync(join(dir, LEGACY_CONFIG_FILENAME), "entityLocation: US\ntargetMarkets: []\nindustry: null\ncollectsChildrensData: false\n");
    writeFileSync(join(dir, "server.js"), 'const { notes } = req.body;\n');

    const output = await captureJson(dir);

    expect(output.legacyConfigWarning).toBeTruthy();
    expect(output.legacyConfigWarning).toContain(`mv ${LEGACY_CONFIG_FILENAME} ${CONFIG_FILENAME}`);
  });

  it("sets a non-zero exit code when an unmigrated legacy config is found", async () => {
    writeFileSync(join(dir, LEGACY_CONFIG_FILENAME), "entityLocation: US\n");
    writeFileSync(join(dir, "server.js"), 'const { notes } = req.body;\n');

    await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: false });

    expect(process.exitCode).toBe(1);
  });

  it("reports no legacy warning on a genuine first run (neither file exists)", async () => {
    writeFileSync(join(dir, "server.js"), 'const { notes } = req.body;\n');

    const output = await captureJson(dir);

    expect(output.legacyConfigWarning).toBeNull();
  });

  it("reports no legacy warning once migrated (current filename present)", async () => {
    writeFileSync(
      join(dir, CONFIG_FILENAME),
      "entityLocation: US\ntargetMarkets: []\nindustry: null\ncollectsChildrensData: false\ntier: free\n"
    );
    writeFileSync(join(dir, "server.js"), 'const { notes } = req.body;\n');

    const output = await captureJson(dir);

    expect(output.legacyConfigWarning).toBeNull();
  });

  async function captureJson(root: string): Promise<{ legacyConfigWarning: string | null }> {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runScan(root, { json: true, out: "PRIVACY_POLICY.md", llm: false });
      const jsonCall = logSpy.mock.calls.find(([arg]) => typeof arg === "string" && arg.trim().startsWith("{"));
      return JSON.parse(jsonCall?.[0] as string);
    } finally {
      logSpy.mockRestore();
    }
  }
});

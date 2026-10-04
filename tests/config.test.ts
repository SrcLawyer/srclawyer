import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  writeConfig,
  DEFAULT_CONFIG,
  CONFIG_FILENAME,
  LEGACY_CONFIG_FILENAME,
  hasUnmigratedLegacyConfig,
  legacyConfigMessage,
} from "../src/config/config.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "srclawyer-config-"));
}

describe("config tier/llm fields", () => {
  it("defaults to the free tier", () => {
    expect(DEFAULT_CONFIG.tier).toBe("free");
  });

  it("round-trips a byok tier with an API key env var name, never the key itself", () => {
    const dir = tempDir();
    writeConfig(dir, {
      ...DEFAULT_CONFIG,
      tier: "byok",
      llm: { provider: "anthropic", apiKeyEnvVar: "ANTHROPIC_API_KEY" },
    });

    const loaded = loadConfig(dir);
    expect(loaded?.tier).toBe("byok");
    expect(loaded?.llm?.apiKeyEnvVar).toBe("ANTHROPIC_API_KEY");
  });

  it("old config files without tier/llm fields still load, defaulting to free", () => {
    const dir = tempDir();
    writeConfig(dir, {
      entityLocation: "US",
      targetMarkets: [],
      industry: null,
      collectsChildrensData: false,
    });

    const loaded = loadConfig(dir);
    expect(loaded?.tier).toBe("free");
    expect(loaded?.llm).toBeUndefined();
  });
});

describe("legacy config rename safeguard", () => {
  it("is false when neither file exists", () => {
    expect(hasUnmigratedLegacyConfig(tempDir())).toBe(false);
  });

  it("is false when only the current filename exists", () => {
    const dir = tempDir();
    writeConfig(dir, DEFAULT_CONFIG);
    expect(hasUnmigratedLegacyConfig(dir)).toBe(false);
  });

  it("is true when only the legacy filename exists", () => {
    const dir = tempDir();
    writeFileSync(join(dir, LEGACY_CONFIG_FILENAME), "entityLocation: US\n");
    expect(hasUnmigratedLegacyConfig(dir)).toBe(true);
  });

  it("is false once both exist -- migration already happened, never re-warn", () => {
    const dir = tempDir();
    writeFileSync(join(dir, LEGACY_CONFIG_FILENAME), "entityLocation: US\n");
    writeConfig(dir, DEFAULT_CONFIG);
    expect(hasUnmigratedLegacyConfig(dir)).toBe(false);
  });

  it("the shared message names both filenames and the rename command, not just 'run init'", () => {
    const message = legacyConfigMessage();
    expect(message).toContain(LEGACY_CONFIG_FILENAME);
    expect(message).toContain(CONFIG_FILENAME);
    expect(message).toContain(`mv ${LEGACY_CONFIG_FILENAME} ${CONFIG_FILENAME}`);
  });
});

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, writeConfig, DEFAULT_CONFIG } from "../src/config/config.js";

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

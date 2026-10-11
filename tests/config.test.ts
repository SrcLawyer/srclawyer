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

describe("optional policy-detail fields", () => {
  it("defaults every new field to null", () => {
    expect(DEFAULT_CONFIG.companyName).toBeNull();
    expect(DEFAULT_CONFIG.siteUrl).toBeNull();
    expect(DEFAULT_CONFIG.privacyContactEmail).toBeNull();
    expect(DEFAULT_CONFIG.hasEuUkUsers).toBeNull();
    expect(DEFAULT_CONFIG.hasCaliforniaUsers).toBeNull();
    expect(DEFAULT_CONFIG.sellsOrSharesData).toBeNull();
    expect(DEFAULT_CONFIG.usesDataForAdvertising).toBeNull();
    expect(DEFAULT_CONFIG.dataRetentionPolicy).toBeNull();
    expect(DEFAULT_CONFIG.accountDeletionInstructions).toBeNull();
    expect(DEFAULT_CONFIG.minimumAge).toBeNull();
    expect(DEFAULT_CONFIG.sendsDataToAiServices).toBeNull();
    expect(DEFAULT_CONFIG.collectsChildrensData).toBeNull();
  });

  it("round-trips every new field through writeConfig/loadConfig", () => {
    const dir = tempDir();
    writeConfig(dir, {
      ...DEFAULT_CONFIG,
      companyName: "Acme Inc.",
      siteUrl: "https://acme.example",
      privacyContactEmail: "privacy@acme.example",
      hasEuUkUsers: true,
      hasCaliforniaUsers: false,
      sellsOrSharesData: false,
      usesDataForAdvertising: true,
      dataRetentionPolicy: "2 years",
      accountDeletionInstructions: "Email privacy@acme.example",
      minimumAge: 13,
      sendsDataToAiServices: false,
    });

    const loaded = loadConfig(dir);
    expect(loaded?.companyName).toBe("Acme Inc.");
    expect(loaded?.siteUrl).toBe("https://acme.example");
    expect(loaded?.privacyContactEmail).toBe("privacy@acme.example");
    expect(loaded?.hasEuUkUsers).toBe(true);
    expect(loaded?.hasCaliforniaUsers).toBe(false);
    expect(loaded?.sellsOrSharesData).toBe(false);
    expect(loaded?.usesDataForAdvertising).toBe(true);
    expect(loaded?.dataRetentionPolicy).toBe("2 years");
    expect(loaded?.accountDeletionInstructions).toBe("Email privacy@acme.example");
    expect(loaded?.minimumAge).toBe(13);
    expect(loaded?.sendsDataToAiServices).toBe(false);
  });

  it("old config files without any of the new fields still load, defaulting every one to null", () => {
    const dir = tempDir();
    writeConfig(dir, {
      entityLocation: "US",
      targetMarkets: [],
      industry: null,
      collectsChildrensData: false,
    });

    const loaded = loadConfig(dir);
    expect(loaded?.companyName).toBeNull();
    expect(loaded?.hasEuUkUsers).toBeNull();
    expect(loaded?.minimumAge).toBeNull();
  });

  it("collectsChildrensData is null (unanswered), not false, when the key is truly absent from the file -- distinct from an explicit 'no'", () => {
    const dir = tempDir();
    // Written as raw YAML (not via writeConfig) specifically to omit the key entirely -- the way a
    // pre-0.6.1 config file, or a hand-edited one, actually looks on disk.
    writeFileSync(join(dir, CONFIG_FILENAME), "entityLocation: US\ntargetMarkets: []\nindustry: null\n");

    const loaded = loadConfig(dir);
    expect(loaded?.collectsChildrensData).toBeNull();
  });

  it("collectsChildrensData round-trips an explicit false distinctly from null", () => {
    const dir = tempDir();
    writeConfig(dir, { ...DEFAULT_CONFIG, collectsChildrensData: false });

    const loaded = loadConfig(dir);
    expect(loaded?.collectsChildrensData).toBe(false);
  });

  it("collectsChildrensData round-trips an explicit true", () => {
    const dir = tempDir();
    writeConfig(dir, { ...DEFAULT_CONFIG, collectsChildrensData: true });

    const loaded = loadConfig(dir);
    expect(loaded?.collectsChildrensData).toBe(true);
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

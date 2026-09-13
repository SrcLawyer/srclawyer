import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveProviderForTier } from "../src/llm/resolveProviderForTier.js";
import { AnthropicProvider } from "../src/llm/anthropicProvider.js";
import type { SrcLawyerConfig } from "../src/config/config.js";

function makeConfig(overrides: Partial<SrcLawyerConfig>): SrcLawyerConfig {
  return {
    entityLocation: null,
    targetMarkets: [],
    industry: null,
    collectsChildrensData: false,
    ...overrides,
  };
}

const TEST_ENV_VAR = "SRCLAWYER_TEST_ANTHROPIC_KEY";

describe("resolveProviderForTier", () => {
  beforeEach(() => {
    delete process.env[TEST_ENV_VAR];
  });

  afterEach(() => {
    delete process.env[TEST_ENV_VAR];
  });

  it("returns no provider and no error for the free tier", () => {
    const { provider, error } = resolveProviderForTier(makeConfig({ tier: "free" }));
    expect(provider).toBeNull();
    expect(error).toBeNull();
  });

  it("defaults to free when tier is unset", () => {
    const { provider, error } = resolveProviderForTier(makeConfig({}));
    expect(provider).toBeNull();
    expect(error).toBeNull();
  });

  it("returns an honest error for byok with no llm config at all", () => {
    const { provider, error } = resolveProviderForTier(makeConfig({ tier: "byok" }));
    expect(provider).toBeNull();
    expect(error).toMatch(/no api key environment variable/i);
  });

  it("returns an honest, named error for byok when the env var is not set", () => {
    const { provider, error } = resolveProviderForTier(
      makeConfig({ tier: "byok", llm: { provider: "anthropic", apiKeyEnvVar: TEST_ENV_VAR } })
    );
    expect(provider).toBeNull();
    expect(error).toContain(TEST_ENV_VAR);
  });

  it("returns a working AnthropicProvider for byok when the env var is set", () => {
    process.env[TEST_ENV_VAR] = "fake-test-key";
    const { provider, error } = resolveProviderForTier(
      makeConfig({ tier: "byok", llm: { provider: "anthropic", apiKeyEnvVar: TEST_ENV_VAR } })
    );
    expect(error).toBeNull();
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider?.name).toBe("anthropic");
  });

  it("always returns an honest error for managed, since no backend exists yet", () => {
    const { provider, error } = resolveProviderForTier(makeConfig({ tier: "managed" }));
    expect(provider).toBeNull();
    expect(error).toMatch(/managed.*not available/i);
  });
});

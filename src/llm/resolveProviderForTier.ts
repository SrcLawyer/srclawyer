import { CONFIG_FILENAME, type SrcLawyerConfig } from "../config/config.js";
import type { ProviderResolution } from "./types.js";
import { AnthropicProvider } from "./anthropicProvider.js";

export function resolveProviderForTier(config: SrcLawyerConfig): ProviderResolution {
  const tier = config.tier ?? "free";

  if (tier === "free") {
    return { provider: null, error: null };
  }

  if (tier === "byok") {
    const envVar = config.llm?.apiKeyEnvVar;
    if (!envVar) {
      return {
        provider: null,
        error: `Tier is "byok" but no API key environment variable is configured in ${CONFIG_FILENAME}. Add "llm: { provider: anthropic, apiKeyEnvVar: <ENV_VAR_NAME> }" to it, or delete the file and re-run "srclawyer init --enable-ai-review".`,
      };
    }
    const apiKey = process.env[envVar];
    if (!apiKey) {
      return {
        provider: null,
        error: `Tier is "byok" but the environment variable ${envVar} is not set. Set it to your Anthropic API key and re-run.`,
      };
    }
    return { provider: new AnthropicProvider(apiKey), error: null };
  }

  if (tier === "managed") {
    return {
      provider: null,
      error: 'Tier is "managed" but SrcLawyer\'s managed backend is not available yet. Use "byok" with your own Anthropic API key, or "free".',
    };
  }

  return { provider: null, error: `Unknown tier "${tier}" in ${CONFIG_FILENAME}.` };
}

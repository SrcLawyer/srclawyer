// Placeholder destinations -- fill in with real URLs before these are relied on by anything but this
// file. Kept as named constants precisely so there's one place to update, not scattered literals.
export const PRIVACY_POLICY_URL = "https://example.invalid/srclawyer/privacy";
export const TERMS_URL = "https://example.invalid/srclawyer/terms";

// Verbatim from README.md's own "Network calls" section (minus markdown backticks, since this prints
// to a terminal) -- one wording for this claim, not a second paraphrase that can drift from the first.
export const NETWORK_CALLS_NOTICE = [
  "Heads up: SrcLawyer makes network calls.",
  "",
  "Detection itself is fully local and offline — no code leaves your machine for pattern matching.",
  "Once detection completes, scan makes one batched network call to grade the confidence of what it",
  "found (field names and derived yes/no signals only, never source code), and, for scans that use Zod",
  "schemas as request validators, one additional call sending a small redacted code fragment. This runs",
  "on every scan regardless of tier.",
  "",
  `Privacy policy: ${PRIVACY_POLICY_URL}`,
  `Terms: ${TERMS_URL}`,
].join("\n");

export const SCAN_DISCLAIMER_REMINDER =
  "Reminder: this is automated analysis, not legal advice — review the generated policy before publishing it.";

export function byokNetworkNotice(apiKeyEnvVar: string | null): string {
  const keySource = apiKeyEnvVar ? `env var ${apiKeyEnvVar}` : "your configured key";
  return `BYOK is configured: redacted code snippets for ambiguous findings will be sent to Anthropic under your own API key (${keySource}), for AI-assisted classification only.`;
}

// No dedicated privacy-policy/terms site exists yet -- these point at the real, resolvable README
// sections that cover the same ground today (not a placeholder or a dead `.invalid` link), and should
// be repointed to a real site once one exists. Kept as named constants precisely so there's one place
// to update when that happens.
export const PRIVACY_POLICY_URL = "https://github.com/SrcLawyer/srclawyer#network-calls";
export const TERMS_URL = "https://github.com/SrcLawyer/srclawyer#readme";

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

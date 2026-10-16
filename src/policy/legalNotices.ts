// No dedicated privacy-policy/terms site exists yet -- these point at the real, resolvable README
// "Legal" section that covers the same ground today (not a placeholder or a dead `.invalid` link), and
// should be repointed to a real site once one exists. Kept as named constants precisely so there's one
// place to update when that happens -- a one-line change, not a hunt through every call site.
//
// Deliberately NOT labeled "Privacy policy:" / "Terms:" below: that would claim those documents exist
// at this URL, when the Legal section itself says plainly that they don't yet -- this points at a
// notice and disclaimer, not a substitute for either.
export const PRIVACY_POLICY_URL = "https://github.com/SrcLawyer/srclawyer#legal";
export const TERMS_URL = "https://github.com/SrcLawyer/srclawyer#legal";

// Mirrors README.md's own "Network calls" section (condensed, minus markdown backticks since this
// prints to a terminal) -- the same claims in the same terms, not a second paraphrase that can drift.
// What is actually on the wire is pinned by tests/requestBodiesNoPaths.test.ts.
export const NETWORK_CALLS_NOTICE = [
  "Heads up: SrcLawyer makes network calls.",
  "",
  "Detection itself is fully local and offline — no code leaves your machine for pattern matching.",
  "Once detection completes, every scan makes one batched call to grade the confidence of what it",
  "found. For each field it sends an opaque id (f0, f1, ...), the data category the field's name maps",
  "to, and three derived signals (is the name ambiguous, was it read directly from the request, how",
  "many similar fields sit alongside it) -- no field names, file paths, line numbers or source code.",
  "Scans that use Zod schemas as request validators make one additional batched call, sending an",
  "opaque id and a small secret-redacted code fragment per schema (the schema, its validation call",
  "and the imports it uses) -- never a file path or line number.",
  "",
  `Legal notice and disclaimer: ${PRIVACY_POLICY_URL}`,
  "(A dedicated privacy policy and terms of service are coming; this points to what exists today.)",
].join("\n");

export const SCAN_DISCLAIMER_REMINDER =
  "Reminder: this is automated analysis, not legal advice — review the generated policy before publishing it.";

export function byokNetworkNotice(apiKeyEnvVar: string | null): string {
  const keySource = apiKeyEnvVar ? `env var ${apiKeyEnvVar}` : "your configured key";
  return `BYOK is configured: for each finding scan couldn't classify, it will send Anthropic, under your own API key (${keySource}), an opaque id, the finding's data category and description (which names the field), and the one source line it was found on with secrets redacted — not the file's path or line number, and no other code — for AI-assisted classification only.`;
}

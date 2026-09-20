/**
 * Protected-logic service endpoint + auth. Not tier-gated (unlike src/llm/*) — this is Layer 1
 * infrastructure now, needed regardless of free/byok/managed, so it isn't part of SrcLawyerConfig's
 * tier/llm fields. `SRCLAWYER_PROTECTED_LOGIC_URL` is meant for local development against a
 * `wrangler dev` instance; real deployments should never need to override it.
 *
 * DEFAULT_BASE_URL is the real deployed Worker (srclawyer-rules, tag v0.2.1). DEFAULT_API_KEY is
 * the real shared free-tier key, matching the Worker's own API_KEY secret (set via `wrangler secret
 * put API_KEY` on the Worker directly, never as a repo/CI secret). This is a deliberate choice, not
 * an oversight: it's a low-privilege, purpose-built credential that only grants rate-limited access
 * to the two protected-logic endpoints — categorically different from a GitHub PAT or a Cloudflare
 * API token, which must never appear in a public repo. Baking it in here is what gives free-tier
 * users zero-setup access with no account/key management of their own. Verified end-to-end against
 * the live Worker (not just wrangler dev) before this was committed.
 */
const DEFAULT_BASE_URL = "https://srclawyer-rules.anishjha352.workers.dev";
const DEFAULT_API_KEY = "dae3d13ec14ab78eeb5bae1398e0bee8fba55f218861860c81aa279c03c64888";

export interface ProtectedLogicEndpoint {
  baseUrl: string;
  apiKey: string;
}

export function resolveProtectedLogicEndpoint(): ProtectedLogicEndpoint {
  return {
    baseUrl: process.env.SRCLAWYER_PROTECTED_LOGIC_URL ?? DEFAULT_BASE_URL,
    apiKey: process.env.SRCLAWYER_PROTECTED_LOGIC_API_KEY ?? DEFAULT_API_KEY,
  };
}

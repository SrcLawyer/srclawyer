/**
 * Protected-logic service endpoint + auth. Not tier-gated (unlike src/llm/*) — this is Layer 1
 * infrastructure now, needed regardless of free/byok/managed, so it isn't part of SrcLawyerConfig's
 * tier/llm fields. `SRCLAWYER_PROTECTED_LOGIC_URL` is meant for local development against a
 * `wrangler dev` instance; real deployments should never need to override it.
 *
 * DEFAULT_BASE_URL is the real deployed Worker (srclawyer-rules, tag v0.2.1). DEFAULT_API_KEY is
 * still a PLACEHOLDER — it needs to be replaced with the real key set via `wrangler secret put
 * API_KEY` before this ships. Until then, every real network call this module enables will fail
 * (honestly — see resolveProtectedLogic's per-call error handling), not silently succeed against a
 * mismatched key.
 */
const DEFAULT_BASE_URL = "https://srclawyer-rules.anishjha352.workers.dev";
const DEFAULT_API_KEY = "srclawyer-free-tier-placeholder-key";

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

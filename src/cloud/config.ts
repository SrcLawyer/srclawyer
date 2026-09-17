/**
 * Protected-logic service endpoint + auth. Not tier-gated (unlike src/llm/*) — this is Layer 1
 * infrastructure now, needed regardless of free/byok/managed, so it isn't part of SrcLawyerConfig's
 * tier/llm fields. `SRCLAWYER_PROTECTED_LOGIC_URL` is meant for local development against a
 * `wrangler dev` instance; real deployments should never need to override it.
 *
 * DEFAULT_BASE_URL and DEFAULT_API_KEY are PLACEHOLDERS — they need to be replaced with the real
 * deployed Worker URL and a real issued key before this ships. Until then, every real network call
 * this module enables will fail (honestly — see resolveProtectedLogic's per-call error handling),
 * not silently succeed against a fake endpoint.
 */
const DEFAULT_BASE_URL = "https://rules.srclawyer.workers.dev";
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

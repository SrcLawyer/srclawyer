/**
 * Public library surface for `srclawyer`.
 *
 * This is the ONLY supported way for other packages (including the private detection-rules
 * package) to depend on this repo's code. Everything else under src/ is an internal implementation
 * detail and may change without notice — import from here, never from a deep relative/dist path.
 */
export { redactSecrets, containsLikelySecret } from "./engine/secretRedaction.js";
export type {
  DataCategory,
  Confidence,
  ResolutionOutcome,
  LlmResolution,
  CodeLocation,
  Finding,
  ProcessorProfile,
  ProjectManifest,
  ScanResult,
} from "./engine/types.js";

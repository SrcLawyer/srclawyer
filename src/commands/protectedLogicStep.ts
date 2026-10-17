import type { Finding, ScanResult } from "../engine/types.js";
import { resolveProtectedLogic } from "../cloud/resolveProtectedLogic.js";
import { resolveProtectedLogicEndpoint } from "../cloud/config.js";

/**
 * The one place a scan result is handed to the protected-logic service. Not tier-gated, not behind
 * --no-llm: confidence scoring and Zod-schema detection are Layer 1 capabilities, needed on every real
 * scan. A failure degrades honestly (findings keep their safe local fallback and a warning is
 * returned) rather than blocking the scan. Shared by `scan` and `check` so both make exactly the same
 * calls under exactly the same conditions.
 */
export async function resolveScanProtectedLogic(result: ScanResult): Promise<{ findings: Finding[]; warning: string | null }> {
  const hasScorableFindings =
    result.findings.some((f) => f.confidenceFactors) || result.pendingZodCandidates.length > 0 || result.oversizedZodFiles.length > 0;
  if (!hasScorableFindings) return { findings: result.findings, warning: null };

  const resolved = await resolveProtectedLogic(result.findings, result.pendingZodCandidates, resolveProtectedLogicEndpoint(), result.oversizedZodFiles);
  return { findings: resolved.findings, warning: resolved.warning };
}

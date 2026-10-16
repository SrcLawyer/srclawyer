import type { Finding } from "../engine/types.js";
import { redactSecrets } from "../engine/secretRedaction.js";
import type { LlmRequestItem } from "./types.js";

/**
 * The only function permitted to read finding.evidence/description for
 * Layer 2 purposes. Both fields are passed through redactSecrets() before
 * they leave this function — LlmRequestItem has no raw-evidence field, so a
 * provider implementation is structurally incapable of receiving
 * unredacted content.
 *
 * `requestId` is an opaque per-scan identifier (f0, f1, ...), never finding.id: finding ids embed the
 * file path, line number and field name, and none of those may reach the provider. The caller
 * (resolveAmbiguousFindings) owns the mapping back to findings and never sends it anywhere.
 */
export function buildRequestItem(finding: Finding, collectsChildrensData: boolean, requestId: string): LlmRequestItem {
  return {
    findingId: requestId,
    redactedEvidence: redactSecrets(finding.evidence),
    redactedDescription: redactSecrets(finding.description),
    dataCategories: finding.dataCategories,
    isHighStakes: finding.dataCategories.includes("childrens_data") || collectsChildrensData,
  };
}

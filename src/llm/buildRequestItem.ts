import type { Finding } from "../engine/types.js";
import { redactSecrets } from "../engine/secretRedaction.js";
import type { LlmRequestItem } from "./types.js";

/**
 * The only function permitted to read finding.evidence/description for
 * Layer 2 purposes. Both fields are passed through redactSecrets() before
 * they leave this function — LlmRequestItem has no raw-evidence field, so a
 * provider implementation is structurally incapable of receiving
 * unredacted content.
 */
export function buildRequestItem(finding: Finding, collectsChildrensData: boolean): LlmRequestItem {
  return {
    findingId: finding.id,
    redactedEvidence: redactSecrets(finding.evidence),
    redactedDescription: redactSecrets(finding.description),
    dataCategories: finding.dataCategories,
    isHighStakes: finding.dataCategories.includes("childrens_data") || collectsChildrensData,
  };
}

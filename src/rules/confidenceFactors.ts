import type { DataCategory } from "../engine/types.js";
import { classifyFieldName, isAmbiguousFieldName } from "./dataCategoryLexicon.js";

/**
 * Computing the confidence FACTORS for a field is cheap, generic, local work — the same lexicon
 * lookups every rule already does. Turning those factors into an actual confidence/requiresReview
 * verdict is the tuned, corpus-validated part, and that formula now lives server-side (see
 * src/cloud/protectedLogicClient.ts). This module only ever produces factors, never a verdict.
 */
export interface ConfidenceFactors {
  lexiconCategory: DataCategory | null;
  ambiguousName: boolean;
  runtimeVerified: boolean;
  siblingConfidentCount?: number;
}

// Shared by every rule module that has a pre-materialized list of sibling field names available at
// the point it emits a finding — counts how many OTHER names in the group independently classify as
// confident PII, excluding `selfName` itself.
export function countConfidentSiblings(allFieldNames: string[], selfName: string): number {
  let count = 0;
  for (const name of allFieldNames) {
    if (name === selfName) continue;
    if (classifyFieldName(name) && !isAmbiguousFieldName(name)) count += 1;
  }
  return count;
}

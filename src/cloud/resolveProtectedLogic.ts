import type { Finding } from "../engine/types.js";
import type { ZodCandidate } from "../rules/zodPreFilter.js";
import { classifyFieldName, isAmbiguousFieldName } from "../rules/dataCategoryLexicon.js";
import { isSafeFieldName } from "../rules/safeFieldNames.js";
import { countConfidentSiblings } from "../rules/confidenceFactors.js";
import { detectZodSchemas, scoreFields, type ProtectedLogicClientOptions, type ScoreFieldsItem } from "./protectedLogicClient.js";

export interface ResolveProtectedLogicResult {
  findings: Finding[];
  warning: string | null;
}

/**
 * The one place that turns "findings with provisional confidence" and "files that might have a Zod
 * schema" into final results, by calling the protected-logic service. Layered on top of scan() the
 * same way resolveAmbiguousFindings.ts is layered on top of it for Layer 2 — not called from inside
 * scan() itself, so scan()'s own purity/auditability claim stays true.
 */
export async function resolveProtectedLogic(
  findings: Finding[],
  pendingZodCandidates: ZodCandidate[],
  options: ProtectedLogicClientOptions,
  oversizedZodFiles: string[] = []
): Promise<ResolveProtectedLogicResult> {
  let workingFindings = findings;
  const warnings: string[] = [];

  if (oversizedZodFiles.length > 0) {
    warnings.push(
      `Zod-schema detection skipped for ${oversizedZodFiles.length} file(s) because the extracted fragment was too large to send safely: ${oversizedZodFiles.join(", ")}.`
    );
  }

  if (pendingZodCandidates.length > 0) {
    const byId = new Map(pendingZodCandidates.map((c) => [c.id, c]));
    const { results, error } = await detectZodSchemas(
      pendingZodCandidates.map((c) => ({ id: c.id, codeFragment: c.codeFragment })),
      options
    );
    if (error) warnings.push(`Zod-schema detection unavailable (${error}) — schemas in this scan were not checked.`);

    const zodFindings: Finding[] = [];
    for (const [id, result] of results) {
      const candidate = byId.get(id);
      if (!candidate || !result.matched || result.fields.length === 0) continue;

      const allNames = result.fields.map((f) => f.name);
      for (const field of result.fields) {
        if (isSafeFieldName(field.name)) continue;
        const sourceLine = candidate.fragmentLineToSourceLine[field.line - 1] ?? field.line;
        const lexiconCategory = classifyFieldName(field.name);
        const ambiguousName = isAmbiguousFieldName(field.name);
        const siblingConfidentCount = countConfidentSiblings(allNames, field.name);

        zodFindings.push({
          id: `zod:${id}:${sourceLine}:${field.name}`,
          dataCategories: lexiconCategory ? [lexiconCategory] : ["generic_pii"],
          processor: null,
          description: lexiconCategory
            ? `Zod schema field "${field.name}" collected, classified as ${lexiconCategory}.`
            : `Zod schema field "${field.name}" collected; could not confidently classify — needs review.`,
          confidence: "low",
          source: "zod-rule",
          location: { file: id, line: sourceLine, column: 0 },
          evidence: "", // the raw fragment already went through redactSecrets(); no further evidence is retained here
          requiresReview: true,
          confidenceFactors: { lexiconCategory, ambiguousName, runtimeVerified: true, siblingConfidentCount },
        });
      }
    }
    workingFindings = [...workingFindings, ...zodFindings];
  }

  const toScore = workingFindings.filter((f): f is Finding & { confidenceFactors: NonNullable<Finding["confidenceFactors"]> } => !!f.confidenceFactors);
  if (toScore.length > 0) {
    const items: ScoreFieldsItem[] = toScore.map((f) => ({
      id: f.id,
      lexiconCategory: (f.confidenceFactors.lexiconCategory ?? null) as ScoreFieldsItem["lexiconCategory"],
      ambiguousName: Boolean(f.confidenceFactors.ambiguousName),
      runtimeVerified: Boolean(f.confidenceFactors.runtimeVerified),
      siblingConfidentCount: Number(f.confidenceFactors.siblingConfidentCount ?? 0),
    }));

    const { results, error } = await scoreFields(items, options);
    if (error) warnings.push(`Confidence scoring unavailable (${error}) — affected findings kept their safe local default (low confidence, flagged for review).`);

    workingFindings = workingFindings.map((f) => {
      const scored = results.get(f.id);
      if (!scored) return f;
      return { ...f, confidence: scored.confidence, requiresReview: scored.requiresReview };
    });
  }

  return { findings: workingFindings, warning: warnings.length > 0 ? warnings.join(" ") : null };
}

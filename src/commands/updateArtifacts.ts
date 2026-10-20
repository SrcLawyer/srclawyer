import type { SrcLawyerConfig } from "../config/config.js";
import { extractPlaceholders, generatePolicyMarkdown } from "../policy/generatePolicy.js";
import { markerHash, withPolicyMarker } from "../policy/policyGuard.js";
import { buildSummary, renderReviewFile, type ReviewQuestion } from "../policy/reviewFile.js";
import { SERVICE_QUESTION_DEFS, currentAnswerWord, triggeredQuestions, unansweredQuestions } from "../assistant/questions.js";
import { profileKeyOf } from "../policy/generatePolicy.js";
import { featureKey, featuresFor } from "../rules/serviceFeatures.js";
import { lowerLabel } from "../assistant/labels.js";
import { PROCESSOR_PROFILES } from "../rules/processorProfiles.js";
import type { DriftEvaluation } from "./driftEvaluation.js";

export interface UpdateArtifacts {
  draftBody: string;
  reviewBody: string;
  /** First 8 hex characters of the review file's hash. */
  reviewHash: string;
  /** The whole hash, recorded when the review is approved. */
  reviewHashFull: string;
  questions: ReviewQuestion[];
  summary: string[];
  blankCount: number;
}

function tagsFor(processorName: string): string[] {
  return Object.values(PROCESSOR_PROFILES).find((p) => p.name === processorName)?.tags ?? [];
}

/**
 * Everything `update` writes or reports for a drift result, computed from a fresh evaluation and the
 * current config. `approve` calls this too, so the review it approves is derived again from the code and
 * never read back from a file.
 */
export function buildUpdateArtifacts(evaluation: DriftEvaluation, config: SrcLawyerConfig | null, options: { firstReview?: boolean } = {}): UpdateArtifacts {
  const { report } = evaluation;
  const first = options.firstReview === true;
  if (!evaluation.scan) throw new Error("buildUpdateArtifacts needs a conclusive scan");
  if (!first && (report.result !== "drift" || !report.diff)) throw new Error("buildUpdateArtifacts needs a drift result");
  // The first review of a baseline nobody has approved lists everything found, as if all of it were added.
  const diff = first
    ? { added: { categories: evaluation.current?.categories ?? [], processors: evaluation.current?.processors ?? [] }, removed: { categories: [], processors: [] } }
    : report.diff!;
  const finalResult = { ...evaluation.scan, findings: evaluation.findings, ambiguousCount: evaluation.findings.filter((f) => f.requiresReview).length };
  const draftBody = generatePolicyMarkdown(finalResult, config, null, evaluation.protectedLogicWarning);

  // Nothing "changed" on a first review, so there is no earlier answer to re-confirm: the questions are
  // the ones still blank.
  const triggered = first
    ? []
    : triggeredQuestions({
    addedCategories: diff.added.categories,
    addedCategoryLabels: diff.added.categories.map(lowerLabel),
    addedProcessors: diff.added.processors.map((name) => ({ name, tags: tagsFor(name) })),
  });
  const questions: ReviewQuestion[] = first
    ? unansweredQuestions(config).filter((def) => def.blocking).map((def) => ({ def, why: def.why, currentAnswer: currentAnswerWord(def, config) }))
    : triggered.map((t) => ({ ...t, currentAnswer: currentAnswerWord(t.def, config) }));
  // Optional features of the services this review is about (all of them on a first review, the added ones otherwise).
  const reviewed = new Set(diff.added.processors);
  const profileKeys = [...new Set(evaluation.findings.map(profileKeyOf).filter((k): k is string => k !== null))];
  for (const profileKey of profileKeys) {
    if (!reviewed.has(PROCESSOR_PROFILES[profileKey]?.name ?? "")) continue;
    for (const feature of featuresFor(profileKey)) {
      const def = SERVICE_QUESTION_DEFS.find((d) => d.id === `service.${featureKey(feature)}`);
      if (def && typeof config?.serviceUse?.[featureKey(feature)] !== "boolean") questions.push({ def, why: def.why, currentAnswer: "not answered" });
    }
  }
  const reviewBody = renderReviewFile({ coverage: report.coverage ?? "", diff, questions, firstReview: first });
  const blankCount = extractPlaceholders(draftBody).length;
  const marked = withPolicyMarker(reviewBody);
  return {
    draftBody,
    reviewBody,
    reviewHash: markerHash(marked, 8)!,
    reviewHashFull: markerHash(marked, 64)!,
    questions,
    summary: buildSummary({ diff, questionCount: questions.length, blankCount, firstReview: first }),
    blankCount,
  };
}

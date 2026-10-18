import type { SrcLawyerConfig } from "../config/config.js";
import { extractPlaceholders, generatePolicyMarkdown } from "../policy/generatePolicy.js";
import { markerHash, withPolicyMarker } from "../policy/policyGuard.js";
import { buildSummary, renderReviewFile, type ReviewQuestion } from "../policy/reviewFile.js";
import { currentAnswerWord, triggeredQuestions } from "../assistant/questions.js";
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
export function buildUpdateArtifacts(evaluation: DriftEvaluation, config: SrcLawyerConfig | null): UpdateArtifacts {
  const { report } = evaluation;
  if (report.result !== "drift" || !evaluation.scan || !report.diff) throw new Error("buildUpdateArtifacts needs a drift result");
  const diff = report.diff;
  const finalResult = { ...evaluation.scan, findings: evaluation.findings, ambiguousCount: evaluation.findings.filter((f) => f.requiresReview).length };
  const draftBody = generatePolicyMarkdown(finalResult, config, null, evaluation.protectedLogicWarning);

  const triggered = triggeredQuestions({
    addedCategories: diff.added.categories,
    addedCategoryLabels: diff.added.categories.map(lowerLabel),
    addedProcessors: diff.added.processors.map((name) => ({ name, tags: tagsFor(name) })),
  });
  const questions: ReviewQuestion[] = triggered.map((t) => ({ ...t, currentAnswer: currentAnswerWord(t.def, config) }));
  const reviewBody = renderReviewFile({ coverage: report.coverage ?? "", diff, questions });
  const blankCount = extractPlaceholders(draftBody).length;
  const marked = withPolicyMarker(reviewBody);
  return {
    draftBody,
    reviewBody,
    reviewHash: markerHash(marked, 8)!,
    reviewHashFull: markerHash(marked, 64)!,
    questions,
    summary: buildSummary({ diff, questionCount: questions.length, blankCount }),
    blankCount,
  };
}

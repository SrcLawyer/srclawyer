import { join } from "node:path";
import { loadConfig } from "../config/config.js";
import { extractPlaceholders, generatePolicyMarkdown } from "../policy/generatePolicy.js";
import { markerHash, writeMarkedFile, withPolicyMarker, type MarkedWrite } from "../policy/policyGuard.js";
import { buildSummary, renderReviewFile, type ReviewQuestion } from "../policy/reviewFile.js";
import { currentAnswerWord, triggeredQuestions } from "../assistant/questions.js";
import { lowerLabel } from "../assistant/labels.js";
import { COMMAND } from "../assistant/wording.js";
import { PROCESSOR_PROFILES } from "../rules/processorProfiles.js";
import { renderCheckText, type CheckFormat, type CheckReport } from "./check.js";
import { evaluateDrift } from "./driftEvaluation.js";

export const DRAFT_FILENAME = "PRIVACY_POLICY.generated.md";
export const REVIEW_FILENAME = "PRIVACY_POLICY.review.md";

export interface UpdateOptions {
  inventoryPath: string;
  /** Directory for the draft and review file, relative to the project root. Default: the root. */
  outDir: string;
  format: CheckFormat;
}

export interface UpdateReport extends CheckReport {
  mode: "draft";
  /** Plain-English "what changed" lines; empty unless drift was found. */
  summary: string[];
  /** The questions the drift raises, with the reason each is asked. */
  questions: Array<{ id: string; field: string; ask: string; why: string; sensitive: boolean; currentAnswer: string }>;
  /** First 8 hex characters of the review file's hash, or null when no review file was produced. */
  reviewHash: string | null;
  draft: MarkedWrite | null;
  review: MarkedWrite | null;
}

function tagsFor(processorName: string): string[] {
  return Object.values(PROCESSOR_PROFILES).find((p) => p.name === processorName)?.tags ?? [];
}

/**
 * Draft mode: runs the same scan and comparison as `check`, and on drift writes a draft policy and a
 * review file next to (never over) the real policy. Never touches the policy, the baseline or the
 * config, never calls an LLM provider, and keeps check's exit codes (0 no drift, 1 drift, 2 error,
 * 3 inconclusive).
 */
export async function runUpdate(root: string, options: UpdateOptions): Promise<number> {
  const evaluation = await evaluateDrift(root, options.inventoryPath);
  const { report } = evaluation;
  const out: UpdateReport = { ...report, mode: "draft", summary: [], questions: [], reviewHash: null, draft: null, review: null };

  if (report.result === "drift" && evaluation.scan && report.diff) {
    const diff = report.diff;
    const config = loadConfig(root);
    const finalResult = { ...evaluation.scan, findings: evaluation.findings, ambiguousCount: evaluation.findings.filter((f) => f.requiresReview).length };
    const draftBody = generatePolicyMarkdown(finalResult, config, null, evaluation.protectedLogicWarning);

    const triggered = triggeredQuestions({
      addedCategories: diff.added.categories,
      addedCategoryLabels: diff.added.categories.map(lowerLabel),
      addedProcessors: diff.added.processors.map((name) => ({ name, tags: tagsFor(name) })),
    });
    const questions: ReviewQuestion[] = triggered.map((t) => ({ ...t, currentAnswer: currentAnswerWord(t.def, config) }));
    const reviewBody = renderReviewFile({ coverage: report.coverage ?? "", diff, questions });

    const dirAbs = join(root, options.outDir);
    out.draft = writeMarkedFile(join(dirAbs, DRAFT_FILENAME), join(options.outDir, DRAFT_FILENAME), draftBody);
    out.review = writeMarkedFile(join(dirAbs, REVIEW_FILENAME), join(options.outDir, REVIEW_FILENAME), reviewBody);
    out.reviewHash = markerHash(withPolicyMarker(reviewBody));
    out.questions = questions.map((q) => ({ id: q.def.id, field: String(q.def.field), ask: q.def.ask, why: q.why, sensitive: q.def.sensitive, currentAnswer: q.currentAnswer }));
    out.summary = buildSummary({ diff, questionCount: questions.length, blankCount: extractPlaceholders(draftBody).length });
  }

  if (options.format === "json") {
    console.log(JSON.stringify(out, null, 2));
  } else {
    (report.result === "error" ? console.error : console.log)(renderCheckText(report, options.inventoryPath));
    if (report.result === "drift") {
      console.log("");
      if (out.draft) console.log(out.draft.written ? COMMAND.draftWritten.replace("{path}", out.draft.path) : COMMAND.skippedEdited.replace("{path}", out.draft.path));
      if (out.review) console.log(out.review.written ? COMMAND.reviewWritten.replace("{path}", out.review.path) : COMMAND.skippedEdited.replace("{path}", out.review.path));
      console.log("");
      for (const line of out.summary) console.log(line);
      console.log(COMMAND.nothingChanged);
    }
  }
  return report.exitCode;
}

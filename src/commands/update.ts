import { join } from "node:path";
import { loadConfig, policyModeOf } from "../config/config.js";
import { checkPolicyWrite, DEFAULT_POLICY_PATH, wouldDiscardOwnerWork, writeMarkedFile, writeMarkedFileOverwriting, type MarkedWrite } from "../policy/policyGuard.js";
import { generatePolicyMarkdown } from "../policy/generatePolicy.js";
import { BACKUP_NOTE, COMMAND } from "../assistant/wording.js";
import { backupFile, readFreshLastUpdate, readPolicyChoice, sha256, writeLastUpdate, type LastUpdate } from "../assistant/stateDir.js";
import { computeProjectState, readBaseline, type NextAction, type ProjectStateName } from "../assistant/state.js";
import type { Publishability } from "../assistant/publishable.js";
import { renderCheckText, type CheckFormat, type CheckReport } from "./check.js";
import { evaluateDrift } from "./driftEvaluation.js";
import { buildUpdateArtifacts } from "./updateArtifacts.js";
import { categoryLabel } from "../assistant/labels.js";
import { EXIT_CRASH } from "../exitCodes.js";

export const DRAFT_FILENAME = "PRIVACY_POLICY.generated.md";
export const REVIEW_FILENAME = "PRIVACY_POLICY.review.md";

export interface UpdateOptions {
  inventoryPath: string;
  /** Directory for the draft and review file, relative to the project root. Default: the root. */
  outDir: string;
  format: CheckFormat;
}

export interface UpdateReport extends CheckReport, Partial<Publishability> {
  schema: 1;
  mode: "draft";
  /** Plain-English "what changed" lines; empty unless drift was found. */
  summary: string[];
  /** The questions the drift raises, with the reason each is asked. */
  questions: Array<{ id: string; field: string; ask: string; why: string; sensitive: boolean; currentAnswer: string }>;
  /** First 8 hex characters of the review file's hash, or null when no review file was produced. */
  reviewHash: string | null;
  draft: MarkedWrite | null;
  review: MarkedWrite | null;
  /** policyMode generated only: the outcome of regenerating the policy file itself. */
  policy: MarkedWrite | null;
  /** True on the first review of a baseline nobody has approved yet: the summary lists everything the scanner found. */
  firstReview: boolean;
  state: ProjectStateName | null;
  openQuestionCount: number;
  nextAction: NextAction | null;
}

/**
 * Draft mode: runs the same scan and comparison as `check`, and on drift writes a draft policy and a
 * review file next to (never over) the real policy. Never touches the policy, the baseline or the
 * config, never calls an LLM provider, and keeps check's exit codes (0 no drift, 1 drift, 2 error,
 * 3 inconclusive). Leaves a small record in .srclawyer/ so `status` and `questions` need no new scan.
 */
export async function runUpdate(root: string, options: UpdateOptions): Promise<number> {
  const evaluation = await evaluateDrift(root, options.inventoryPath);
  const { report } = evaluation;
  const out: UpdateReport = {
    ...report,
    schema: 1,
    mode: "draft",
    summary: [],
    questions: [],
    reviewHash: null,
    draft: null,
    review: null,
    policy: null,
    firstReview: false,
    state: null,
    openQuestionCount: 0,
    nextAction: null,
  };
  const config = loadConfig(root);
  const baselineText = readBaseline(root, options.inventoryPath).text;
  const generatedMode = policyModeOf(config) === "generated";
  let exitCode = report.exitCode;

  const firstReview = report.result === "no-drift" && report.baseline !== null && !report.baseline.approved;
  out.firstReview = firstReview;

  if (((report.result === "drift" && report.diff) || firstReview) && evaluation.scan) {
    const artifacts = buildUpdateArtifacts(evaluation, config, { firstReview });
    const diff = firstReview
      ? { added: { categories: evaluation.current?.categories ?? [], processors: evaluation.current?.processors ?? [] }, removed: { categories: [], processors: [] } }
      : report.diff!;
    const dirAbs = join(root, options.outDir);
    // In generated mode the policy itself is regenerated (below), so a separate draft would only repeat it.
    if (!generatedMode && !firstReview) out.draft = writeMarkedFile(join(dirAbs, DRAFT_FILENAME), join(options.outDir, DRAFT_FILENAME), artifacts.draftBody);
    out.review = writeMarkedFile(join(dirAbs, REVIEW_FILENAME), join(options.outDir, REVIEW_FILENAME), artifacts.reviewBody);
    out.reviewHash = artifacts.reviewHash;
    out.summary = artifacts.summary;
    out.questions = artifacts.questions.map((q) => ({
      id: q.def.id,
      field: String(q.def.field),
      ask: q.def.ask,
      why: q.why,
      sensitive: q.def.sensitive,
      currentAnswer: q.currentAnswer,
    }));
    // Re-running update after the owner answered must not forget those answers: carry over the ones that
    // still belong to this drift (same baseline, same questions).
    const previous = readFreshLastUpdate(root, baselineText);
    const triggeredIds = firstReview ? [] : artifacts.questions.map((q) => q.def.id);
    const record: LastUpdate = {
      schema: 1,
      srclawyerVersion: report.srclawyerVersion,
      baselineSha256: sha256(baselineText ?? ""),
      result: report.result === "drift" ? "drift" : "no-drift",
      firstReview,
      reviewHash: artifacts.reviewHash,
      // On a first review nothing changed, so nothing is re-confirmed; the open questions are just the blank ones.
      triggered: firstReview ? [] : artifacts.questions.map((q) => ({ id: q.def.id, why: q.why })),
      answered: (previous?.answered ?? []).filter((id) => triggeredIds.includes(id)),
      diff: {
        addedCategories: diff.added.categories.map(categoryLabel),
        addedProcessors: diff.added.processors,
        removedCategories: diff.removed.categories.map(categoryLabel),
        removedProcessors: diff.removed.processors,
      },
      summary: artifacts.summary,
      inconclusiveReasonCount: 0,
    };
    writeLastUpdate(root, record);
  } else if ((report.result === "no-drift" || report.result === "inconclusive") && baselineText !== null) {
    writeLastUpdate(root, {
      schema: 1,
      srclawyerVersion: report.srclawyerVersion,
      baselineSha256: sha256(baselineText),
      result: report.result,
      reviewHash: null,
      triggered: [],
      answered: [],
      diff: null,
      summary: [],
      inconclusiveReasonCount: report.inconclusiveReasons.length,
    });
  }

  // policyMode: generated. The policy is a build output: whenever the scan is conclusive it is regenerated
  // from the code and the owner's answers, drift or not. An edited file is never overwritten silently.
  if (generatedMode && evaluation.scan && (report.result === "drift" || report.result === "no-drift")) {
    const finalResult = { ...evaluation.scan, findings: evaluation.findings, ambiguousCount: evaluation.findings.filter((f) => f.requiresReview).length };
    const body = generatePolicyMarkdown(finalResult, config, null, evaluation.protectedLogicWarning);
    const policyAbs = join(root, DEFAULT_POLICY_PATH);
    const choice = readPolicyChoice(root);
    const decision = checkPolicyWrite(policyAbs, DEFAULT_POLICY_PATH, false, choice?.choice === "discard" ? choice.fileSha256 : null);
    if (decision.allowed) {
      if (wouldDiscardOwnerWork(policyAbs)) console.error(BACKUP_NOTE.replace("{path}", backupFile(root, policyAbs, "PRIVACY_POLICY")));
      out.policy = writeMarkedFileOverwriting(policyAbs, DEFAULT_POLICY_PATH, body);
    } else {
      out.policy = { path: DEFAULT_POLICY_PATH, written: false, skippedReason: decision.kind };
      console.error(decision.message);
      exitCode = EXIT_CRASH;
    }
  }

  if (report.result !== "error") {
    const state = computeProjectState(root, options.inventoryPath);
    out.state = state.state;
    out.openQuestionCount = state.openQuestionCount;
    out.nextAction = state.nextAction;
    out.publishable = state.publishable;
    out.publishableBlockers = state.publishableBlockers;
    out.publishableWarnings = state.publishableWarnings;
  }

  if (options.format === "json") {
    console.log(JSON.stringify(out, null, 2));
  } else {
    // On a first review there is no earlier approved review to compare with, so the "no new items" verdict
    // would mislead: show what the scanner covered, then everything it found.
    if (firstReview) {
      if (report.coverage) console.log(report.coverage);
    } else {
      (report.result === "error" ? console.error : console.log)(renderCheckText(report, options.inventoryPath));
    }
    if (report.result === "drift" || firstReview) {
      console.log("");
      if (out.draft) console.log(out.draft.written ? COMMAND.draftWritten.replace("{path}", out.draft.path) : COMMAND.skippedEdited.replace("{path}", out.draft.path));
      if (out.review) console.log(out.review.written ? COMMAND.reviewWritten.replace("{path}", out.review.path) : COMMAND.skippedEdited.replace("{path}", out.review.path));
      console.log("");
      for (const line of out.summary) console.log(line);
      console.log(COMMAND.nothingChanged);
    }
  }
  return exitCode;
}


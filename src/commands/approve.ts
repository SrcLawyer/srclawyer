import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config/config.js";
import { computeInventory, MAX_APPROVAL_NOTE_CHARS, serializeInventory } from "../inventory/inventory.js";
import { QUESTION_DEFS, isAnswered } from "../assistant/questions.js";
import { readDeferred, readFreshLastUpdate } from "../assistant/stateDir.js";
import { readBaseline } from "../assistant/state.js";
import { STATUS } from "../assistant/wording.js";
import { EXIT_CRASH, EXIT_INCONCLUSIVE, EXIT_OK } from "../exitCodes.js";
import { evaluateDrift } from "./driftEvaluation.js";
import { buildUpdateArtifacts } from "./updateArtifacts.js";
import { readPackageVersion } from "../version.js";

export interface ApproveOptions {
  inventoryPath: string;
  /** The review hash from `update` / `questions` (at least 8 hex characters). */
  review: string;
  /** The user's reply: their yes, nothing else. */
  userReply: string;
  /** Question ids the owner chose to leave unanswered. */
  allowUnanswered: string[];
  json: boolean;
}

const AFFIRMATIVE = /^(yes|y|yeah|yep)\b/i;

function fail(options: ApproveOptions, code: string, message: string, extra: Record<string, unknown> = {}, exit = EXIT_CRASH): number {
  console.log(JSON.stringify({ schema: 1, ok: false, approved: false, error: { code, message }, ...extra }, null, 2));
  return exit;
}

/**
 * `srclawyer approve`: records the owner's confirmation. It scans again and derives the review itself,
 * so a forged or stale review file on disk changes nothing; the hash only proves the caller read the
 * review that is true now. The reply and the hash are a speed bump and an audit trail, not security.
 * Exit 0 recorded (or nothing to approve), 2 refused, 3 the scan could not finish.
 */
export async function runApprove(root: string, options: ApproveOptions): Promise<number> {
  const reply = options.userReply.trim();
  if (reply === "" || /[\u0000-\u001f\u007f]/.test(reply) || reply.length > MAX_APPROVAL_NOTE_CHARS) {
    return fail(options, "invalid-reply", `The reply must be one line of at most ${MAX_APPROVAL_NOTE_CHARS} characters.`);
  }
  if (!AFFIRMATIVE.test(reply)) return fail(options, "reply-not-yes", STATUS.replyNotYes);

  const evaluation = await evaluateDrift(root, options.inventoryPath);
  const { report } = evaluation;
  if (report.result === "error") return fail(options, "error", report.error ?? "SrcLawyer could not run.");
  if (report.result === "inconclusive") {
    return fail(options, "inconclusive", STATUS.inconclusive, { inconclusiveReasons: report.inconclusiveReasons }, EXIT_INCONCLUSIVE);
  }
  if (report.result === "no-drift") {
    console.log(JSON.stringify({ schema: 1, ok: true, approved: false, message: STATUS.nothingToApprove, published: false, committed: false }, null, 2));
    return EXIT_OK;
  }

  const config = loadConfig(root);
  const artifacts = buildUpdateArtifacts(evaluation, config);
  const given = options.review.trim().toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(given) || !artifacts.reviewHashFull.startsWith(given)) {
    return fail(options, "review-changed", STATUS.reviewChanged, { currentReviewHash: artifacts.reviewHash });
  }

  // Everything that still needs an answer, unless the owner explicitly left it for later.
  const baselineText = readBaseline(root, options.inventoryPath).text;
  const last = readFreshLastUpdate(root, baselineText);
  const answeredNow = last && last.reviewHash === artifacts.reviewHash ? new Set(last.answered) : new Set<string>();
  const deferred = new Set(readDeferred(root));
  const triggeredIds = new Set(artifacts.questions.map((q) => q.def.id));
  const allowed = new Set(options.allowUnanswered);
  const unanswered = QUESTION_DEFS.filter((def) => {
    const blank = !isAnswered(def, config) && def.blocking && !deferred.has(def.id);
    const needsConfirm = triggeredIds.has(def.id) && !answeredNow.has(def.id);
    return (blank || needsConfirm) && !allowed.has(def.id);
  }).map((def) => def.id);
  if (unanswered.length > 0) return fail(options, "questions-open", STATUS.questionsOpen, { unanswered });

  const inventory = computeInventory(evaluation.findings, { srclawyerVersion: readPackageVersion(), discovery: evaluation.report.currentDiscovery! });
  const path = join(root, options.inventoryPath);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, serializeInventory({ ...inventory, approval: { review: artifacts.reviewHashFull, note: reply } }));
  renameSync(tmp, path);

  console.log(
    JSON.stringify(
      { schema: 1, ok: true, approved: true, review: artifacts.reviewHash, note: reply, filesChanged: [options.inventoryPath], published: false, committed: false },
      null,
      2
    )
  );
  return EXIT_OK;
}

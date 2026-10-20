import { computeProjectState, type ProjectState } from "../assistant/state.js";
import { STATUS_TEXT, SUMMARY } from "../assistant/wording.js";
import { readPackageVersion } from "../version.js";
import { inspectAgentSetup } from "./agentSetup.js";

export interface StatusOptions {
  inventoryPath: string;
  json: boolean;
}

/** The JSON contract for `srclawyer status --json` (schema 1). */
export function statusReport(state: ProjectState, root?: string) {
  return {
    schema: 1 as const,
    srclawyerVersion: readPackageVersion(),
    state: state.state,
    blockedBy: state.blockedBy,
    policyMode: state.policyMode,
    policyPath: state.policyPath,
    baselineApproved: state.baselineApproved,
    publishable: state.publishable,
    publishableBlockers: state.publishableBlockers,
    publishableWarnings: state.publishableWarnings,
    reviewHash: state.reviewHash,
    openQuestionCount: state.openQuestionCount,
    nextAction: state.nextAction,
    agentSetup: root === undefined ? null : inspectAgentSetup(root, readPackageVersion()),
  };
}

/**
 * Where the project stands, read from local files only: no scan and no network call. Always exits 0
 * (it reports; it does not judge).
 */
export function runStatus(root: string, options: StatusOptions): number {
  const state = computeProjectState(root, options.inventoryPath);
  const report = statusReport(state, root);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(`${STATUS_TEXT.state} ${report.state}`);
  for (const b of report.blockedBy) console.log(b.message);
  console.log(`${STATUS_TEXT.publishable} ${report.publishable ? "yes" : "no"}`);
  for (const b of report.publishableBlockers) console.log(b.message);
  for (const w of report.publishableWarnings) console.log(w.message);
  if (report.openQuestionCount > 0) console.log((report.openQuestionCount === 1 ? SUMMARY.questionsOne : SUMMARY.questionsMany).replace("{n}", String(report.openQuestionCount)));
  return 0;
}

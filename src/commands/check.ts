import { CHECK_NO_DRIFT_LINE, NO_DRIFT_STATEMENT } from "../assistant/wording.js";
import { evaluateDrift, type CheckReport } from "./driftEvaluation.js";

export type { CheckReport } from "./driftEvaluation.js";

export type CheckFormat = "text" | "json";

export interface CheckOptions {
  inventoryPath: string;
  format: CheckFormat;
}

export const FIX_INSTRUCTION = 'If this change is intended, update your privacy policy, then refresh the baseline with "srclawyer scan --write-inventory" and commit it.';

function listLine(label: string, values: string[]): string[] {
  return values.length > 0 ? [`  ${label} ${values.join(", ")}`] : [];
}

/** The human-readable verdict, shared by `check` and `update`. */
export function renderCheckText(report: CheckReport, inventoryPath: string): string {
  const lines: string[] = [];
  switch (report.result) {
    case "no-drift":
      lines.push(CHECK_NO_DRIFT_LINE);
      lines.push(`  Baseline ${inventoryPath} (srclawyer ${report.baseline?.srclawyerVersion}, ${report.baseline?.discovery} discovery) matches the code.`);
      lines.push("", NO_DRIFT_STATEMENT);
      break;
    case "drift": {
      lines.push("Drift check: DRIFT DETECTED.");
      const d = report.diff!;
      lines.push(...listLine("Added categories:  ", d.added.categories), ...listLine("Removed categories:", d.removed.categories));
      lines.push(...listLine("Added processors:  ", d.added.processors), ...listLine("Removed processors:", d.removed.processors));
      if (report.baseline && report.baseline.srclawyerVersion !== report.srclawyerVersion) {
        lines.push(`  (The baseline was written by srclawyer ${report.baseline.srclawyerVersion}; this is ${report.srclawyerVersion}. Detection rules can change between versions.)`);
      }
      lines.push("", FIX_INSTRUCTION);
      break;
    }
    case "inconclusive":
      lines.push("Drift check: INCONCLUSIVE — no drift verdict, because the scan was not complete or comparable:");
      for (const reason of report.inconclusiveReasons) lines.push(`  - ${reason}`);
      break;
    case "error":
      lines.push(`error: ${report.error}`);
      break;
  }
  if (report.coverage && report.result !== "error") lines.push("", report.coverage);
  return lines.join("\n");
}

function finish(report: CheckReport, options: CheckOptions): number {
  if (options.format === "json") console.log(JSON.stringify(report, null, 2));
  else (report.result === "error" ? console.error : console.log)(renderCheckText(report, options.inventoryPath));
  return report.exitCode;
}

/**
 * Re-derives the inventory and compares it with the committed baseline. Never writes a policy, never
 * calls an LLM provider, and never reports an incomplete scan as drift (see evaluateDrift).
 */
export async function runCheck(root: string, options: CheckOptions): Promise<number> {
  const evaluation = await evaluateDrift(root, options.inventoryPath);
  return finish(evaluation.report, options);
}

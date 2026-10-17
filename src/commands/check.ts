import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scan } from "../engine/scanEngine.js";
import { selectDiscovery } from "../engine/gitDiscovery.js";
import { resolveScanProtectedLogic } from "./protectedLogicStep.js";
import {
  computeInventory,
  diffInventories,
  hasDrift,
  inventoryBlockers,
  parseInventory,
  type DiscoveryMode,
  type InventoryDiff,
} from "../inventory/inventory.js";
import { EXIT_CRASH, EXIT_DRIFT, EXIT_INCONCLUSIVE, EXIT_OK } from "../exitCodes.js";
import { readPackageVersion } from "../version.js";

export type CheckFormat = "text" | "json";

export interface CheckOptions {
  inventoryPath: string;
  format: CheckFormat;
}

export interface CheckReport {
  result: "no-drift" | "drift" | "inconclusive" | "error";
  exitCode: number;
  srclawyerVersion: string;
  baseline: { path: string; srclawyerVersion: string; discovery: DiscoveryMode } | null;
  currentDiscovery: DiscoveryMode | null;
  /** Present only for a conclusive result -- an inconclusive run never reports a diff. */
  diff: InventoryDiff | null;
  inconclusiveReasons: string[];
  error: string | null;
}

const FIX_INSTRUCTION = 'If this change is intended, update your privacy policy, then refresh the baseline with "srclawyer scan --write-inventory" and commit it.';

function listLine(label: string, values: string[]): string[] {
  return values.length > 0 ? [`  ${label} ${values.join(", ")}`] : [];
}

function renderText(report: CheckReport, inventoryPath: string): string {
  const lines: string[] = [];
  switch (report.result) {
    case "no-drift":
      lines.push("Drift check: no drift.");
      lines.push(`  Baseline ${inventoryPath} (srclawyer ${report.baseline?.srclawyerVersion}, ${report.baseline?.discovery} discovery) matches the code.`);
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
  return lines.join("\n");
}

function finish(report: CheckReport, options: CheckOptions): number {
  if (options.format === "json") console.log(JSON.stringify(report, null, 2));
  else (report.result === "error" ? console.error : console.log)(renderText(report, options.inventoryPath));
  return report.exitCode;
}

const baseReport = (): CheckReport => ({
  result: "error",
  exitCode: EXIT_CRASH,
  srclawyerVersion: readPackageVersion(),
  baseline: null,
  currentDiscovery: null,
  diff: null,
  inconclusiveReasons: [],
  error: null,
});

/**
 * Re-derives the inventory and compares it with the committed baseline. Never writes a policy, never
 * calls an LLM provider, and never reports an incomplete scan as drift: anything that makes the scan
 * untrustworthy (the same warnings that make `scan` exit 1, or a discovery-mode mismatch) is
 * inconclusive and carries no diff.
 */
export async function runCheck(root: string, options: CheckOptions): Promise<number> {
  const path = resolve(root, options.inventoryPath);

  if (!existsSync(path)) {
    return finish({ ...baseReport(), error: `no baseline found at ${options.inventoryPath}. Create one with "srclawyer scan --write-inventory" and commit it.` }, options);
  }
  const parsed = parseInventory(readFileSync(path, "utf8"));
  if (!parsed.ok) {
    return finish({ ...baseReport(), error: `the baseline at ${options.inventoryPath} is invalid: ${parsed.reason}. Re-create it with "srclawyer scan --write-inventory".` }, options);
  }
  const baseline = parsed.inventory;

  const discovery = selectDiscovery(root);
  const result = await scan(root, { onlyFiles: discovery.files });
  const protectedLogic = await resolveScanProtectedLogic(result);

  const reasons = inventoryBlockers(result, protectedLogic.warning);
  if (baseline.discovery !== discovery.mode) {
    reasons.push(
      `Discovery mode mismatch: the baseline was written with ${baseline.discovery} discovery, but this run used ${discovery.mode} discovery${discovery.mode === "glob" ? ` (${discovery.reason})` : ""}. The two see different files, so they can't be compared.`
    );
  }

  const report: CheckReport = {
    ...baseReport(),
    baseline: { path: options.inventoryPath, srclawyerVersion: baseline.srclawyerVersion, discovery: baseline.discovery },
    currentDiscovery: discovery.mode,
  };

  if (reasons.length > 0) {
    return finish({ ...report, result: "inconclusive", exitCode: EXIT_INCONCLUSIVE, inconclusiveReasons: reasons }, options);
  }

  const current = computeInventory(protectedLogic.findings, { srclawyerVersion: readPackageVersion(), discovery: discovery.mode });
  const diff = diffInventories(baseline, current);
  return finish(
    hasDrift(diff) ? { ...report, result: "drift", exitCode: EXIT_DRIFT, diff } : { ...report, result: "no-drift", exitCode: EXIT_OK, diff },
    options
  );
}

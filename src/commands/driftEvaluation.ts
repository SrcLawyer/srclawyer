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
  type Inventory,
  type InventoryDiff,
} from "../inventory/inventory.js";
import { EXIT_CRASH, EXIT_DRIFT, EXIT_INCONCLUSIVE, EXIT_OK } from "../exitCodes.js";
import { readPackageVersion } from "../version.js";
import { coverageLine } from "../report/coverage.js";
import type { Finding, ScanResult } from "../engine/types.js";

export interface CheckReport {
  result: "no-drift" | "drift" | "inconclusive" | "error";
  exitCode: number;
  srclawyerVersion: string;
  baseline: { path: string; srclawyerVersion: string; discovery: DiscoveryMode; /** Whether `srclawyer approve` has recorded an approval in it. `check` does not require one. */ approved: boolean } | null;
  currentDiscovery: DiscoveryMode | null;
  /** Present only for a conclusive result -- an inconclusive run never reports a diff. */
  diff: InventoryDiff | null;
  inconclusiveReasons: string[];
  error: string | null;
  /** One path-free sentence on what the scan covered and did not; null when no scan ran. */
  coverage: string | null;
}

export interface DriftEvaluation {
  report: CheckReport;
  /** The scan itself, for callers that go on to write a draft; null when the baseline was missing or invalid. */
  scan: ScanResult | null;
  /** Findings after the protected-logic step. */
  findings: Finding[];
  protectedLogicWarning: string | null;
  baseline: Inventory | null;
  current: Inventory | null;
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
  coverage: null,
});

const empty = (report: CheckReport): DriftEvaluation => ({ report, scan: null, findings: [], protectedLogicWarning: null, baseline: null, current: null });

/**
 * Re-derives the inventory and compares it with the committed baseline, without printing or writing
 * anything. Never calls an LLM provider, and never reports an incomplete scan as drift: anything that
 * makes the scan untrustworthy (the warnings that make `scan` exit 1, or a discovery-mode mismatch)
 * is inconclusive and carries no diff. Shared by `check` and `update`.
 */
export async function evaluateDrift(root: string, inventoryPath: string): Promise<DriftEvaluation> {
  const path = resolve(root, inventoryPath);

  if (!existsSync(path)) {
    return empty({ ...baseReport(), error: `no baseline found at ${inventoryPath}. Create one with "srclawyer scan --write-inventory" and commit it.` });
  }
  const parsed = parseInventory(readFileSync(path, "utf8"));
  if (!parsed.ok) {
    return empty({ ...baseReport(), error: `the baseline at ${inventoryPath} is invalid: ${parsed.reason}. Re-create it with "srclawyer scan --write-inventory".` });
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
    baseline: { path: inventoryPath, srclawyerVersion: baseline.srclawyerVersion, discovery: baseline.discovery, approved: baseline.approval !== undefined },
    currentDiscovery: discovery.mode,
    coverage: coverageLine({ scan: result, discovery: discovery.mode, aiReviewOn: false }),
  };
  const base = { scan: result, findings: protectedLogic.findings, protectedLogicWarning: protectedLogic.warning, baseline };

  if (reasons.length > 0) {
    return { ...base, report: { ...report, result: "inconclusive", exitCode: EXIT_INCONCLUSIVE, inconclusiveReasons: reasons }, current: null };
  }

  const current = computeInventory(protectedLogic.findings, { srclawyerVersion: readPackageVersion(), discovery: discovery.mode });
  const diff = diffInventories(baseline, current);
  return {
    ...base,
    current,
    report: hasDrift(diff) ? { ...report, result: "drift", exitCode: EXIT_DRIFT, diff } : { ...report, result: "no-drift", exitCode: EXIT_OK, diff },
  };
}

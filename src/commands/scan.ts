import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIG_FILENAME, hasUnmigratedLegacyConfig, legacyConfigMessage, loadConfig } from "../config/config.js";
import { scan } from "../engine/scanEngine.js";
import { formatText } from "../report/formatText.js";
import { generatePolicyMarkdown } from "../policy/generatePolicy.js";
import { resolveProviderForTier } from "../llm/resolveProviderForTier.js";
import { resolveAmbiguousFindings } from "../llm/resolveAmbiguousFindings.js";
import { resolveScanProtectedLogic } from "./protectedLogicStep.js";
import { selectDiscovery } from "../engine/gitDiscovery.js";
import { computeInventory, inventoryBlockers, serializeInventory } from "../inventory/inventory.js";
import { readPackageVersion } from "../version.js";
import { MAX_FRAGMENT_BYTES } from "../rules/zodPreFilter.js";
import { SCAN_DISCLAIMER_REMINDER, byokNetworkNotice } from "../policy/legalNotices.js";
import type { Finding } from "../engine/types.js";

export interface ScanOptions {
  json: boolean;
  out: string;
  llm: boolean;
  /** Write the drift baseline to this path (relative to root). With this set the scan uses the shared
   *  git-aware discovery mode (see gitDiscovery.ts) for the policy as well, so the two always agree. */
  writeInventory?: string;
  /** Write the baseline even if the scan completed with warnings that make it untrustworthy. */
  allowIncompleteInventory?: boolean;
}

export async function runScan(root: string, options: ScanOptions): Promise<void> {
  const config = loadConfig(root);
  let legacyConfigWarning: string | null = null;
  if (!config) {
    if (hasUnmigratedLegacyConfig(root)) {
      legacyConfigWarning = legacyConfigMessage();
      console.error(legacyConfigWarning);
    } else {
      console.error(`No ${CONFIG_FILENAME} found. Run "srclawyer init" first.\n`);
    }
  }

  const discovery = options.writeInventory ? selectDiscovery(root) : null;
  const result = await scan(root, { onlyFiles: discovery?.files ?? null });
  let findings: Finding[] = result.findings;

  if (result.workspaceWarning) console.error(result.workspaceWarning);
  if (result.skippedFilesWarning) console.error(result.skippedFilesWarning);
  if (result.templateSyntaxNote) console.error(result.templateSyntaxNote);

  if (result.maxZodFragmentBytes > 0) {
    console.error(`Largest Zod-schema fragment this scan: ${result.maxZodFragmentBytes} bytes (hard ceiling: ${MAX_FRAGMENT_BYTES} bytes).`);
  }

  const protectedLogic = await resolveScanProtectedLogic(result);
  findings = protectedLogic.findings;
  const protectedLogicWarning = protectedLogic.warning;
  if (protectedLogicWarning) console.error(protectedLogicWarning);

  let llmError: string | null = null;

  if (options.llm && config) {
    const { provider, error } = resolveProviderForTier(config);
    if (error) {
      llmError = error;
      console.error(error);
    } else if (provider) {
      const ambiguous = findings.filter((f) => f.requiresReview);
      if (ambiguous.length > 0) {
        if (config.tier === "byok" && config.llm) {
          console.log(byokNetworkNotice(config.llm.apiKeyEnvVar));
        }
        console.log(`Sending ${ambiguous.length} ambiguous item(s) to ${provider.name} (an opaque id, category, description and one redacted source line each)...`);
        const resolved = await resolveAmbiguousFindings(ambiguous, provider, {
          // Preserves today's exact override behavior bit-for-bit: a missing/legacy key already
          // behaved as false before collectsChildrensData became nullable. Only the generated
          // document (generatePolicy.ts) distinguishes "explicitly no" from "never answered" -- this
          // safety-critical override is unchanged.
          collectsChildrensData: config.collectsChildrensData ?? false,
        });
        const resolvedById = new Map(resolved.map((f) => [f.id, f]));
        findings = findings.map((f) => resolvedById.get(f.id) ?? f);
      }
    }
  }

  const ambiguousCount = findings.filter((f) => f.requiresReview).length;
  const finalResult = { ...result, findings, ambiguousCount };
  const policyPath = resolve(root, options.out);
  writeFileSync(policyPath, generatePolicyMarkdown(finalResult, config, llmError, protectedLogicWarning));

  let inventoryNote: string | null = null;
  if (options.writeInventory && discovery) {
    const blockers = inventoryBlockers(result, protectedLogicWarning);
    if (blockers.length > 0 && !options.allowIncompleteInventory) {
      inventoryNote = `Inventory not written: this scan completed with warnings (see above), so its categories may be incomplete and would read as drift later. Fix them and re-run, or pass --allow-incomplete-inventory to write it anyway.`;
      console.error(inventoryNote);
    } else {
      const inventory = computeInventory(finalResult.findings, { srclawyerVersion: readPackageVersion(), discovery: discovery.mode });
      writeFileSync(resolve(root, options.writeInventory), serializeInventory(inventory));
      inventoryNote = `Wrote the drift baseline to ${options.writeInventory} (${inventory.categories.length} categories, ${inventory.processors.length} processors; ${discovery.mode} discovery). Commit it, then run "srclawyer check" in CI.`;
      if (discovery.mode === "glob") inventoryNote += ` (${discovery.reason}; the baseline records the ordinary filesystem walk.)`;
      console.error(inventoryNote);
    }
  }

  if (result.unsupportedStackWarning || result.workspaceWarning || result.skippedFilesWarning || llmError || protectedLogicWarning || legacyConfigWarning) {
    process.exitCode = 1;
  }

  if (options.json) {
    console.log(JSON.stringify({ ...finalResult, policyPath, llmError, protectedLogicWarning, legacyConfigWarning, inventoryNote }, null, 2));
    return;
  }

  console.log(formatText(finalResult, { aiReviewEnabled: config?.tier === "byok" }));
  if (protectedLogicWarning) console.log(`\n${protectedLogicWarning}`);
  if (legacyConfigWarning) console.log(`\n${legacyConfigWarning}`);
  console.log(`\nPrivacy policy written to ${join(options.out)}`);
  console.log(`\n${SCAN_DISCLAIMER_REMINDER}`);
}

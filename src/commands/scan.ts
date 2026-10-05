import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIG_FILENAME, hasUnmigratedLegacyConfig, legacyConfigMessage, loadConfig } from "../config/config.js";
import { scan } from "../engine/scanEngine.js";
import { formatText } from "../report/formatText.js";
import { generatePolicyMarkdown } from "../policy/generatePolicy.js";
import { resolveProviderForTier } from "../llm/resolveProviderForTier.js";
import { resolveAmbiguousFindings } from "../llm/resolveAmbiguousFindings.js";
import { resolveProtectedLogic } from "../cloud/resolveProtectedLogic.js";
import { resolveProtectedLogicEndpoint } from "../cloud/config.js";
import { MAX_FRAGMENT_BYTES } from "../rules/zodPreFilter.js";
import type { Finding } from "../engine/types.js";

export interface ScanOptions {
  json: boolean;
  out: string;
  llm: boolean;
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

  const result = await scan(root);
  let findings: Finding[] = result.findings;

  if (result.maxZodFragmentBytes > 0) {
    console.error(`Largest Zod-schema fragment this scan: ${result.maxZodFragmentBytes} bytes (hard ceiling: ${MAX_FRAGMENT_BYTES} bytes).`);
  }

  // Not tier-gated, not behind --no-llm: confidence scoring and Zod-schema detection are Layer 1
  // capabilities now, needed on every real scan regardless of which LLM tier (if any) is configured.
  // A failure here degrades honestly (findings keep their safe local fallback) rather than blocking
  // the scan — see resolveProtectedLogic's own per-call error handling.
  const hasScorableFindings =
    findings.some((f) => f.confidenceFactors) || result.pendingZodCandidates.length > 0 || result.oversizedZodFiles.length > 0;
  let protectedLogicWarning: string | null = null;
  if (hasScorableFindings) {
    const endpoint = resolveProtectedLogicEndpoint();
    const resolved = await resolveProtectedLogic(findings, result.pendingZodCandidates, endpoint, result.oversizedZodFiles);
    findings = resolved.findings;
    protectedLogicWarning = resolved.warning;
    if (protectedLogicWarning) console.error(protectedLogicWarning);
  }

  let llmError: string | null = null;

  if (options.llm && config) {
    const { provider, error } = resolveProviderForTier(config);
    if (error) {
      llmError = error;
      console.error(error);
    } else if (provider) {
      const ambiguous = findings.filter((f) => f.requiresReview);
      if (ambiguous.length > 0) {
        console.log(`Sending ${ambiguous.length} ambiguous item(s) to ${provider.name}...`);
        const resolved = await resolveAmbiguousFindings(ambiguous, provider, {
          collectsChildrensData: config.collectsChildrensData,
        });
        const resolvedById = new Map(resolved.map((f) => [f.id, f]));
        findings = findings.map((f) => resolvedById.get(f.id) ?? f);
      }
    }
  }

  const ambiguousCount = findings.filter((f) => f.requiresReview).length;
  const finalResult = { ...result, findings, ambiguousCount };
  const policyPath = resolve(root, options.out);
  writeFileSync(policyPath, generatePolicyMarkdown(finalResult, config, llmError));

  if (result.unsupportedStackWarning || llmError || protectedLogicWarning || legacyConfigWarning) {
    process.exitCode = 1;
  }

  if (options.json) {
    console.log(JSON.stringify({ ...finalResult, policyPath, llmError, protectedLogicWarning, legacyConfigWarning }, null, 2));
    return;
  }

  console.log(formatText(finalResult));
  if (protectedLogicWarning) console.log(`\n${protectedLogicWarning}`);
  if (legacyConfigWarning) console.log(`\n${legacyConfigWarning}`);
  console.log(`\nPrivacy policy written to ${join(options.out)}`);
}

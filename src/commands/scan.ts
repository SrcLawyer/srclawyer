import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../config/config.js";
import { scan } from "../engine/scanEngine.js";
import { formatText } from "../report/formatText.js";
import { generatePolicyMarkdown } from "../policy/generatePolicy.js";
import { resolveProviderForTier } from "../llm/resolveProviderForTier.js";
import { resolveAmbiguousFindings } from "../llm/resolveAmbiguousFindings.js";
import type { Finding } from "../engine/types.js";

export interface ScanOptions {
  json: boolean;
  out: string;
  llm: boolean;
}

export async function runScan(root: string, options: ScanOptions): Promise<void> {
  const config = loadConfig(root);
  if (!config) {
    console.error('No .privacypolicy.yml found. Run "srclawyer init" first.\n');
  }

  const result = await scan(root);
  let findings: Finding[] = result.findings;
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

  const finalResult = { ...result, findings };
  const policyPath = resolve(root, options.out);
  writeFileSync(policyPath, generatePolicyMarkdown(finalResult, config, llmError));

  if (result.unsupportedStackWarning || llmError) {
    process.exitCode = 1;
  }

  if (options.json) {
    console.log(JSON.stringify({ ...finalResult, policyPath, llmError }, null, 2));
    return;
  }

  console.log(formatText(finalResult));
  console.log(`\nPrivacy policy written to ${join(options.out)}`);
}

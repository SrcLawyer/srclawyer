import type { Finding, ScanResult } from "../engine/types.js";

const BANNER_RULE = "=".repeat(72);

export function formatText(result: ScanResult): string {
  const lines: string[] = [];

  if (result.unsupportedStackWarning) {
    lines.push(BANNER_RULE);
    lines.push("WARNING:");
    lines.push(result.unsupportedStackWarning);
    lines.push(BANNER_RULE);
    lines.push("");
  }

  lines.push(`Scanned ${result.filesScanned} file(s) across ${result.projects.length} project(s).`);
  lines.push(`Found ${result.findings.length} finding(s), ${result.ambiguousCount} requiring review.`);
  lines.push("");

  const byProcessor = result.findings.filter((f) => f.processor);
  const byField = result.findings.filter((f) => !f.processor);

  if (byProcessor.length > 0) {
    lines.push("Third-party processors detected:");
    for (const f of byProcessor) {
      lines.push(`  [${f.confidence}] ${f.processor} — ${f.location.file}:${f.location.line}`);
      lines.push(`      ${f.description}`);
    }
    lines.push("");
  }

  if (byField.length > 0) {
    lines.push("Data fields collected:");
    for (const f of byField) {
      const displayCategories = f.llmResolution?.resolvedDataCategories ?? f.dataCategories;
      lines.push(`  [${f.confidence}] ${displayCategories.join(", ")}${reviewFlag(f)} — ${f.location.file}:${f.location.line}`);
      lines.push(`      ${f.evidence}`);
    }
  }

  const resolvedCount = result.findings.filter((f) => f.llmResolution?.outcome === "resolved").length;
  const declinedCount = result.findings.filter((f) => f.llmResolution?.outcome === "declined").length;
  const stillUnresolvedCount = result.findings.filter((f) => f.requiresReview && f.llmResolution?.outcome !== "resolved" && f.llmResolution?.outcome !== "declined").length;

  if (resolvedCount > 0 || declinedCount > 0) {
    lines.push("");
    lines.push(`AI-assisted resolution: ${resolvedCount} resolved, ${declinedCount} declined (with a reason), ${stillUnresolvedCount} still unresolved.`);
  } else if (result.ambiguousCount > 0) {
    lines.push("");
    lines.push(`${result.ambiguousCount} item(s) require deeper analysis before they can be included in a policy. Run "srclawyer scan" with a "byok"/"managed" tier configured to attempt AI-assisted resolution, or resolve manually.`);
  }

  return lines.join("\n");
}

function reviewFlag(finding: Finding): string {
  if (!finding.requiresReview) return "";
  if (finding.llmResolution?.outcome === "resolved") return " (resolved by AI)";
  if (finding.llmResolution?.outcome === "declined") return ` (declined by AI: ${finding.llmResolution.reason})`;
  return " (needs review)";
}

import type { DataCategory, Finding, ScanResult } from "../engine/types.js";
import { CONFIG_FILENAME, type SrcLawyerConfig } from "../config/config.js";
import { DATA_CATEGORY_LABELS } from "./dataCategoryLabels.js";
import { MANDATORY_DISCLAIMER } from "./disclaimer.js";

function locationRef(finding: Finding): string {
  return `${finding.location.file}:${finding.location.line}`;
}

function effectiveCategories(finding: Finding): DataCategory[] {
  return finding.llmResolution?.resolvedDataCategories ?? finding.dataCategories;
}

function effectiveDescription(finding: Finding): string {
  return finding.llmResolution?.resolvedDescription ?? finding.description;
}

function groupByCategory(findings: Finding[]): Map<DataCategory, Finding[]> {
  const byCategory = new Map<DataCategory, Finding[]>();
  for (const finding of findings) {
    for (const category of effectiveCategories(finding)) {
      const existing = byCategory.get(category) ?? [];
      existing.push(finding);
      byCategory.set(category, existing);
    }
  }
  return byCategory;
}

function renderCategorySections(confidentFindings: Finding[]): string[] {
  const byCategory = groupByCategory(confidentFindings);
  const sections: string[] = [];

  for (const [category, findings] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const lines = [`### ${DATA_CATEGORY_LABELS[category]}`, ""];
    for (const finding of findings) {
      const attribution = finding.processor ? ` (via ${finding.processor})` : "";
      const aiNote = finding.llmResolution?.outcome === "resolved" ? " _(AI-assisted)_" : "";
      lines.push(`- ${effectiveDescription(finding)}${attribution}${aiNote} — \`${locationRef(finding)}\``);
    }
    sections.push(lines.join("\n"));
  }

  return sections;
}

function renderProcessorSection(confidentFindings: Finding[]): string | null {
  const processors = new Map<string, { description: string; locations: string[] }>();

  for (const finding of confidentFindings) {
    if (!finding.processor) continue;
    const existing = processors.get(finding.processor) ?? { description: effectiveDescription(finding), locations: [] };
    existing.locations.push(locationRef(finding));
    processors.set(finding.processor, existing);
  }

  if (processors.size === 0) return null;

  const lines = ["## Third-Party Data Processors", "", "This codebase integrates with the following third-party services, detected via import/require analysis:", ""];
  for (const [name, { description, locations }] of processors) {
    lines.push(`- **${name}** — ${description} (\`${locations.join("`, `")}\`)`);
  }
  return lines.join("\n");
}

function renderReviewSection(reviewFindings: Finding[]): string | null {
  if (reviewFindings.length === 0) return null;

  const lines = [
    "## Items Requiring Manual Review",
    "",
    "Automated analysis could not confidently classify the following items. They are **not** included in the sections above and must be reviewed manually before this policy is considered complete:",
    "",
  ];
  for (const finding of reviewFindings) {
    const attemptNote = finding.llmResolution?.reason ? ` (AI resolution attempt failed: ${finding.llmResolution.reason})` : "";
    lines.push(`- \`${finding.evidence}\` — ${finding.description} — \`${locationRef(finding)}\`${attemptNote}`);
  }
  return lines.join("\n");
}

function renderDeclinedSection(declinedFindings: Finding[]): string | null {
  if (declinedFindings.length === 0) return null;

  const lines = [
    "## Items Declined by AI-Assisted Review",
    "",
    "These items were reviewed by the AI-assisted resolution layer, which explicitly declined to classify them rather than guess. They are **not** included in the sections above and must be reviewed manually:",
    "",
  ];
  for (const finding of declinedFindings) {
    lines.push(`- \`${finding.evidence}\` — ${finding.description} — declined: "${finding.llmResolution?.reason}" — \`${locationRef(finding)}\``);
  }
  return lines.join("\n");
}

function renderLlmErrorWarning(llmError: string): string {
  return ["> **WARNING: AI-ASSISTED RESOLUTION DID NOT RUN**", ">", `> ${llmError}`].join("\n");
}

function renderContextSection(config: SrcLawyerConfig | null): string {
  if (!config) {
    return [
      "## Scope",
      "",
      `No \`${CONFIG_FILENAME}\` configuration was found, so this policy was generated without jurisdiction, target-market, or industry context. Run \`srclawyer init\` and re-run \`srclawyer scan\` to include that context.`,
    ].join("\n");
  }

  const lines = ["## Scope", ""];
  lines.push(`- **Entity location:** ${config.entityLocation ?? "not specified"}`);
  lines.push(`- **Target markets:** ${config.targetMarkets.length > 0 ? config.targetMarkets.join(", ") : "not specified"}`);
  lines.push(`- **Industry:** ${config.industry ?? "not specified"}`);
  lines.push(`- **Collects children's data:** ${config.collectsChildrensData ? "yes" : "no"}`);
  return lines.join("\n");
}

function renderUnsupportedStackWarning(warning: string): string {
  return ["> **WARNING: INCOMPLETE SCAN — DO NOT PUBLISH WITHOUT MANUAL REVIEW**", ">", `> ${warning}`].join("\n");
}

type FindingOutcome = "confident" | "resolved" | "declined" | "unresolved";

function outcomeOf(finding: Finding): FindingOutcome {
  if (!finding.requiresReview) return "confident";
  if (finding.llmResolution?.outcome === "resolved") return "resolved";
  if (finding.llmResolution?.outcome === "declined") return "declined";
  return "unresolved";
}

export function generatePolicyMarkdown(result: ScanResult, config: SrcLawyerConfig | null, llmError?: string | null): string {
  const confidentFindings = result.findings.filter((f) => {
    const outcome = outcomeOf(f);
    return outcome === "confident" || outcome === "resolved";
  });
  const declinedFindings = result.findings.filter((f) => outcomeOf(f) === "declined");
  const reviewFindings = result.findings.filter((f) => outcomeOf(f) === "unresolved");

  const parts: string[] = ["# Privacy Policy", ""];

  if (result.unsupportedStackWarning) {
    parts.push(renderUnsupportedStackWarning(result.unsupportedStackWarning), "");
  }

  if (llmError) {
    parts.push(renderLlmErrorWarning(llmError), "");
  }

  parts.push(
    `_Generated by SrcLawyer from static analysis of this codebase (${result.filesScanned} file(s) scanned)._`,
    "",
    renderContextSection(config),
    "",
    "## Data We Collect",
    ""
  );

  const categorySections = renderCategorySections(confidentFindings);
  if (categorySections.length > 0) {
    parts.push(categorySections.join("\n\n"));
  } else if (result.unsupportedStackWarning) {
    parts.push("**Not analyzed:** this codebase's primary language/framework isn't supported yet (see the warning above). This is not a clean-scan result — nothing below should be read as \"no data collection found.\"");
  } else {
    parts.push("No data-collection patterns were confidently identified in this codebase.");
  }

  const processorSection = renderProcessorSection(confidentFindings);
  if (processorSection) {
    parts.push("", processorSection);
  }

  const declinedSection = renderDeclinedSection(declinedFindings);
  if (declinedSection) {
    parts.push("", declinedSection);
  }

  const reviewSection = renderReviewSection(reviewFindings);
  if (reviewSection) {
    parts.push("", reviewSection);
  }

  parts.push("", "## Disclaimer", "", MANDATORY_DISCLAIMER);

  return parts.join("\n") + "\n";
}

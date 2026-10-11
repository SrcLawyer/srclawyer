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
  lines.push(
    `- **Collects children's data:** ${config.collectsChildrensData === null || config.collectsChildrensData === undefined ? "not specified" : config.collectsChildrensData ? "yes" : "no"}`
  );
  return lines.join("\n");
}

function renderUnsupportedStackWarning(warning: string): string {
  return ["> **WARNING: INCOMPLETE SCAN — DO NOT PUBLISH WITHOUT MANUAL REVIEW**", ">", `> ${warning}`].join("\n");
}

// Mirrors renderUnsupportedStackWarning's own reasoning exactly: this policy FILE gets committed and
// shared on its own, without the CLI output that already shows this warning -- a reader of the file
// alone has no other way to know confidence grading or Zod-schema detection didn't run for this scan.
function renderProtectedLogicWarning(warning: string): string {
  return ["> **WARNING: PROTECTED-LOGIC SERVICE UNAVAILABLE — POLICY MAY BE INCOMPLETE**", ">", `> ${warning}`].join("\n");
}

function placeholder(label: string): string {
  return `[TO COMPLETE: ${label}]`;
}

// The one function permitted to record that a fact was never answered -- every new section below
// goes through this (directly or via valueOrPlaceholder/triStateSentence) so renderPlaceholderSummary
// can list everything that's missing in one place, without a second pass over the config.
function placeholderLine(label: string, placeholders: string[]): string {
  placeholders.push(label);
  return placeholder(label);
}

function valueOrPlaceholder(value: string | null | undefined, label: string, placeholders: string[]): string {
  if (value === null || value === undefined || value === "") return placeholderLine(label, placeholders);
  return value;
}

function triStateSentence(
  value: boolean | null | undefined,
  label: string,
  trueText: string,
  falseText: string,
  placeholders: string[]
): string {
  if (value === true) return trueText;
  if (value === false) return falseText;
  return placeholderLine(label, placeholders);
}

function renderIdentitySection(config: SrcLawyerConfig | null, placeholders: string[]): string {
  const companyName = valueOrPlaceholder(config?.companyName, "company or product name", placeholders);
  const siteUrl = valueOrPlaceholder(config?.siteUrl, "site or app URL", placeholders);
  const privacyContactEmail = valueOrPlaceholder(config?.privacyContactEmail, "privacy contact email address", placeholders);

  return [
    "## About This Policy",
    "",
    `This policy is issued by ${companyName}.`,
    `It applies to the product or service available at ${siteUrl}.`,
    `Questions about this policy or requests regarding your personal data can be sent to ${privacyContactEmail}.`,
  ].join("\n");
}

// The sell/share and advertising sentences are the highest-risk new text in this document: the policy
// can simultaneously list detected third-party integrations (e.g. Stripe) in the Third-Party Data
// Processors section above. These sentences deliberately (1) use CCPA/CPRA's own defined terms rather
// than casual language, (2) frame the statement as the user's own self-declared setup answer, not a
// legal conclusion drawn by this tool, and (3) always close with an explicit cross-reference back to
// the detected-processors section, in all three states (true/false/placeholder), so the two sections
// are never read in isolation from each other. See docs/legal-wording-review.md -- this is drafted,
// attorney-reviewable starting wording, not settled language.
function renderDataPracticesSection(config: SrcLawyerConfig | null, placeholders: string[]): string {
  const retention = valueOrPlaceholder(config?.dataRetentionPolicy, "data retention period or policy", placeholders);
  const deletion = valueOrPlaceholder(
    config?.accountDeletionInstructions,
    "how a user can delete their account or request data deletion",
    placeholders
  );

  const sellShare = triStateSentence(
    config?.sellsOrSharesData,
    'whether personal data is sold or shared with third parties, as "sell" and "share" are defined under applicable law (e.g. CCPA/CPRA)',
    'Based on information provided during setup, this product has been declared to sell or share personal data with third parties, as "sell" and "share" are defined under applicable law (e.g. CCPA/CPRA).',
    'Based on information provided during setup, this product has not been declared to sell or share personal data with third parties, as "sell" and "share" are defined under applicable law (e.g. CCPA/CPRA).',
    placeholders
  );

  const advertising = triStateSentence(
    config?.usesDataForAdvertising,
    "whether personal data is used for cross-context behavioral advertising",
    "Based on information provided during setup, this product has been declared to use personal data for cross-context behavioral advertising.",
    "Based on information provided during setup, this product has not been declared to use personal data for cross-context behavioral advertising.",
    placeholders
  );

  const aiServices = triStateSentence(
    config?.sendsDataToAiServices,
    "whether user data is sent to third-party AI services as part of this product's own functionality",
    "User data may be sent to third-party AI services as part of this product's own functionality.",
    "User data is not sent to third-party AI services as part of this product's own functionality.",
    placeholders
  );

  return [
    "## Data Retention, Deletion, and Use",
    "",
    `Personal data is retained as follows: ${retention}`,
    `To delete your account or request deletion of your personal data: ${deletion}`,
    sellShare,
    advertising,
    "See the Third-Party Data Processors section above for the specific third-party integrations detected in this codebase; the declarations above describe this product's own stated practices and do not override what was actually detected there.",
    aiServices,
  ].join("\n");
}

function renderRightsSection(config: SrcLawyerConfig | null, placeholders: string[]): string {
  const euUk = config?.hasEuUkUsers;
  const california = config?.hasCaliforniaUsers;

  if (euUk === false && california === false) {
    return ["## Your Rights", "", "This product has not declared users in jurisdictions with additional statutory privacy rights (EU/UK, California)."].join(
      "\n"
    );
  }

  const lines = ["## Your Rights", ""];

  if (euUk === true) {
    lines.push(
      "If you are located in the EU or UK, you may have rights under the GDPR and/or UK GDPR, including the right to access, correct, delete, or restrict the use of your personal data."
    );
  } else if (euUk !== false) {
    lines.push(placeholderLine("whether this product has users in the EU/UK, which determines whether GDPR/UK GDPR disclosures apply", placeholders));
  }

  if (california === true) {
    lines.push(
      "If you are a California resident, you may have rights under the CCPA/CPRA, including the right to know, delete, correct, and opt out of the sale or sharing of your personal data."
    );
  } else if (california !== false) {
    lines.push(placeholderLine("whether this product has users in California, which determines whether CCPA/CPRA disclosures apply", placeholders));
  }

  return lines.join("\n");
}

function renderChildrensPrivacySection(config: SrcLawyerConfig | null, placeholders: string[]): string {
  const collects = config?.collectsChildrensData;
  const collectsLine = triStateSentence(
    collects,
    "whether this product knowingly collects personal data from children",
    "This product knowingly collects personal data from children under applicable age thresholds (e.g. under 13 in the US, under 16 in the EU where applicable).",
    "This product does not knowingly collect personal data from children under applicable age thresholds.",
    placeholders
  );

  const minimumAge = config?.minimumAge;
  const ageLine =
    minimumAge === null || minimumAge === undefined
      ? placeholderLine("minimum age required to use this product, if any", placeholders)
      : `Users must be at least ${minimumAge} years old to use this product.`;

  return ["## Children's Privacy", "", collectsLine, ageLine].join("\n");
}

function renderPlaceholderSummary(labels: string[]): string {
  const lines = ["## Placeholders — Complete Before Publishing", ""];
  for (const label of labels) {
    lines.push(`- ${placeholder(label)}`);
  }
  return lines.join("\n");
}

type FindingOutcome = "confident" | "resolved" | "declined" | "unresolved";

function outcomeOf(finding: Finding): FindingOutcome {
  if (!finding.requiresReview) return "confident";
  if (finding.llmResolution?.outcome === "resolved") return "resolved";
  if (finding.llmResolution?.outcome === "declined") return "declined";
  return "unresolved";
}

export function generatePolicyMarkdown(
  result: ScanResult,
  config: SrcLawyerConfig | null,
  llmError?: string | null,
  protectedLogicWarning?: string | null
): string {
  const confidentFindings = result.findings.filter((f) => {
    const outcome = outcomeOf(f);
    return outcome === "confident" || outcome === "resolved";
  });
  const declinedFindings = result.findings.filter((f) => outcomeOf(f) === "declined");
  const reviewFindings = result.findings.filter((f) => outcomeOf(f) === "unresolved");

  // Rendered first (before the final parts[] is assembled) so the shared placeholders array is fully
  // populated in time for the top-of-document summary below.
  const placeholders: string[] = [];
  const identitySection = renderIdentitySection(config, placeholders);
  const dataPracticesSection = renderDataPracticesSection(config, placeholders);
  const rightsSection = renderRightsSection(config, placeholders);
  const childrensPrivacySection = renderChildrensPrivacySection(config, placeholders);

  const parts: string[] = ["# Privacy Policy", ""];

  if (result.unsupportedStackWarning) {
    parts.push(renderUnsupportedStackWarning(result.unsupportedStackWarning), "");
  }

  if (protectedLogicWarning) {
    parts.push(renderProtectedLogicWarning(protectedLogicWarning), "");
  }

  if (llmError) {
    parts.push(renderLlmErrorWarning(llmError), "");
  }

  if (placeholders.length > 0) {
    parts.push(renderPlaceholderSummary([...new Set(placeholders)]), "");
  }

  parts.push(
    `_Generated by SrcLawyer from static analysis of this codebase (${result.filesScanned} file(s) scanned)._`,
    "",
    renderContextSection(config),
    "",
    identitySection,
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

  parts.push("", dataPracticesSection, "", rightsSection, "", childrensPrivacySection);

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

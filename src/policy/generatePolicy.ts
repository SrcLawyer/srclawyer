import type { DataCategory, Finding, ScanResult } from "../engine/types.js";
import { CONFIG_FILENAME, POLICY_TEXT_LIMITS, policyModeOf, type SrcLawyerConfig } from "../config/config.js";
import { DATA_CATEGORY_LABELS } from "./dataCategoryLabels.js";
import { MANDATORY_DISCLAIMER } from "./disclaimer.js";
import { PROCESSOR_PROFILES } from "../rules/processorProfiles.js";
import { SERVICE_FEATURES, featureKey, featuresFor, type ServiceFeature } from "../rules/serviceFeatures.js";
import { joinNames, lowerLabel } from "../assistant/labels.js";
import { SERVICE_SECTION } from "../assistant/wording.js";

function locationRef(finding: Finding): string {
  return `${finding.location.file}:${finding.location.line}`;
}

function effectiveCategories(finding: Finding): DataCategory[] {
  return finding.llmResolution?.resolvedDataCategories ?? finding.dataCategories;
}

function effectiveDescription(finding: Finding): string {
  return finding.llmResolution?.resolvedDescription ?? finding.description;
}

/** The processor-profile key an SDK finding came from (`sdk:<key>:<file>:<line>`), or null for any other finding. */
export function profileKeyOf(finding: Finding): string | null {
  return finding.source === "sdk-rule" ? (/^sdk:([^:]+):/.exec(finding.id)?.[1] ?? null) : null;
}

type FeatureState = "yes" | "no" | "open";

function featureState(config: SrcLawyerConfig | null, feature: ServiceFeature): FeatureState {
  const answer = config?.serviceUse?.[featureKey(feature)];
  return answer === true ? "yes" : answer === false ? "no" : "open";
}

/** The feature that qualifies `category` for the service this finding came from, if the category is conditional there. */
function conditionalFeatureFor(finding: Finding, category: DataCategory): ServiceFeature | null {
  const key = profileKeyOf(finding);
  return key ? (featuresFor(key).find((f) => f.categories.includes(category)) ?? null) : null;
}

function groupByCategory(findings: Finding[], config: SrcLawyerConfig | null): Map<DataCategory, Finding[]> {
  const byCategory = new Map<DataCategory, Finding[]>();
  for (const finding of findings) {
    for (const category of effectiveCategories(finding)) {
      // A data kind a service handles only through an optional feature is not listed as collected until
      // the owner says they use the feature; until then it appears under the "may be collected" section.
      const feature = finding.llmResolution?.resolvedDataCategories ? null : conditionalFeatureFor(finding, category);
      if (feature && featureState(config, feature) !== "yes") continue;
      const existing = byCategory.get(category) ?? [];
      existing.push(finding);
      byCategory.set(category, existing);
    }
  }
  return byCategory;
}

function renderCategorySections(confidentFindings: Finding[], showLocations: boolean, config: SrcLawyerConfig | null): string[] {
  const byCategory = groupByCategory(confidentFindings, config);
  const sections: string[] = [];

  for (const [category, findings] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const lines = [`### ${DATA_CATEGORY_LABELS[category]}`, ""];
    for (const finding of findings) {
      const attribution = finding.processor ? ` (via ${finding.processor})` : "";
      const aiNote = finding.llmResolution?.outcome === "resolved" ? " _(AI-assisted)_" : "";
      lines.push(`- ${effectiveDescription(finding)}${attribution}${aiNote}${showLocations ? ` — \`${locationRef(finding)}\`` : ""}`);
    }
    sections.push(lines.join("\n"));
  }

  return sections;
}

/**
 * "May Be Collected Through Services You Use": the data kinds a service handles only through an optional
 * feature, for each feature the owner has not yet said they use or do not use. A feature answered yes is
 * listed as collected in the main section instead; one answered no is left out. FOR ATTORNEY REVIEW:
 * docs/question-catalog.md section 10.
 */
function renderServiceFeatureSection(confidentFindings: Finding[], config: SrcLawyerConfig | null): string | null {
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const finding of confidentFindings) {
    const key = profileKeyOf(finding);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const name = PROCESSOR_PROFILES[key]?.name ?? finding.processor ?? key;
    for (const feature of SERVICE_FEATURES.filter((f) => f.profileKey === key)) {
      if (featureState(config, feature) !== "open") continue;
      bullets.push(`- **${name}** (${feature.feature}): ${joinNames(feature.categories.map(lowerLabel))}.`);
    }
  }
  if (bullets.length === 0) return null;
  return [SERVICE_SECTION.heading, "", SERVICE_SECTION.intro, "", ...bullets].join("\n");
}

function renderProcessorSection(confidentFindings: Finding[], showLocations: boolean): string | null {
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
    lines.push(`- **${name}** — ${description}${showLocations ? ` (\`${locations.join("`, `")}\`)` : ""}`);
  }
  return lines.join("\n");
}

function renderReviewSection(reviewFindings: Finding[], showLocations: boolean): string | null {
  if (reviewFindings.length === 0) return null;

  const lines = [
    "## Items Requiring Manual Review",
    "",
    "Automated analysis could not confidently classify the following items. They are **not** included in the sections above and must be reviewed manually before this policy is considered complete:",
    "",
  ];
  for (const finding of reviewFindings) {
    const attemptNote = finding.llmResolution?.reason ? ` (AI resolution attempt failed: ${finding.llmResolution.reason})` : "";
    lines.push(showLocations ? `- \`${finding.evidence}\` — ${finding.description} — \`${locationRef(finding)}\`${attemptNote}` : `- ${finding.description}`);
  }
  return lines.join("\n");
}

function renderDeclinedSection(declinedFindings: Finding[], showLocations: boolean): string | null {
  if (declinedFindings.length === 0) return null;

  const lines = [
    "## Items Declined by AI-Assisted Review",
    "",
    "These items were reviewed by the AI-assisted resolution layer, which explicitly declined to classify them rather than guess. They are **not** included in the sections above and must be reviewed manually:",
    "",
  ];
  for (const finding of declinedFindings) {
    lines.push(showLocations ? `- \`${finding.evidence}\` — ${finding.description} — declined: "${finding.llmResolution?.reason}" — \`${locationRef(finding)}\`` : `- ${finding.description}`);
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

// The titles of the banners that mean the scan did not see everything. `status` treats a policy that
// still carries one as not publishable (docs/question-catalog.md section 0).
export const INCOMPLETE_SCAN_BANNER_TITLES = [
  "INCOMPLETE SCAN — DO NOT PUBLISH WITHOUT MANUAL REVIEW",
  "PROTECTED-LOGIC SERVICE UNAVAILABLE — POLICY MAY BE INCOMPLETE",
  "WORKSPACE CONFIGURATION REJECTED — SCAN MAY BE INCOMPLETE",
  "FILES SKIPPED OR NOT ANALYZED — SCAN INCOMPLETE",
] as const;

function renderUnsupportedStackWarning(warning: string): string {
  return [`> **WARNING: ${INCOMPLETE_SCAN_BANNER_TITLES[0]}**`, ">", `> ${warning}`].join("\n");
}

// Mirrors renderUnsupportedStackWarning's own reasoning exactly: this policy FILE gets committed and
// shared on its own, without the CLI output that already shows this warning -- a reader of the file
// alone has no other way to know confidence grading or Zod-schema detection didn't run for this scan.
function renderProtectedLogicWarning(warning: string): string {
  return [`> **WARNING: ${INCOMPLETE_SCAN_BANNER_TITLES[1]}**`, ">", `> ${warning}`].join("\n");
}

// Same reasoning as the other warning banners: the policy file is committed and shared without the
// console output, and a rejected workspace config means packages outside the default locations were
// never scanned.
function renderWorkspaceWarning(warning: string): string {
  return [`> **WARNING: ${INCOMPLETE_SCAN_BANNER_TITLES[2]}**`, ">", `> ${warning}`].join("\n");
}

// Same reasoning as the other banners: files skipped for size mean findings in them are missing from
// a policy file that will be committed and shared without the console output.
function renderSkippedFilesWarning(warning: string): string {
  return [`> **WARNING: ${INCOMPLETE_SCAN_BANNER_TITLES[3]}**`, ">", `> ${warning}`].join("\n");
}

/** Rendered when the owner chose "No minimum" (stored as minimumAge: 0). Wording: docs/question-catalog.md section 2. */
export const NO_MINIMUM_AGE_SENTENCE = "This product does not set a minimum age for users.";

/** First line of a policy generated in `policyMode: generated` (catalog section 6.1). */
export const GENERATED_HEADER_COMMENT =
  "<!-- Generated by SrcLawyer from your code and .srclawyer.config.yml. Change your answers there (or ask your assistant), not in this file. -->";

/** Footer of a policy generated in `policyMode: generated`: no file count (catalog section 6.2). */
export const GENERATED_FOOTER = "_Generated by SrcLawyer from static analysis of this codebase._";

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

// Avoids a double terminal punctuation mark when a user-supplied value already ends with one --
// e.g. a company name ending in "." ("Acme Inc.") or a URL ending in "/" (where appending "." right
// after the slash reads as part of the path). The placeholder marker itself ends with "]", so this
// never double-punctuates that either.
function endSentence(prefix: string, value: string): string {
  const trimmed = value.trim();
  return /[.!?/\]]$/.test(trimmed) ? `${prefix}${trimmed}` : `${prefix}${trimmed}.`;
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
    endSentence("This policy is issued by ", companyName),
    endSentence("It applies to the product or service available at ", siteUrl),
    endSentence("Questions about this policy or requests regarding your personal data can be sent to ", privacyContactEmail),
  ].join("\n");
}

// The sell/share and advertising sentences are the highest-risk new text in this document: the policy
// can simultaneously list detected third-party integrations (e.g. Stripe) in the Third-Party Data
// Processors section above. These sentences deliberately (1) use CCPA/CPRA's own defined terms rather
// than casual language, (2) frame the statement as the user's own self-declared setup answer, not a
// legal conclusion drawn by this tool, and (3) close with a cross-reference back to the
// detected-processors section, in all three states (true/false/placeholder), so the two sections are
// never read in isolation from each other -- EXCEPT that the cross-reference only names that section
// when it actually exists in this document (hasProcessorSection); otherwise it would point at a
// heading that was never rendered, whether because nothing was detected or because detection itself
// was incomplete (unsupported stack). See docs/legal-wording-review.md -- this is drafted,
// attorney-reviewable starting wording, not settled language.
function renderDataPracticesSection(config: SrcLawyerConfig | null, placeholders: string[], hasProcessorSection: boolean): string {
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

  const processorsCrossReference = hasProcessorSection
    ? "See the Third-Party Data Processors section above for the specific third-party integrations detected in this codebase; the declarations above describe this product's own stated practices and do not override what was actually detected there."
    : "This document does not include a Third-Party Data Processors section (none were detected, or detection may have been incomplete -- see any warning above); the declarations above describe this product's own stated practices only and do not override any third-party integrations this codebase may actually use.";

  return [
    "## Data Retention, Deletion, and Use",
    "",
    `Personal data is retained as follows: ${retention}`,
    `To delete your account or request deletion of your personal data: ${deletion}`,
    sellShare,
    advertising,
    processorsCrossReference,
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
      : minimumAge === 0
        ? NO_MINIMUM_AGE_SENTENCE
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

export interface GenerateOptions {
  /** Defaults to the config's policyMode. "generated" omits code locations and source lines and adds the owner's policyText. */
  mode?: "generated" | "handwritten";
}

/** Owner-written text, capped, with any line that imitates SrcLawyer's end-of-file marker removed. */
export function sanitizeOwnerText(text: string | null | undefined, max: number): string | null {
  if (typeof text !== "string") return null;
  const cleaned = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !line.includes("srclawyer:policy-sha256"))
    .join("\n")
    .trim()
    .slice(0, max);
  return cleaned === "" ? null : cleaned;
}

export function generatePolicyMarkdown(
  result: ScanResult,
  config: SrcLawyerConfig | null,
  llmError?: string | null,
  protectedLogicWarning?: string | null,
  options: GenerateOptions = {}
): string {
  const generated = (options.mode ?? policyModeOf(config)) === "generated";
  const showLocations = !generated;
  const confidentFindings = result.findings.filter((f) => {
    const outcome = outcomeOf(f);
    return outcome === "confident" || outcome === "resolved";
  });
  const declinedFindings = result.findings.filter((f) => outcomeOf(f) === "declined");
  const reviewFindings = result.findings.filter((f) => outcomeOf(f) === "unresolved");

  // Computed first so renderDataPracticesSection knows whether the Third-Party Data Processors
  // section (rendered later, below) actually exists in this document before it cross-references it.
  const processorSection = renderProcessorSection(confidentFindings, showLocations);

  // Rendered next (before the final parts[] is assembled) so the shared placeholders array is fully
  // populated in time for the top-of-document summary below.
  const placeholders: string[] = [];
  const identitySection = renderIdentitySection(config, placeholders);
  const dataPracticesSection = renderDataPracticesSection(config, placeholders, processorSection !== null);
  const rightsSection = renderRightsSection(config, placeholders);
  const childrensPrivacySection = renderChildrensPrivacySection(config, placeholders);

  const parts: string[] = generated ? [GENERATED_HEADER_COMMENT, "", "# Privacy Policy", ""] : ["# Privacy Policy", ""];
  if (generated) {
    const lastUpdated = sanitizeOwnerText(config?.policyText?.lastUpdated, POLICY_TEXT_LIMITS.lastUpdated);
    if (lastUpdated) parts.push(`Last updated: ${lastUpdated}`, "");
    const intro = sanitizeOwnerText(config?.policyText?.intro, POLICY_TEXT_LIMITS.intro);
    if (intro) parts.push(intro, "");
  }

  if (result.unsupportedStackWarning) {
    parts.push(renderUnsupportedStackWarning(result.unsupportedStackWarning), "");
  }

  if (result.workspaceWarning) {
    parts.push(renderWorkspaceWarning(result.workspaceWarning), "");
  }

  if (result.skippedFilesWarning) {
    parts.push(renderSkippedFilesWarning(result.skippedFilesWarning), "");
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
    generated ? GENERATED_FOOTER : `_Generated by SrcLawyer from static analysis of this codebase (${result.filesScanned} file(s) scanned)._`,
    "",
    renderContextSection(config),
    "",
    identitySection,
    "",
    "## Data We Collect",
    ""
  );

  const categorySections = renderCategorySections(confidentFindings, showLocations, config);
  const serviceSection = renderServiceFeatureSection(confidentFindings, config);
  if (categorySections.length > 0) {
    parts.push(categorySections.join("\n\n"));
  } else if (result.unsupportedStackWarning) {
    parts.push("**Not analyzed:** this codebase's primary language/framework isn't supported yet (see the warning above). This is not a clean-scan result — nothing below should be read as \"no data collection found.\"");
  } else if (serviceSection === null) {
    parts.push("No data-collection patterns were confidently identified in this codebase.");
  }

  if (serviceSection) {
    parts.push("", serviceSection);
  }

  if (processorSection) {
    parts.push("", processorSection);
  }

  parts.push("", dataPracticesSection, "", rightsSection, "", childrensPrivacySection);

  const declinedSection = renderDeclinedSection(declinedFindings, showLocations);
  if (declinedSection) {
    parts.push("", declinedSection);
  }

  const reviewSection = renderReviewSection(reviewFindings, showLocations);
  if (reviewSection) {
    parts.push("", reviewSection);
  }

  if (generated) {
    for (const section of (config?.policyText?.additionalSections ?? []).slice(0, POLICY_TEXT_LIMITS.sections)) {
      const heading = sanitizeOwnerText(section?.heading, POLICY_TEXT_LIMITS.heading)?.replace(/\n/g, " ");
      const body = sanitizeOwnerText(section?.body, POLICY_TEXT_LIMITS.body);
      if (heading && body) parts.push("", `## ${heading}`, "", body);
    }
    const closing = sanitizeOwnerText(config?.policyText?.closing, POLICY_TEXT_LIMITS.closing);
    if (closing) parts.push("", closing);
  }

  parts.push("", "## Disclaimer", "", MANDATORY_DISCLAIMER);

  return parts.join("\n") + "\n";
}

/**
 * The blank labels in a generated policy, read from its "Placeholders — Complete Before Publishing"
 * summary (one bullet per unique blank). Empty when every field was answered.
 */
export function extractPlaceholders(markdown: string): string[] {
  const start = markdown.indexOf("## Placeholders — Complete Before Publishing");
  if (start === -1) return [];
  const rest = markdown.slice(start).split("\n").slice(2);
  const labels: string[] = [];
  for (const line of rest) {
    const match = /^- \[TO COMPLETE: (.*)\]$/.exec(line);
    if (!match) break;
    labels.push(match[1]!);
  }
  return labels;
}

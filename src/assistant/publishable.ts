import { INCOMPLETE_SCAN_BANNER_TITLES } from "../policy/generatePolicy.js";
import { extractPlaceholders } from "../policy/generatePolicy.js";
import { PUBLISHABLE, SUMMARY } from "./wording.js";

export interface Publishability {
  publishable: boolean;
  /** Reasons the policy cannot be marked ready to publish. */
  publishableBlockers: Array<{ code: "no-policy" | "blank" | "scan-incomplete"; count: number; message: string }>;
  /** Things to read before publishing that do not block. */
  publishableWarnings: Array<{ code: "manual-review"; count: number; message: string }>;
}

const REVIEW_SECTIONS = ["## Items Requiring Manual Review", "## Items Declined by AI-Assisted Review"];

/** Bullets under the two "needs a human" sections of a generated policy. */
export function countManualReviewItems(markdown: string): number {
  const lines = markdown.split("\n");
  let count = 0;
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith("## ")) inSection = REVIEW_SECTIONS.includes(line.trim());
    else if (inSection && line.startsWith("- ")) count += 1;
  }
  return count;
}

/**
 * Whether the policy text can be marked ready to publish (docs/question-catalog.md section 0): no blank
 * `[TO COMPLETE]`, and none of the four "scan incomplete" banners. Items needing manual review are a
 * non-blocking warning.
 */
export function assessPublishable(policyText: string | null): Publishability {
  if (policyText === null) {
    return { publishable: false, publishableBlockers: [{ code: "no-policy", count: 1, message: PUBLISHABLE.noPolicy }], publishableWarnings: [] };
  }
  const blockers: Publishability["publishableBlockers"] = [];
  const blanks = extractPlaceholders(policyText).length;
  if (blanks > 0) {
    blockers.push({ code: "blank", count: blanks, message: (blanks === 1 ? SUMMARY.blanksOne : SUMMARY.blanksMany).replace("{n}", String(blanks)) });
  }
  const banners = INCOMPLETE_SCAN_BANNER_TITLES.filter((title) => policyText.includes(`**WARNING: ${title}**`)).length;
  if (banners > 0) blockers.push({ code: "scan-incomplete", count: banners, message: PUBLISHABLE.scanIncomplete });

  const warnings: Publishability["publishableWarnings"] = [];
  const review = countManualReviewItems(policyText);
  if (review > 0) {
    warnings.push({ code: "manual-review", count: review, message: (review === 1 ? PUBLISHABLE.manualReviewOne : PUBLISHABLE.manualReviewMany).replace("{n}", String(review)) });
  }
  return { publishable: blockers.length === 0, publishableBlockers: blockers, publishableWarnings: warnings };
}

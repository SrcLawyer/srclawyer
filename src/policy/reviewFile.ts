import { FIRST_REVIEW, REVIEW, SUMMARY } from "../assistant/wording.js";
import { SENSITIVE_CATEGORIES, categoryLabel, lowerLabel } from "../assistant/labels.js";
import { PROCESSOR_PROFILES } from "../rules/processorProfiles.js";
import type { InventoryDiff } from "../inventory/inventory.js";
import type { TriggeredQuestion } from "../assistant/questions.js";

export interface ReviewQuestion extends TriggeredQuestion {
  /** "not answered", "yes", "no" or "answered". */
  currentAnswer: string;
}

export interface ReviewInput {
  coverage: string;
  diff: InventoryDiff;
  questions: ReviewQuestion[];
  /** The first review of a baseline nobody has approved: everything found is listed as found, not as new. */
  firstReview?: boolean;
}

function disclosureFor(processorName: string): string | null {
  return Object.values(PROCESSOR_PROFILES).find((p) => p.name === processorName)?.disclosureNotes ?? null;
}

/**
 * PRIVACY_POLICY.review.md (docs/question-catalog.md section 3.3): what changed, suggested wording,
 * what to check, and the questions to answer. Only category labels, vendor names, vendor disclosure text
 * and the catalog's fixed sentences appear; never a path, a source line or a date.
 */
export function renderReviewFile(input: ReviewInput): string {
  const { diff } = input;
  const first = input.firstReview === true;
  const out: string[] = [REVIEW.title, "", REVIEW.intro, "", input.coverage, "", first ? FIRST_REVIEW.heading : REVIEW.changedHeading, ""];
  if (first) {
    out.push(FIRST_REVIEW.intro, "");
    if (diff.added.categories.length === 0 && diff.added.processors.length === 0) out.push(FIRST_REVIEW.nothingFound, "");
  }

  if (diff.added.categories.length > 0) {
    out.push(first ? FIRST_REVIEW.dataHeading : REVIEW.newData, ...diff.added.categories.map((c) => `- ${categoryLabel(c)}`), "");
  }
  if (diff.added.processors.length > 0) {
    out.push(first ? FIRST_REVIEW.servicesHeading : REVIEW.newServices, ...diff.added.processors.map((n) => `- ${n}`), "");
  }
  const removed = [...diff.removed.categories.map(categoryLabel), ...diff.removed.processors];
  if (removed.length > 0) {
    out.push(REVIEW.noLonger, ...removed.map((r) => `- ${r}`), "");
  }

  const suggestions: string[] = [];
  for (const name of diff.added.processors) {
    const text = disclosureFor(name);
    if (text) suggestions.push(`- **${name}** — ${text}`);
  }
  for (const category of diff.added.categories) {
    suggestions.push(
      SENSITIVE_CATEGORIES.has(category)
        ? REVIEW.suggestedSensitive.replace("{Label}", categoryLabel(category))
        : REVIEW.suggestedData.replace("{label in lower case}", lowerLabel(category))
    );
  }
  if (suggestions.length > 0) out.push(REVIEW.suggestedHeading, "", REVIEW.suggestedIntro, "", ...suggestions, "");

  if (removed.length > 0) {
    out.push(REVIEW.checkHeading, "", ...removed.map((r) => REVIEW.checkItem.replace("{Label or Name}", r)), "");
  }

  if (input.questions.length > 0) {
    out.push(REVIEW.questionsHeading, "");
    input.questions.forEach((q, i) => {
      out.push(`${i + 1}. ${q.def.ask}`, `   Why: ${q.why}`, `   Current answer: ${q.currentAnswer}`, "");
    });
  }

  out.push(REVIEW.doneHeading, "", REVIEW.done, "");
  return out.join("\n");
}

export interface SummaryInput {
  diff: InventoryDiff;
  firstReview?: boolean;
  questionCount: number;
  blankCount: number;
}

/** Plain-English "what changed" lines (docs/question-catalog.md section 3.2). */
export function buildSummary(input: SummaryInput): string[] {
  const { diff } = input;
  const lines: string[] = [];
  if (input.firstReview) {
    lines.push(FIRST_REVIEW.summaryIntro);
    if (diff.added.categories.length === 0 && diff.added.processors.length === 0) lines.push(FIRST_REVIEW.nothingFound);
    for (const name of diff.added.processors) lines.push(FIRST_REVIEW.uses.replace("{Name}", name));
    for (const category of diff.added.categories) {
      lines.push(category === "childrens_data" ? FIRST_REVIEW.handlesChildren : FIRST_REVIEW.handles.replace("{label in lower case}", lowerLabel(category)));
    }
  } else {
    for (const name of diff.added.processors) lines.push(SUMMARY.added.replace("{Name}", name));
    for (const category of diff.added.categories) {
      lines.push(category === "childrens_data" ? SUMMARY.addedChildren : SUMMARY.addedData.replace("{label in lower case}", lowerLabel(category)));
    }
  }
  for (const name of diff.removed.processors) lines.push(SUMMARY.removed.replace("{Name}", name));
  for (const category of diff.removed.categories) lines.push(SUMMARY.removedData.replace("{label in lower case}", lowerLabel(category)));
  if (input.questionCount > 0) {
    lines.push((input.questionCount === 1 ? SUMMARY.questionsOne : SUMMARY.questionsMany).replace("{n}", String(input.questionCount)));
  }
  if (input.blankCount > 0) {
    lines.push((input.blankCount === 1 ? SUMMARY.blanksOne : SUMMARY.blanksMany).replace("{n}", String(input.blankCount)));
  }
  lines.push(SUMMARY.nothingPublished);
  return lines;
}

// What the GitHub Action (action/run.mjs) imports from the installed CLI, so that the names, labels and
// sentences in a pull-request comment or issue come from the same tables as everything else and are never
// copied into the Action. See docs/question-catalog.md section 7.
import { createHash } from "node:crypto";
import { joinNames, lowerLabel } from "../assistant/labels.js";
import { ACTION, FIRST_REVIEW, NO_DRIFT_STATEMENT, SUMMARY } from "../assistant/wording.js";
import { parseInventory, type InventoryDiff } from "../inventory/inventory.js";
import { UNRECOGNIZED_DATA, UNRECOGNIZED_SERVICE, buildChangeLines, isKnownCategory, isKnownProcessor } from "../policy/reviewFile.js";

export { buildChangeLines };

/** What a pull request changes in the baseline file, as the lists case C of the catalog prints. All empty: the lists are unchanged. */
export interface BaselineChange {
  servicesAdded: string;
  dataAdded: string;
  servicesRemoved: string;
  dataRemoved: string;
}

const namesFor = (values: string[], known: (v: string) => boolean, show: (v: string) => string, unrecognized: string): string => {
  const shown = values.filter(known).map(show);
  if (values.some((v) => !known(v))) shown.push(unrecognized);
  return joinNames(shown);
};

/**
 * Compares the baseline on the branch the pull request targets with the one in the pull request. The
 * result contains only names and labels from SrcLawyer's own tables (anything else is shown as
 * "a service/kind of data this version of SrcLawyer doesn't recognize") and never the approval note.
 * Returns null when either file cannot be read as a baseline.
 */
export function describeBaselineChange(before: string, after: string): BaselineChange | null {
  const a = parseInventory(before);
  const b = parseInventory(after);
  if (!a.ok || !b.ok) return null;
  const minus = (from: string[], other: string[]): string[] => from.filter((v) => !other.includes(v));
  return {
    servicesAdded: namesFor(minus(b.inventory.processors, a.inventory.processors), isKnownProcessor, (v) => v, UNRECOGNIZED_SERVICE),
    dataAdded: namesFor(minus(b.inventory.categories, a.inventory.categories), isKnownCategory, lowerLabel, UNRECOGNIZED_DATA),
    servicesRemoved: namesFor(minus(a.inventory.processors, b.inventory.processors), isKnownProcessor, (v) => v, UNRECOGNIZED_SERVICE),
    dataRemoved: namesFor(minus(a.inventory.categories, b.inventory.categories), isKnownCategory, lowerLabel, UNRECOGNIZED_DATA),
  };
}

/** A diff built from a baseline's lists, for the "first review" lines (everything found, as if added). */
export function foundDiff(categories: string[], processors: string[]): InventoryDiff {
  return { added: { categories, processors }, removed: { categories: [], processors: [] } };
}

/**
 * The first-review lines (catalog section 9.7) for a baseline that nobody has approved: what the scanner
 * found, taken from the baseline itself because on a first review it matches the code. Null if unreadable.
 */
export function firstReviewLines(baselineText: string): { lines: string[]; items: string[] } | null {
  const parsed = parseInventory(baselineText);
  if (!parsed.ok) return null;
  const { categories, processors } = parsed.inventory;
  return {
    lines: buildChangeLines(foundDiff(categories, processors), true, { bold: true, onlyKnown: true }),
    items: [...processors.map((p) => `processor:${p}`), ...categories.map((c) => `category:${c}`)],
  };
}

// ---------------------------------------------------------------------------------------------------
// Renderers for the Action's review mode. Pure functions of a view model; action/run.mjs gathers the
// facts and does the GitHub calls. Wording is ACTION in assistant/wording.ts (catalog section 7).
// ---------------------------------------------------------------------------------------------------
export { ACTION };

export const COMMENT_MARKER = "<!-- srclawyer-drift-check -->";
export const fingerprintMarker = (hash: string): string => `<!-- srclawyer-fingerprint:${hash} -->`;
export const FINGERPRINT_PATTERN = /<!-- srclawyer-fingerprint:([0-9a-f]{12}) -->/;
/** Questions shown before the rest are folded into a collapsed block. */
export const QUESTIONS_SHOWN = 5;

export interface QuestionView {
  ask: string;
  sensitive: boolean;
}

export type ReviewView =
  | { kind: "drift"; changes: string[]; questions: QuestionView[]; baselineChanged: boolean }
  | { kind: "first-review"; lines: string[]; questions: QuestionView[] }
  | { kind: "baseline-changed"; change: BaselineChange }
  | { kind: "no-drift" }
  | { kind: "inconclusive"; reasons: string[] }
  | { kind: "error"; message: string };

export interface RenderContext {
  /** What follows `npx`: `srclawyer@0.10.0`, or `github:SrcLawyer/srclawyer#<sha>` for a commit pin. */
  target: string;
  /** The coverage line from the scan, or null. */
  coverage: string | null;
  /** Link to the workflow run, or null. */
  runLink: string | null;
}

const withTarget = (text: string, ctx: RenderContext): string => text.replaceAll("srclawyer@{version}", ctx.target);

function questionsBlock(questions: QuestionView[]): string[] {
  if (questions.length === 0) return [];
  const ordered = [...questions.filter((q) => q.sensitive), ...questions.filter((q) => !q.sensitive)];
  const n = ordered.length;
  const out = [(n === 1 ? SUMMARY.questionsOne : SUMMARY.questionsMany).replace("{n}", String(n))];
  out.push(...ordered.slice(0, QUESTIONS_SHOWN).map((q) => `- ${q.ask}`));
  const rest = ordered.slice(QUESTIONS_SHOWN);
  if (rest.length > 0) {
    out.push("", `<details><summary>${(rest.length === 1 ? ACTION.moreOne : ACTION.moreMany).replace("{k}", String(rest.length))}</summary>`, "", ...rest.map((q) => `- ${q.ask}`), "</details>");
  }
  return out;
}

function assistantBlock(hasQuestions: boolean, ctx: RenderContext): string[] {
  return [
    ACTION.assistantHeading,
    ACTION.assistantIntro,
    "",
    ACTION.assistantPrompt,
    "",
    hasQuestions ? ACTION.withQuestions : ACTION.withoutQuestions,
    "",
    `<details><summary>${ACTION.setupSummary}</summary>`,
    "",
    withTarget(ACTION.setupText, ctx),
    "</details>",
    "",
    `<details><summary>${ACTION.handSummary}</summary>`,
    "",
    withTarget(ACTION.handText, ctx),
    "</details>",
  ];
}

function footerBlock(ctx: RenderContext): string[] {
  return [...(ctx.coverage ? [ctx.coverage, ""] : []), ACTION.notLegalAdvice];
}

const joinBlocks = (blocks: string[][]): string => blocks.filter((b) => b.length > 0).map((b) => b.join("\n")).join("\n\n");

function baselineLists(change: BaselineChange): string[] {
  const lines = [
    change.servicesAdded && ACTION.servicesNow.replace("{names}", change.servicesAdded),
    change.dataAdded && ACTION.dataNow.replace("{labels in lower case}", change.dataAdded),
    change.servicesRemoved && ACTION.servicesNo.replace("{names}", change.servicesRemoved),
    change.dataRemoved && ACTION.dataNo.replace("{labels in lower case}", change.dataRemoved),
  ].filter((l): l is string => Boolean(l));
  return lines.length > 0 ? lines.map((l) => `- ${l}`) : [ACTION.listsUnchanged];
}

/**
 * The visible text of a comment, an issue or the run summary (no hidden marker lines). `issue` adds the
 * run link and, for "no new items", the close-it sentence (catalog 7.4); the pull-request comment has neither.
 */
function visibleBody(view: ReviewView, ctx: RenderContext, issue: boolean): string {
  const found = ctx.runLink ? [ACTION.foundBy.replace("{run link}", ctx.runLink)] : [];
  switch (view.kind) {
    case "drift":
      return joinBlocks([
        [ACTION.headingLook],
        view.changes.map((l) => `- ${l}`),
        [ACTION.differs],
        view.baselineChanged ? [ACTION.noticeAbove] : [],
        questionsBlock(view.questions),
        assistantBlock(view.questions.length > 0, ctx),
        issue ? found : [],
        footerBlock(ctx),
      ]);
    case "first-review":
      return joinBlocks([
        [ACTION.headingFirst],
        [FIRST_REVIEW.summaryIntro],
        view.lines.map((l) => `- ${l}`),
        questionsBlock(view.questions),
        assistantBlock(view.questions.length > 0, ctx),
        issue ? found : [],
        footerBlock(ctx),
      ]);
    case "baseline-changed":
      return joinBlocks([[ACTION.headingBaseline], [ACTION.noticeBelow], baselineLists(view.change), [NO_DRIFT_STATEMENT], footerBlock(ctx)]);
    case "no-drift":
      return joinBlocks([[ACTION.headingNoNew], [NO_DRIFT_STATEMENT], issue ? [ACTION.closeIssue] : [], issue ? found : [], footerBlock(ctx)]);
    case "inconclusive":
      return joinBlocks([[ACTION.headingCouldnt], [ACTION.couldntFinish], view.reasons.map((r) => `- ${r}`), footerBlock(ctx)]);
    case "error":
      return joinBlocks([["## SrcLawyer drift check: error"], [view.message]]);
  }
}

/** The pull-request comment, or null when this case posts none. */
export function renderComment(view: ReviewView, ctx: RenderContext): string | null {
  if (view.kind !== "drift" && view.kind !== "baseline-changed" && view.kind !== "no-drift") return null;
  return `${COMMENT_MARKER}\n${visibleBody(view, ctx, false)}\n`;
}

/** The issue body, or null when this case writes none. */
export function renderIssue(view: ReviewView, ctx: RenderContext, fingerprint: string): string | null {
  if (view.kind === "drift" || view.kind === "first-review") {
    return `${COMMENT_MARKER}\n${fingerprintMarker(fingerprint)}\n${visibleBody(view, ctx, true)}\n`;
  }
  if (view.kind === "no-drift") return `${COMMENT_MARKER}\n${visibleBody(view, ctx, true)}\n`;
  return null;
}

export interface SummaryOptions {
  /** True on a default-branch run, whose text is the issue's. */
  issueText: boolean;
  /** Files were written for the artifact. */
  artifacts: boolean;
  fork: boolean;
}

/** The run summary: the same visible text, then the artifact sentence; for a fork's pull request, the fork sentence first. */
export function renderRunSummary(view: ReviewView, ctx: RenderContext, options: SummaryOptions): string {
  const body = visibleBody(view, ctx, options.issueText);
  const parts = [options.fork ? ACTION.fork : null, body, options.artifacts && view.kind !== "inconclusive" && view.kind !== "error" ? ACTION.artifacts : null];
  return parts.filter((p): p is string => p !== null).join("\n\n") + "\n";
}

/** A short identifier of one set of added and removed items, so a closed issue is not reopened for the same items. */
export function fingerprintOf(items: string[]): string {
  return createHash("sha256").update([...items].sort().join("\n")).digest("hex").slice(0, 12);
}

/** The added and removed items of a diff, as stable strings for the fingerprint. */
export function diffItems(diff: InventoryDiff): string[] {
  return [
    ...diff.added.processors.map((p) => `+processor:${p}`),
    ...diff.added.categories.map((c) => `+category:${c}`),
    ...diff.removed.processors.map((p) => `-processor:${p}`),
    ...diff.removed.categories.map((c) => `-category:${c}`),
  ];
}

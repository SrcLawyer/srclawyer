import { statSync } from "node:fs";

/**
 * One cap for every scanned file type (code, Python, HTML, OpenAPI/GraphQL). The largest real file in
 * the golden corpus is a 408KB OpenAPI spec, so 2 MiB leaves ~5x headroom while still bounding the
 * parse/regex/memory cost a single hostile file can impose. Files over it are skipped WITH a warning
 * (see summarizeSkippedFiles), never silently.
 */
export const MAX_SCANNED_FILE_BYTES = 2 * 1024 * 1024;

export type SkipReason =
  | "oversized"
  | "inline-scripts-truncated"
  | "symlink-outside-root"
  | "unreadable"
  | "parse-failed"
  | "analysis-failed"
  | "template-syntax";

export interface SkippedFile {
  file: string;
  reason: SkipReason;
  /** For "template-syntax" only: how many inline scripts in the file were not analyzed. */
  scripts?: number;
}

/**
 * Informational reasons: the content was deliberately not analyzed because it isn't JavaScript yet
 * (an inline script still carrying Jinja/ERB/Handlebars delimiters), which is expected for template
 * files rather than a sign the scan is incomplete. They are listed in --json and noted in one line,
 * but get no policy banner and no non-zero exit code. Every other reason is a real gap.
 */
export function isInformationalSkip(reason: SkipReason): boolean {
  return reason === "template-syntax";
}

// Content a template engine fills in before the browser ever sees it: Jinja/Django/Twig/Liquid
// ({{ }}, {% %}, {# #}) and ERB/EJS (<% %>).
const TEMPLATE_DELIMITERS = /\{\{|\{%|<%|\{#/;

export function containsTemplateSyntax(code: string): boolean {
  return TEMPLATE_DELIMITERS.test(code);
}

/** One informational line, or null when no template-syntax scripts were skipped. */
export function summarizeTemplateScripts(skipped: SkippedFile[]): string | null {
  const total = skipped.filter((s) => s.reason === "template-syntax").reduce((n, s) => n + (s.scripts ?? 0), 0);
  if (total === 0) return null;
  const subject = total === 1 ? "1 inline script in template files was" : `${total} inline scripts in template files were`;
  return `${subject} not analyzed (listed in --json output).`;
}

const REASON_LABELS: Record<SkipReason, string> = {
  oversized: "over the size cap",
  "inline-scripts-truncated": "too many inline scripts to analyze",
  "symlink-outside-root": "symlink(s) resolving outside the scanned root, not followed",
  unreadable: "unreadable",
  "parse-failed": "failed to parse",
  "analysis-failed": "aborted during analysis",
  "template-syntax": "inline scripts with template syntax",
};

/** False for files that can't be stat'ed -- the existing read-failure handling covers those. */
export function isOversizedFile(path: string, maxBytes: number = MAX_SCANNED_FILE_BYTES): boolean {
  try {
    return statSync(path).size > maxBytes;
  } catch {
    return false;
  }
}

const PREVIEW_COUNT = 3;

/** A single summarized line -- a few names, the rest only in ScanResult.skippedFiles (--json). Names
 *  are in-repo paths only; a blocked symlink's target is never recorded or printed. */
export function summarizeSkippedFiles(allSkipped: SkippedFile[]): string | null {
  const skipped = allSkipped.filter((s) => !isInformationalSkip(s.reason));
  if (skipped.length === 0) return null;
  const names = [...new Set(skipped.map((s) => s.file))];
  const preview = names.slice(0, PREVIEW_COUNT).join(", ");
  const remaining = names.length - PREVIEW_COUNT;
  const suffix = remaining > 0 ? `, and ${remaining} more (full list in --json output)` : "";

  const counts = new Map<SkipReason, Set<string>>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? new Set()).add(s.file));
  const breakdown = (Object.keys(REASON_LABELS) as SkipReason[])
    .filter((reason) => counts.has(reason))
    .map((reason) => `${counts.get(reason)!.size} ${REASON_LABELS[reason]}`)
    .join("; ");
  const limit = `${MAX_SCANNED_FILE_BYTES / (1024 * 1024)} MiB`;

  return `${names.length} file(s) were skipped or only partially scanned (${breakdown.replace("over the size cap", `over the ${limit} size cap`)}): ${preview}${suffix}. Findings in them may be missing, so this scan is incomplete.`;
}

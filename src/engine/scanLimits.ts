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
  | "analysis-failed";

export interface SkippedFile {
  file: string;
  reason: SkipReason;
}

const REASON_LABELS: Record<SkipReason, string> = {
  oversized: "over the size cap",
  "inline-scripts-truncated": "too many inline scripts to analyze",
  "symlink-outside-root": "symlink(s) resolving outside the scanned root, not followed",
  unreadable: "unreadable",
  "parse-failed": "failed to parse",
  "analysis-failed": "aborted during analysis",
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
export function summarizeSkippedFiles(skipped: SkippedFile[]): string | null {
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

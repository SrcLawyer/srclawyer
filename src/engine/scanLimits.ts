import { statSync } from "node:fs";

/**
 * One cap for every scanned file type (code, Python, HTML, OpenAPI/GraphQL). The largest real file in
 * the golden corpus is a 408KB OpenAPI spec, so 2 MiB leaves ~5x headroom while still bounding the
 * parse/regex/memory cost a single hostile file can impose. Files over it are skipped WITH a warning
 * (see summarizeSkippedFiles), never silently.
 */
export const MAX_SCANNED_FILE_BYTES = 2 * 1024 * 1024;

export interface SkippedFile {
  file: string;
  reason: "oversized" | "inline-scripts-truncated";
}

/** False for files that can't be stat'ed -- the existing read-failure handling covers those. */
export function isOversizedFile(path: string, maxBytes: number = MAX_SCANNED_FILE_BYTES): boolean {
  try {
    return statSync(path).size > maxBytes;
  } catch {
    return false;
  }
}

const PREVIEW_COUNT = 3;

/** A single summarized line -- a few names, the rest only in ScanResult.skippedFiles (--json). */
export function summarizeSkippedFiles(skipped: SkippedFile[]): string | null {
  if (skipped.length === 0) return null;
  const names = [...new Set(skipped.map((s) => s.file))];
  const preview = names.slice(0, PREVIEW_COUNT).join(", ");
  const remaining = names.length - PREVIEW_COUNT;
  const suffix = remaining > 0 ? `, and ${remaining} more (full list in --json output)` : "";
  const limit = `${MAX_SCANNED_FILE_BYTES / (1024 * 1024)} MiB`;
  return `${names.length} file(s) were skipped or only partially scanned (larger than ${limit}, or too many inline scripts): ${preview}${suffix}. Findings in them are missing, so this scan is incomplete.`;
}

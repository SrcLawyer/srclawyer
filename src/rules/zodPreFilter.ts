import { relative } from "node:path";
import { redactSecrets } from "../engine/secretRedaction.js";

/**
 * The real Zod schema/anchor detection (which call sites count as "this validates incoming request
 * data" vs. a third-party API response or an env-var schema — the actual scope-boundary reasoning)
 * runs server-side now (protected-logic cloud service). This module's only job is deciding WHETHER a
 * file is worth sending at all, using a deliberately crude, generic trigger — not the tuned logic.
 *
 * Text-based, not AST-based, on purpose: an AST-aware extraction of "just the schema + anchor" would
 * mean re-implementing the actual detection logic locally, which defeats the point of protecting it.
 */
const ZOD_IMPORT_RE = /from\s+["']zod(?:\/v[34](?:-mini)?)?["']/;
const ANCHOR_CALL_RE = /\.(?:parse|safeParse|parseAsync|safeParseAsync|inputSchema)\s*\(/;
const WINDOW_LINES = 40;

export interface ZodCandidate {
  id: string;
  codeFragment: string;
  /** fragmentLineToSourceLine[i] = the original 1-based source line for fragment line i+1. Lets
   *  resolveProtectedLogic() translate a server-reported fragment line back to a real location,
   *  since the fragment is a non-contiguous excerpt of the original file, not a raw slice. */
  fragmentLineToSourceLine: number[];
}

export function findZodCandidates(source: string, filePath: string, root: string): ZodCandidate[] {
  if (!ZOD_IMPORT_RE.test(source)) return [];

  const lines = source.split("\n");
  const matchLineIndexes: number[] = [];
  ANCHOR_CALL_RE.lastIndex = 0;
  lines.forEach((line, i) => {
    if (ANCHOR_CALL_RE.test(line)) matchLineIndexes.push(i);
  });
  if (matchLineIndexes.length === 0) return [];

  // One candidate per file, not per match — a single windowed fragment covering every anchor-shaped
  // line plus the top-of-file imports, merged and deduped. Keeps this a single call per file rather
  // than one per match, and the server already handles "multiple schemas in one fragment" naturally.
  const includedLines = new Set<number>();
  for (let i = 0; i < Math.min(20, lines.length); i++) includedLines.add(i); // import block
  for (const matchLine of matchLineIndexes) {
    for (let i = Math.max(0, matchLine - WINDOW_LINES); i <= Math.min(lines.length - 1, matchLine + WINDOW_LINES); i++) {
      includedLines.add(i);
    }
  }

  const sortedIndexes = [...includedLines].sort((a, b) => a - b);
  const fragment = sortedIndexes.map((i) => lines[i]).join("\n");
  const fragmentLineToSourceLine = sortedIndexes.map((i) => i + 1);

  const relPath = relative(root, filePath);
  return [{ id: relPath, codeFragment: redactSecrets(fragment), fragmentLineToSourceLine }];
}

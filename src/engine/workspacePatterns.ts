/**
 * Validation for workspace glob patterns read from a SCANNED repo's own package.json -- i.e. input an
 * attacker controls whenever the repo being scanned isn't the user's own. Brace expansion in glob
 * libraries can be driven to stack overflow, memory exhaustion, or minutes of CPU by very short
 * patterns (a 37-character `{1..300}{1..300}{1..300}` is enough), so patterns are bounded here before
 * they ever reach a glob library. Real workspace patterns (`packages/*`, `{apps,packages}/*`,
 * `tools/*\/packages/*`) are tens of characters with at most one small brace group.
 */

export const MAX_WORKSPACE_PATTERNS = 100;
export const MAX_PATTERN_LENGTH = 200;
export const MAX_BRACE_DEPTH = 2;
export const MAX_BRACE_GROUPS = 3;
export const MAX_BRACE_EXPANSION = 64;
export const MAX_RANGE_SPAN = 100;

export type WorkspacePatternsResult = { ok: true; patterns: string[] } | { ok: false; reason: string };

const NUMERIC_RANGE = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/;
const ALPHA_RANGE = /^[A-Za-z]\.\.[A-Za-z](?:\.\.-?\d+)?$/;

/** Upper bound on how many strings a brace-bearing segment expands to; null if malformed or too wide. */
function estimateExpansion(segment: string): number | null {
  let total = 1;
  let i = 0;
  while (i < segment.length) {
    if (segment[i] === "}") return null;
    if (segment[i] !== "{") {
      i += 1;
      continue;
    }

    let depth = 1;
    let j = i + 1;
    while (j < segment.length && depth > 0) {
      if (segment[j] === "{") depth += 1;
      else if (segment[j] === "}") depth -= 1;
      j += 1;
    }
    if (depth !== 0) return null;

    const inner = segment.slice(i + 1, j - 1);
    const groupEstimate = estimateGroup(inner);
    if (groupEstimate === null) return null;
    total *= groupEstimate;
    if (total > MAX_BRACE_EXPANSION) return null;
    i = j;
  }
  return total;
}

function estimateGroup(inner: string): number | null {
  const numeric = NUMERIC_RANGE.exec(inner);
  if (numeric) {
    const span = Math.abs(Number(numeric[2]) - Number(numeric[1])) + 1;
    const step = Math.abs(Number(numeric[3] ?? 1)) || 1;
    return span > MAX_RANGE_SPAN ? null : Math.ceil(span / step);
  }
  if (ALPHA_RANGE.test(inner)) return 52;

  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let k = 0; k < inner.length; k++) {
    if (inner[k] === "{") depth += 1;
    else if (inner[k] === "}") depth -= 1;
    else if (inner[k] === "," && depth === 0) {
      parts.push(inner.slice(start, k));
      start = k + 1;
    }
  }
  parts.push(inner.slice(start));

  let sum = 0;
  for (const part of parts) {
    const estimate = estimateExpansion(part);
    if (estimate === null) return null;
    sum += estimate;
  }
  return sum;
}

function braceShapeProblem(pattern: string): string | null {
  let depth = 0;
  let maxDepth = 0;
  let groups = 0;
  for (const ch of pattern) {
    if (ch === "{") {
      depth += 1;
      groups += 1;
      maxDepth = Math.max(maxDepth, depth);
    } else if (ch === "}") {
      depth -= 1;
      if (depth < 0) return "unbalanced braces";
    }
  }
  if (depth !== 0) return "unbalanced braces";
  if (maxDepth > MAX_BRACE_DEPTH) return `brace nesting deeper than ${MAX_BRACE_DEPTH}`;
  if (groups > MAX_BRACE_GROUPS) return `more than ${MAX_BRACE_GROUPS} brace groups`;
  if (estimateExpansion(pattern) === null) return `brace expansion wider than ${MAX_BRACE_EXPANSION} alternatives`;
  return null;
}

function patternProblem(pattern: unknown): string | null {
  if (typeof pattern !== "string") return "an entry is not a string";
  if (pattern.length === 0) return "an entry is empty";
  if (pattern.length > MAX_PATTERN_LENGTH) return `an entry is longer than ${MAX_PATTERN_LENGTH} characters`;
  if (pattern.includes("\0")) return "an entry contains a NUL character";
  if (pattern.includes("\\")) return "an entry contains a backslash";

  const body = pattern.startsWith("!") ? pattern.slice(1) : pattern;
  if (body.startsWith("!")) return "an entry has more than one leading '!'";
  if (body.startsWith("/") || /^[A-Za-z]:/.test(body)) return "an entry is an absolute path";
  if (body.split("/").includes("..")) return "an entry escapes the repo root with '..'";

  return braceShapeProblem(body);
}

/** `raw` is whatever package.json's `workspaces` (or `workspaces.packages`) held, unvalidated. */
export function validateWorkspacePatterns(raw: unknown): WorkspacePatternsResult {
  if (!Array.isArray(raw)) return { ok: false, reason: "workspaces is not an array of patterns" };
  if (raw.length > MAX_WORKSPACE_PATTERNS) return { ok: false, reason: `more than ${MAX_WORKSPACE_PATTERNS} workspace patterns` };

  for (const pattern of raw) {
    const problem = patternProblem(pattern);
    if (problem) return { ok: false, reason: problem };
  }
  return { ok: true, patterns: raw as string[] };
}

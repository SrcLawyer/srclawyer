import { relative } from "node:path";
import type { Finding } from "../engine/types.js";
import { classifyFieldName } from "./dataCategoryLexicon.js";
import { isSafeFieldName } from "./safeFieldNames.js";

// Tag matching is a start-anchor regex plus indexOf, not `<input\b[^>]*>` / `<script([^>]*)>([\s\S]*?)</script>`:
// on a file full of unclosed tags those single regexes rescan to the end of the file from every start
// (quadratic -- 200KB of "<input " took 8s), whereas this finds the same matches in one linear pass,
// since a tag with no closing delimiter after one start can't have one after any later start either.
const INPUT_START_RE = /<input\b/gi;
const SCRIPT_START_RE = /<script/gi;
const SCRIPT_CLOSE_RE = /<\/script>/gi;

// Padding inline scripts with one "\n" per preceding line (so rule line numbers match the original
// file) costs O(script count x line count) characters on a file with many scripts; this bounds the
// total so a hostile file can't exhaust memory. Scripts past the budget are reported, never dropped
// silently.
export const MAX_INLINE_SCRIPT_PADDING_CHARS = 16_000_000;
const NON_DATA_INPUT_TYPES = new Set(["submit", "button", "reset", "image"]);

function getAttr(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  return match ? match[1] : null;
}

// 1-based line number of a character offset, via a one-time index of line starts and a binary search
// (the previous slice-and-split per lookup was O(file size) each).
function makeLineLookup(text: string): (index: number) => number {
  const lineStarts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) lineStarts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

export function findInputTags(html: string): Array<{ index: number; tag: string }> {
  const tags: Array<{ index: number; tag: string }> = [];
  const startRe = new RegExp(INPUT_START_RE.source, INPUT_START_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = startRe.exec(html))) {
    const end = html.indexOf(">", match.index);
    if (end === -1) break;
    startRe.lastIndex = end + 1;
    tags.push({ index: match.index, tag: html.slice(match.index, end + 1) });
  }
  return tags;
}

export function runHtmlInputRules(html: string, filePath: string, root: string): Finding[] {
  const relPath = relative(root, filePath);
  const findings: Finding[] = [];

  const lineAt = makeLineLookup(html);
  for (const { index, tag } of findInputTags(html)) {
    const type = (getAttr(tag, "type") ?? "text").toLowerCase();
    if (NON_DATA_INPUT_TYPES.has(type)) continue;

    const identifier = getAttr(tag, "id") ?? getAttr(tag, "name");
    const line = lineAt(index);

    if (type === "password") {
      findings.push(makeFinding(relPath, line, tag, "authentication_credentials", "high", false, `<input type="password"> field collects a credential.`));
      continue;
    }
    if (type === "email") {
      findings.push(makeFinding(relPath, line, tag, "email", "high", false, `<input type="email"> field collects an email address.`));
      continue;
    }
    if (type === "tel") {
      findings.push(makeFinding(relPath, line, tag, "phone", "high", false, `<input type="tel"> field collects a phone number.`));
      continue;
    }

    if (!identifier || isSafeFieldName(identifier)) continue;
    const category = classifyFieldName(identifier);
    findings.push(
      makeFinding(
        relPath,
        line,
        tag,
        category ?? "generic_pii",
        category ? "medium" : "low",
        !category,
        category
          ? `Form field "${identifier}" classified as ${category}.`
          : `Form field "${identifier}" could not be confidently classified — needs review.`
      )
    );
  }

  return findings;
}

function makeFinding(
  relPath: string,
  line: number,
  tag: string,
  category: Finding["dataCategories"][number],
  confidence: Finding["confidence"],
  requiresReview: boolean,
  description: string
): Finding {
  return {
    id: `html-input:${relPath}:${line}`,
    dataCategories: [category],
    processor: null,
    description,
    confidence,
    source: "html-input-rule",
    location: { file: relPath, line, column: 0 },
    evidence: tag.replace(/\s+/g, " ").trim().slice(0, 160),
    requiresReview,
  };
}

export interface ExtractedScript {
  code: string;
}

export interface InlineScriptExtraction {
  scripts: ExtractedScript[];
  /** Inline scripts not extracted because the padding budget ran out (see MAX_INLINE_SCRIPT_PADDING_CHARS). */
  skippedCount: number;
}

export function extractInlineScriptsBounded(html: string): InlineScriptExtraction {
  const scripts: ExtractedScript[] = [];
  const lineAt = makeLineLookup(html);
  const startRe = new RegExp(SCRIPT_START_RE.source, SCRIPT_START_RE.flags);
  const closeRe = new RegExp(SCRIPT_CLOSE_RE.source, SCRIPT_CLOSE_RE.flags);
  let paddingUsed = 0;
  let skippedCount = 0;
  let match: RegExpExecArray | null;

  while ((match = startRe.exec(html))) {
    const openEnd = html.indexOf(">", match.index);
    if (openEnd === -1) break;
    closeRe.lastIndex = openEnd + 1;
    const close = closeRe.exec(html);
    if (!close) break;
    startRe.lastIndex = close.index + close[0].length;

    const attrs = html.slice(match.index + "<script".length, openEnd);
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/\btype\s*=\s*["'](?!(?:text\/javascript|module|application\/javascript)["'])[^"']*["']/i.test(attrs)) continue;

    const linesBefore = lineAt(openEnd + 1) - 1;
    if (paddingUsed + linesBefore > MAX_INLINE_SCRIPT_PADDING_CHARS) {
      skippedCount += 1;
      continue;
    }
    paddingUsed += linesBefore;
    scripts.push({ code: "\n".repeat(linesBefore) + html.slice(openEnd + 1, close.index) });
  }

  return { scripts, skippedCount };
}

export function extractInlineScripts(html: string): ExtractedScript[] {
  return extractInlineScriptsBounded(html).scripts;
}

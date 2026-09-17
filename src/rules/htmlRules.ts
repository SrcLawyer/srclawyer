import { relative } from "node:path";
import type { Finding } from "../engine/types.js";
import { classifyFieldName } from "./dataCategoryLexicon.js";
import { isSafeFieldName } from "./safeFieldNames.js";

const INPUT_TAG_RE = /<input\b[^>]*>/gi;
const SCRIPT_TAG_RE = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
const NON_DATA_INPUT_TYPES = new Set(["submit", "button", "reset", "image"]);

function getAttr(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  return match ? match[1] : null;
}

function lineAt(html: string, index: number): number {
  return html.slice(0, index).split("\n").length;
}

export function runHtmlInputRules(html: string, filePath: string, root: string): Finding[] {
  const relPath = relative(root, filePath);
  const findings: Finding[] = [];

  let match: RegExpExecArray | null;
  while ((match = INPUT_TAG_RE.exec(html))) {
    const tag = match[0];
    const type = (getAttr(tag, "type") ?? "text").toLowerCase();
    if (NON_DATA_INPUT_TYPES.has(type)) continue;

    const identifier = getAttr(tag, "id") ?? getAttr(tag, "name");
    const line = lineAt(html, match.index);

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

export function extractInlineScripts(html: string): ExtractedScript[] {
  const scripts: ExtractedScript[] = [];
  let match: RegExpExecArray | null;

  while ((match = SCRIPT_TAG_RE.exec(html))) {
    const attrs = match[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/\btype\s*=\s*["'](?!(?:text\/javascript|module|application\/javascript)["'])[^"']*["']/i.test(attrs)) continue;

    const body = match[2];
    const openTagLength = "<script".length + attrs.length + 1;
    const contentStart = match.index + openTagLength;
    const linesBefore = html.slice(0, contentStart).split("\n").length - 1;
    scripts.push({ code: "\n".repeat(linesBefore) + body });
  }

  return scripts;
}

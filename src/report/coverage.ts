import { PROCESSOR_PROFILES } from "../rules/processorProfiles.js";
import { COVERAGE_AI_OFF, COVERAGE_SKIPPED, COVERAGE_STANDARD, COVERAGE_TEMPLATE_SYNTAX, COVERAGE_UNSUPPORTED } from "../assistant/wording.js";
import type { ScanResult } from "../engine/types.js";

export interface CoverageInput {
  scan: Pick<ScanResult, "filesScanned" | "unsupportedStackWarning" | "skippedFiles" | "templateSyntaxNote">;
  /** "git" for git-aware discovery, "glob" for the ordinary file-system walk. */
  discovery: "git" | "glob";
  /** Whether AI-assisted (Layer 2) review ran in this scan. */
  aiReviewOn: boolean;
}

/** Number of distinct third-party services SrcLawyer recognizes, counted from its own profile table. */
export function knownServiceCount(): number {
  return new Set(Object.values(PROCESSOR_PROFILES).map((p) => p.name)).size;
}

/** The stack name from an "UNSUPPORTED CODEBASE — X detected ..." banner, or a neutral fallback. */
export function unsupportedStackName(warning: string): string {
  return /UNSUPPORTED CODEBASE — (.+?) detected/.exec(warning)?.[1] ?? "unknown";
}

function plural(n: number, singular: string, pluralForm: string): string {
  return n === 1 ? singular : pluralForm;
}

/**
 * One path-free sentence saying what a scan covered and what it did not (docs/question-catalog.md
 * section 4). Built only from counts, the discovery mode and constants.
 */
export function coverageLine(input: CoverageInput): string {
  const k = knownServiceCount();
  const mode = input.discovery === "git" ? "git" : "file-system";
  const skipped = input.scan.skippedFiles.filter((f) => f.reason !== "template-syntax").length;

  let line: string;
  if (input.scan.unsupportedStackWarning) {
    line = COVERAGE_UNSUPPORTED.replace("{stack name}", unsupportedStackName(input.scan.unsupportedStackWarning)).replace("{k}", String(k));
  } else {
    const n = input.scan.filesScanned;
    line = COVERAGE_STANDARD.replace("{n} files", `${n} ${plural(n, "file", "files")}`).replace("{mode}", mode).replace("{k}", String(k));
  }
  if (skipped > 0) {
    line += COVERAGE_SKIPPED.replace("{s} files were", `${skipped} ${plural(skipped, "file was", "files were")}`);
  }
  if (input.scan.templateSyntaxNote) line += COVERAGE_TEMPLATE_SYNTAX;
  if (!input.aiReviewOn) line += COVERAGE_AI_OFF;
  return line;
}

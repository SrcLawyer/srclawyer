import type { Confidence, DataCategory, Finding } from "../src/engine/types.js";

export interface ExpectedFinding {
  filePattern: string;
  lineRange: [number, number];
  dataCategory: DataCategory;
  minConfidence: Confidence;
  note?: string;
}

export interface CorpusScore {
  repoName: string;
  totalExpected: number;
  matchedExpected: number;
  recall: number;
  totalFindings: number;
  findingsMatchingSomeExpected: number;
  precision: number;
  unmatchedExpected: ExpectedFinding[];
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function filePatternMatches(pattern: string, file: string): boolean {
  const escaped = pattern
    .split("*")
    .map((segment) => segment.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(file);
}

export function findingMatchesExpected(finding: Finding, expected: ExpectedFinding): boolean {
  if (!filePatternMatches(expected.filePattern, finding.location.file)) return false;
  const { line } = finding.location;
  if (line < expected.lineRange[0] || line > expected.lineRange[1]) return false;
  if (!finding.dataCategories.includes(expected.dataCategory)) return false;
  if (CONFIDENCE_RANK[finding.confidence] < CONFIDENCE_RANK[expected.minConfidence]) return false;
  return true;
}

export function scoreCorpus(repoName: string, findings: Finding[], expected: ExpectedFinding[]): CorpusScore {
  const unmatchedExpected: ExpectedFinding[] = [];
  let matchedExpected = 0;
  for (const exp of expected) {
    if (findings.some((f) => findingMatchesExpected(f, exp))) {
      matchedExpected += 1;
    } else {
      unmatchedExpected.push(exp);
    }
  }

  const findingsMatchingSomeExpected = findings.filter((f) => expected.some((exp) => findingMatchesExpected(f, exp))).length;

  return {
    repoName,
    totalExpected: expected.length,
    matchedExpected,
    recall: expected.length === 0 ? 1 : matchedExpected / expected.length,
    totalFindings: findings.length,
    findingsMatchingSomeExpected,
    precision: findings.length === 0 ? 0 : findingsMatchingSomeExpected / findings.length,
    unmatchedExpected,
  };
}

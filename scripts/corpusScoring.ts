import type { Confidence, DataCategory, Finding } from "../src/engine/types.js";

/**
 * real_pii: this entry describes genuine privacy-relevant data collection, whether or not the tool
 * currently detects it (a "real_pii" entry can still be a known, documented miss).
 * documented_non_pii: this entry exists purely to document that a finding the tool DOES produce at
 * this location is NOT actually PII (e.g. a pagination cursor, a redirect target) -- kept in ground
 * truth so the false positive stays visible and tracked, not because catching it is desirable.
 * Matching logic ({filePattern, lineRange, dataCategory, minConfidence}) is identical either way;
 * only how the two numbers below are built from the matches differs.
 */
export type FindingClassification = "real_pii" | "documented_non_pii";

export interface ExpectedFinding {
  filePattern: string;
  lineRange: [number, number];
  dataCategory: DataCategory;
  minConfidence: Confidence;
  classification: FindingClassification;
  note?: string;
}

export interface CorpusScore {
  repoName: string;
  totalFindings: number;

  // (a) recall of real PII -- the hard regression gate. Deliberately excludes documented_non_pii
  // entries: "recall" of a known false positive isn't a thing to maximize.
  totalExpectedRealPii: number;
  matchedRealPii: number;
  recallRealPii: number;
  unmatchedRealPii: ExpectedFinding[];

  // Informational, not gated: whether documented false-positive cases are still being produced as
  // predicted. A drop here isn't necessarily bad (the finding may have genuinely stopped firing for
  // an unrelated reason) but is worth a look if it's not what you expected to change.
  totalExpectedDocumentedNonPii: number;
  matchedDocumentedNonPii: number;

  // (b) the share of every actual finding the scan produced that is real PII, documented non-PII, or
  // neither (unmatched -- not covered by ground truth yet, the old blended "precision" denominator's
  // only honest use: a measure of how complete hand-verification is, not of detection accuracy).
  findingsRealPii: number;
  findingsDocumentedNonPii: number;
  findingsUnmatched: number;
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
  const realPiiExpected = expected.filter((e) => e.classification === "real_pii");
  const nonPiiExpected = expected.filter((e) => e.classification === "documented_non_pii");

  const unmatchedRealPii: ExpectedFinding[] = [];
  let matchedRealPii = 0;
  for (const exp of realPiiExpected) {
    if (findings.some((f) => findingMatchesExpected(f, exp))) matchedRealPii += 1;
    else unmatchedRealPii.push(exp);
  }

  let matchedDocumentedNonPii = 0;
  for (const exp of nonPiiExpected) {
    if (findings.some((f) => findingMatchesExpected(f, exp))) matchedDocumentedNonPii += 1;
  }

  // A finding that happens to match both a real_pii and a documented_non_pii entry (not expected in
  // practice, since the two describe different locations/categories) counts as real_pii -- the more
  // consequential classification wins ties rather than silently picking one arbitrarily.
  let findingsRealPii = 0;
  let findingsDocumentedNonPii = 0;
  for (const f of findings) {
    if (realPiiExpected.some((exp) => findingMatchesExpected(f, exp))) {
      findingsRealPii += 1;
    } else if (nonPiiExpected.some((exp) => findingMatchesExpected(f, exp))) {
      findingsDocumentedNonPii += 1;
    }
  }
  const findingsUnmatched = findings.length - findingsRealPii - findingsDocumentedNonPii;

  return {
    repoName,
    totalFindings: findings.length,
    totalExpectedRealPii: realPiiExpected.length,
    matchedRealPii,
    recallRealPii: realPiiExpected.length === 0 ? 1 : matchedRealPii / realPiiExpected.length,
    unmatchedRealPii,
    totalExpectedDocumentedNonPii: nonPiiExpected.length,
    matchedDocumentedNonPii,
    findingsRealPii,
    findingsDocumentedNonPii,
    findingsUnmatched,
  };
}

import { describe, expect, it } from "vitest";
import { filePatternMatches, findingMatchesExpected, scoreCorpus } from "../scripts/corpusScoring.js";
import type { ExpectedFinding } from "../scripts/corpusScoring.js";
import type { Finding } from "../src/engine/types.js";

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: "test",
    dataCategories: ["email"],
    processor: null,
    description: "Test finding",
    confidence: "medium",
    source: "framework-rule",
    location: { file: "server.js", line: 10, column: 0 },
    evidence: "email",
    requiresReview: false,
    ...overrides,
  };
}

function makeExpected(overrides: Partial<ExpectedFinding>): ExpectedFinding {
  return {
    filePattern: "server.js",
    lineRange: [1, 20],
    dataCategory: "email",
    minConfidence: "low",
    classification: "real_pii",
    ...overrides,
  };
}

describe("filePatternMatches", () => {
  it("matches an exact path with no wildcard", () => {
    expect(filePatternMatches("src/app.ts", "src/app.ts")).toBe(true);
    expect(filePatternMatches("src/app.ts", "src/other.ts")).toBe(false);
  });

  it("matches a single * wildcard across path segments", () => {
    expect(filePatternMatches("apps/web/app/api/workspaces/*/import/short/route.ts", "apps/web/app/api/workspaces/abc123/import/short/route.ts")).toBe(true);
  });

  it("does not match a different file even with a wildcard present", () => {
    expect(filePatternMatches("apps/web/app/api/workspaces/*/import/short/route.ts", "apps/web/app/api/workspaces/abc123/import/rebrandly/route.ts")).toBe(false);
  });

  it("escapes regex-special characters in the pattern", () => {
    expect(filePatternMatches("apps/web/app/(ee)/api/route.ts", "apps/web/app/(ee)/api/route.ts")).toBe(true);
    expect(filePatternMatches("apps/web/app/(ee)/api/route.ts", "apps/web/appXeeXapi/route.ts")).toBe(false);
  });
});

describe("findingMatchesExpected", () => {
  it("matches when file, line range, category, and confidence all satisfy the expectation", () => {
    const finding = makeFinding({ location: { file: "server.js", line: 9, column: 0 }, dataCategories: ["email"], confidence: "medium" });
    expect(findingMatchesExpected(finding, makeExpected({}))).toBe(true);
  });

  it("rejects a finding outside the expected line range", () => {
    const finding = makeFinding({ location: { file: "server.js", line: 99, column: 0 } });
    expect(findingMatchesExpected(finding, makeExpected({ lineRange: [1, 20] }))).toBe(false);
  });

  it("rejects a finding missing the expected data category", () => {
    const finding = makeFinding({ dataCategories: ["phone"] });
    expect(findingMatchesExpected(finding, makeExpected({ dataCategory: "email" }))).toBe(false);
  });

  it("rejects a finding below the expected minimum confidence", () => {
    const finding = makeFinding({ confidence: "low" });
    expect(findingMatchesExpected(finding, makeExpected({ minConfidence: "medium" }))).toBe(false);
  });

  it("accepts a finding above the expected minimum confidence", () => {
    const finding = makeFinding({ confidence: "high" });
    expect(findingMatchesExpected(finding, makeExpected({ minConfidence: "medium" }))).toBe(true);
  });
});

describe("scoreCorpus", () => {
  it("computes 100% real-PII recall when every real_pii entry is matched by some finding", () => {
    const findings = [makeFinding({ location: { file: "a.ts", line: 5, column: 0 }, dataCategories: ["email"] })];
    const expected = [makeExpected({ filePattern: "a.ts", lineRange: [1, 10], dataCategory: "email", classification: "real_pii" })];

    const score = scoreCorpus("repo", findings, expected);

    expect(score.recallRealPii).toBe(1);
    expect(score.unmatchedRealPii).toHaveLength(0);
  });

  it("computes partial real-PII recall and lists the unmatched real_pii entries when some are missed", () => {
    const findings = [makeFinding({ location: { file: "a.ts", line: 5, column: 0 }, dataCategories: ["email"] })];
    const expected = [
      makeExpected({ filePattern: "a.ts", lineRange: [1, 10], dataCategory: "email", classification: "real_pii" }),
      makeExpected({ filePattern: "b.ts", lineRange: [1, 10], dataCategory: "name", classification: "real_pii" }),
    ];

    const score = scoreCorpus("repo", findings, expected);

    expect(score.recallRealPii).toBe(0.5);
    expect(score.unmatchedRealPii).toEqual([expected[1]]);
  });

  it("treats an empty real_pii expected set as trivially 100% recall (nothing to miss)", () => {
    const score = scoreCorpus("repo", [makeFinding({})], []);
    expect(score.recallRealPii).toBe(1);
  });

  it("excludes documented_non_pii entries from real-PII recall entirely", () => {
    const expected = [makeExpected({ filePattern: "a.ts", lineRange: [1, 10], dataCategory: "generic_pii", classification: "documented_non_pii" })];

    const score = scoreCorpus("repo", [], expected);

    expect(score.totalExpectedRealPii).toBe(0);
    expect(score.recallRealPii).toBe(1);
    expect(score.totalExpectedDocumentedNonPii).toBe(1);
    expect(score.matchedDocumentedNonPii).toBe(0);
  });

  it("splits every finding into real-PII, documented-non-PII, or unmatched, summing to totalFindings", () => {
    const realPiiFinding = makeFinding({ location: { file: "a.ts", line: 5, column: 0 }, dataCategories: ["email"] });
    const nonPiiFinding = makeFinding({ location: { file: "a.ts", line: 15, column: 0 }, dataCategories: ["generic_pii"] });
    const unmatchedFinding = makeFinding({ location: { file: "unrelated.ts", line: 1, column: 0 }, dataCategories: ["phone"] });
    const expected = [
      makeExpected({ filePattern: "a.ts", lineRange: [1, 10], dataCategory: "email", classification: "real_pii" }),
      makeExpected({ filePattern: "a.ts", lineRange: [11, 20], dataCategory: "generic_pii", classification: "documented_non_pii" }),
    ];

    const score = scoreCorpus("repo", [realPiiFinding, nonPiiFinding, unmatchedFinding], expected);

    expect(score.recallRealPii).toBe(1);
    expect(score.findingsRealPii).toBe(1);
    expect(score.findingsDocumentedNonPii).toBe(1);
    expect(score.findingsUnmatched).toBe(1);
    expect(score.findingsRealPii + score.findingsDocumentedNonPii + score.findingsUnmatched).toBe(score.totalFindings);
  });

  it("classifies a finding matching both a real_pii and a documented_non_pii entry as real_pii (ties go to the more consequential classification)", () => {
    const finding = makeFinding({ location: { file: "a.ts", line: 5, column: 0 }, dataCategories: ["email"] });
    const expected = [
      makeExpected({ filePattern: "a.ts", lineRange: [1, 10], dataCategory: "email", classification: "documented_non_pii" }),
      makeExpected({ filePattern: "a.ts", lineRange: [1, 10], dataCategory: "email", classification: "real_pii" }),
    ];

    const score = scoreCorpus("repo", [finding], expected);

    expect(score.findingsRealPii).toBe(1);
    expect(score.findingsDocumentedNonPii).toBe(0);
  });

  it("does not crash on zero findings and reports 0 for every findings-breakdown count, not a divide-by-zero", () => {
    const expected = [makeExpected({})];
    const score = scoreCorpus("repo", [], expected);

    expect(score.recallRealPii).toBe(0);
    expect(score.findingsRealPii).toBe(0);
    expect(score.findingsDocumentedNonPii).toBe(0);
    expect(score.findingsUnmatched).toBe(0);
  });
});

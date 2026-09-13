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
  it("computes 100% recall when every expected entry is matched by some finding", () => {
    const findings = [makeFinding({ location: { file: "a.ts", line: 5, column: 0 }, dataCategories: ["email"] })];
    const expected = [makeExpected({ filePattern: "a.ts", lineRange: [1, 10], dataCategory: "email" })];

    const score = scoreCorpus("repo", findings, expected);

    expect(score.recall).toBe(1);
    expect(score.unmatchedExpected).toHaveLength(0);
  });

  it("computes partial recall and lists the unmatched expected entries when some are missed", () => {
    const findings = [makeFinding({ location: { file: "a.ts", line: 5, column: 0 }, dataCategories: ["email"] })];
    const expected = [
      makeExpected({ filePattern: "a.ts", lineRange: [1, 10], dataCategory: "email" }),
      makeExpected({ filePattern: "b.ts", lineRange: [1, 10], dataCategory: "name" }),
    ];

    const score = scoreCorpus("repo", findings, expected);

    expect(score.recall).toBe(0.5);
    expect(score.unmatchedExpected).toEqual([expected[1]]);
  });

  it("treats an empty expected set as trivially 100% recall (nothing to miss)", () => {
    const score = scoreCorpus("repo", [makeFinding({})], []);
    expect(score.recall).toBe(1);
  });

  it("computes precision only from findings that match some expected entry, without gating on it", () => {
    const matching = makeFinding({ location: { file: "a.ts", line: 5, column: 0 }, dataCategories: ["email"] });
    const extra = makeFinding({ location: { file: "unrelated.ts", line: 1, column: 0 }, dataCategories: ["phone"] });
    const expected = [makeExpected({ filePattern: "a.ts", lineRange: [1, 10], dataCategory: "email" })];

    const score = scoreCorpus("repo", [matching, extra], expected);

    expect(score.recall).toBe(1);
    expect(score.findingsMatchingSomeExpected).toBe(1);
    expect(score.precision).toBe(0.5);
  });

  it("does not crash on zero findings and reports 0% precision, not a divide-by-zero", () => {
    const expected = [makeExpected({})];
    const score = scoreCorpus("repo", [], expected);

    expect(score.recall).toBe(0);
    expect(score.precision).toBe(0);
  });
});

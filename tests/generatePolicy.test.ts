import { describe, expect, it } from "vitest";
import { generatePolicyMarkdown } from "../src/policy/generatePolicy.js";
import { MANDATORY_DISCLAIMER } from "../src/policy/disclaimer.js";
import type { Finding, ScanResult } from "../src/engine/types.js";

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: "test",
    dataCategories: ["email"],
    processor: null,
    description: "Test finding",
    confidence: "medium",
    source: "framework-rule",
    location: { file: "server.js", line: 1, column: 0 },
    evidence: "email",
    requiresReview: false,
    ...overrides,
  };
}

function makeScanResult(overrides: Partial<ScanResult>): ScanResult {
  return { projects: [], findings: [], ambiguousCount: 0, filesScanned: 0, unsupportedStackWarning: null, ...overrides };
}

describe("generatePolicyMarkdown", () => {
  it("always includes the mandatory disclaimer, verbatim", () => {
    const result = makeScanResult({});
    const markdown = generatePolicyMarkdown(result, null);
    expect(markdown).toContain(MANDATORY_DISCLAIMER);
  });

  it("groups confident findings by data category with a traceable location", () => {
    const finding = makeFinding({
      dataCategories: ["email"],
      description: 'Request field "email" collected, classified as email.',
      location: { file: "server.js", line: 9, column: 0 },
    });
    const result = makeScanResult({ findings: [finding], filesScanned: 1 });
    const markdown = generatePolicyMarkdown(result, null);

    expect(markdown).toContain("### Email addresses");
    expect(markdown).toContain("server.js:9");
  });

  it("lists SDK-derived findings under Third-Party Data Processors", () => {
    const finding = makeFinding({
      dataCategories: ["payment_info", "email"],
      processor: "Stripe",
      source: "sdk-rule",
      description: "Stripe integration detected. Payment processor.",
      location: { file: "server.js", line: 2, column: 0 },
    });
    const result = makeScanResult({ findings: [finding], filesScanned: 1 });
    const markdown = generatePolicyMarkdown(result, null);

    expect(markdown).toContain("## Third-Party Data Processors");
    expect(markdown).toContain("Stripe");
    expect(markdown).toContain("### Payment information");
    expect(markdown).toContain("### Email addresses");
  });

  it("keeps ambiguous findings out of the main body and lists them for manual review", () => {
    const confident = makeFinding({ dataCategories: ["email"] });
    const ambiguous = makeFinding({
      dataCategories: ["generic_pii"],
      requiresReview: true,
      confidence: "low",
      description: 'Request field "notes" collected; could not confidently classify.',
      evidence: "notes",
      location: { file: "server.js", line: 20, column: 0 },
    });
    const result = makeScanResult({ findings: [confident, ambiguous], ambiguousCount: 1, filesScanned: 1 });
    const markdown = generatePolicyMarkdown(result, null);

    expect(markdown).toContain("## Items Requiring Manual Review");
    expect(markdown).toContain("notes");
    expect(markdown).not.toContain("### Other personal data");
  });

  it("includes jurisdiction context when config is present", () => {
    const result = makeScanResult({});
    const markdown = generatePolicyMarkdown(result, {
      entityLocation: "US",
      targetMarkets: ["US", "EU"],
      industry: "E-commerce",
      collectsChildrensData: false,
    });

    expect(markdown).toContain("**Entity location:** US");
    expect(markdown).toContain("**Target markets:** US, EU");
  });

  it("prominently surfaces an unsupported-stack warning at the top of the document", () => {
    const result = makeScanResult({ unsupportedStackWarning: "UNSUPPORTED CODEBASE — Python detected as the primary language." });
    const markdown = generatePolicyMarkdown(result, null);

    const titleIndex = markdown.indexOf("# Privacy Policy");
    const warningIndex = markdown.indexOf("WARNING: INCOMPLETE SCAN");
    const scopeIndex = markdown.indexOf("## Scope");

    expect(warningIndex).toBeGreaterThan(titleIndex);
    expect(warningIndex).toBeLessThan(scopeIndex);
    expect(markdown).toContain("Python detected as the primary language");
  });

  it("renders an AI-resolved finding in the main body using its LLM-refined category and description", () => {
    const finding = makeFinding({
      dataCategories: ["generic_pii"],
      description: 'Request field "notes" collected; could not confidently classify.',
      requiresReview: true,
      confidence: "low",
      evidence: "notes",
      llmResolution: {
        outcome: "resolved",
        reason: null,
        provider: "anthropic",
        model: "claude-sonnet-5",
        resolvedDataCategories: ["health_data"],
        resolvedDescription: "Collects a free-text clinical note.",
      },
    });
    const result = makeScanResult({ findings: [finding], filesScanned: 1 });
    const markdown = generatePolicyMarkdown(result, null);

    expect(markdown).toContain("### Health data");
    expect(markdown).toContain("Collects a free-text clinical note.");
    expect(markdown).not.toContain("## Items Requiring Manual Review");
  });

  it("renders a declined finding only in its own section, with the reason visible, never in the confident or manual-review sections", () => {
    const finding = makeFinding({
      dataCategories: ["generic_pii"],
      description: 'Request field "notes" collected; could not confidently classify.',
      requiresReview: true,
      confidence: "low",
      evidence: "notes",
      location: { file: "server.js", line: 30, column: 0 },
      llmResolution: {
        outcome: "declined",
        reason: "High-stakes category (children's data) — always requires manual/legal review, never auto-resolved.",
        provider: "anthropic",
        model: "claude-sonnet-5",
      },
    });
    const result = makeScanResult({ findings: [finding], filesScanned: 1 });
    const markdown = generatePolicyMarkdown(result, null);

    expect(markdown).toContain("## Items Declined by AI-Assisted Review");
    expect(markdown).toContain("always requires manual/legal review");
    expect(markdown).not.toContain("## Items Requiring Manual Review");
    expect(markdown).not.toContain("### Other personal data");
  });

  it("keeps an unresolved (failed/never-sent) AI attempt in the existing manual-review section", () => {
    const finding = makeFinding({
      dataCategories: ["generic_pii"],
      description: 'Request field "notes" collected; could not confidently classify.',
      requiresReview: true,
      confidence: "low",
      evidence: "notes",
      llmResolution: {
        outcome: "unresolved",
        reason: "API request failed: network timeout",
        provider: "anthropic",
        model: null,
      },
    });
    const result = makeScanResult({ findings: [finding], filesScanned: 1 });
    const markdown = generatePolicyMarkdown(result, null);

    expect(markdown).toContain("## Items Requiring Manual Review");
    expect(markdown).toContain("network timeout");
    expect(markdown).not.toContain("## Items Declined by AI-Assisted Review");
  });

  it("renders a warning banner when a configured tier could not run", () => {
    const result = makeScanResult({});
    const markdown = generatePolicyMarkdown(result, null, 'Tier is "byok" but the environment variable ANTHROPIC_API_KEY is not set.');

    expect(markdown).toContain("WARNING: AI-ASSISTED RESOLUTION DID NOT RUN");
    expect(markdown).toContain("ANTHROPIC_API_KEY is not set");
  });
});

import { describe, expect, it } from "vitest";
import { generatePolicyMarkdown } from "../src/policy/generatePolicy.js";
import { MANDATORY_DISCLAIMER } from "../src/policy/disclaimer.js";
import type { Finding, ScanResult } from "../src/engine/types.js";
import type { SrcLawyerConfig } from "../src/config/config.js";

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

function makeConfig(overrides: Partial<SrcLawyerConfig> = {}): SrcLawyerConfig {
  return {
    entityLocation: null,
    targetMarkets: [],
    industry: null,
    collectsChildrensData: null,
    tier: "free",
    companyName: null,
    siteUrl: null,
    privacyContactEmail: null,
    hasEuUkUsers: null,
    hasCaliforniaUsers: null,
    sellsOrSharesData: null,
    usesDataForAdvertising: null,
    dataRetentionPolicy: null,
    accountDeletionInstructions: null,
    minimumAge: null,
    sendsDataToAiServices: null,
    ...overrides,
  };
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

  it("prominently surfaces a protected-logic-unavailable warning at the top of the FILE, not just the CLI output -- a policy file gets committed and shared on its own", () => {
    const result = makeScanResult({});
    const warning = "Zod-schema detection unavailable (fetch failed) — schemas in this scan were not checked.";
    const markdown = generatePolicyMarkdown(result, null, null, warning);

    const titleIndex = markdown.indexOf("# Privacy Policy");
    const warningIndex = markdown.indexOf("WARNING: PROTECTED-LOGIC SERVICE UNAVAILABLE");
    const scopeIndex = markdown.indexOf("## Scope");

    expect(warningIndex).toBeGreaterThan(titleIndex);
    expect(warningIndex).toBeLessThan(scopeIndex);
    expect(markdown).toContain(warning);
  });

  it("omits the protected-logic warning entirely when nothing failed", () => {
    const result = makeScanResult({});
    const markdown = generatePolicyMarkdown(result, null, null, null);

    expect(markdown).not.toContain("PROTECTED-LOGIC SERVICE UNAVAILABLE");
  });

  it("says the codebase wasn't analyzed, not that no data collection was found, when the stack is unsupported and nothing was confidently detected", () => {
    const result = makeScanResult({ unsupportedStackWarning: "UNSUPPORTED CODEBASE — Python detected as the primary language." });
    const markdown = generatePolicyMarkdown(result, null);

    expect(markdown).toContain("Not analyzed");
    expect(markdown).not.toContain("No data-collection patterns were confidently identified");
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

  describe("About This Policy", () => {
    it("renders supplied company name, site URL, and privacy email", () => {
      const config = makeConfig({ companyName: "Acme Inc.", siteUrl: "https://acme.example", privacyContactEmail: "privacy@acme.example" });
      const markdown = generatePolicyMarkdown(makeScanResult({}), config);

      expect(markdown).toContain("This policy is issued by Acme Inc.");
      expect(markdown).toContain("https://acme.example");
      expect(markdown).toContain("privacy@acme.example");

      const aboutSection = markdown.slice(markdown.indexOf("## About This Policy"), markdown.indexOf("## Data We Collect"));
      expect(aboutSection).not.toContain("[TO COMPLETE:");
    });

    it("renders a placeholder for each unanswered field, never a guessed value", () => {
      const markdown = generatePolicyMarkdown(makeScanResult({}), makeConfig());

      expect(markdown).toContain("[TO COMPLETE: company or product name]");
      expect(markdown).toContain("[TO COMPLETE: site or app URL]");
      expect(markdown).toContain("[TO COMPLETE: privacy contact email address]");
    });

    it("does not double a terminal period when the company name already ends with one", () => {
      const markdown = generatePolicyMarkdown(makeScanResult({}), makeConfig({ companyName: "Acme Inc." }));

      expect(markdown).toContain("This policy is issued by Acme Inc.\n");
      expect(markdown).not.toContain("Acme Inc..");
    });

    it("does not append a stray period right after a trailing slash in a URL", () => {
      const markdown = generatePolicyMarkdown(makeScanResult({}), makeConfig({ siteUrl: "https://acme.example/" }));

      expect(markdown).toContain("available at https://acme.example/\n");
      expect(markdown).not.toContain("https://acme.example/.");
    });

    it("still appends a period when the value has no trailing punctuation", () => {
      const markdown = generatePolicyMarkdown(makeScanResult({}), makeConfig({ companyName: "Acme Inc" }));

      expect(markdown).toContain("This policy is issued by Acme Inc.\n");
    });
  });

  describe("Data Retention, Deletion, and Use", () => {
    it("renders the sell/share sentence true, false, and unanswered, always with a processors cross-reference", () => {
      const withProcessor = makeScanResult({
        findings: [makeFinding({ processor: "Stripe", description: "Stripe integration detected. Payment processor." })],
        filesScanned: 1,
      });
      for (const value of [true, false, null] as const) {
        const markdown = generatePolicyMarkdown(withProcessor, makeConfig({ sellsOrSharesData: value }));
        expect(markdown).toContain("See the Third-Party Data Processors section above");
        if (value === true) expect(markdown).toContain("has been declared to sell or share personal data");
        if (value === false) expect(markdown).toContain("has not been declared to sell or share personal data");
        if (value === null) expect(markdown).toContain("[TO COMPLETE: whether personal data is sold or shared");
      }
    });

    it("does not reference a missing Third-Party Data Processors section when none were detected", () => {
      const markdown = generatePolicyMarkdown(makeScanResult({}), makeConfig({ sellsOrSharesData: true }));

      expect(markdown).not.toContain("## Third-Party Data Processors");
      expect(markdown).not.toContain("See the Third-Party Data Processors section above");
      expect(markdown).toContain("This document does not include a Third-Party Data Processors section");
      // Still keeps the point that these are self-declared and don't override actual integrations.
      expect(markdown).toContain("do not override any third-party integrations this codebase may actually use");
    });

    it("does not reference a missing Third-Party Data Processors section on an unsupported-stack scan", () => {
      const markdown = generatePolicyMarkdown(
        makeScanResult({ unsupportedStackWarning: "UNSUPPORTED CODEBASE — Python detected as the primary language." }),
        makeConfig({ sellsOrSharesData: true })
      );

      expect(markdown).not.toContain("## Third-Party Data Processors");
      expect(markdown).not.toContain("See the Third-Party Data Processors section above");
      expect(markdown).toContain("This document does not include a Third-Party Data Processors section");
    });

    it("references the real section when a processor was in fact detected", () => {
      const markdown = generatePolicyMarkdown(
        makeScanResult({
          findings: [makeFinding({ processor: "Stripe", description: "Stripe integration detected. Payment processor." })],
          filesScanned: 1,
        }),
        makeConfig({ sellsOrSharesData: false })
      );

      expect(markdown).toContain("## Third-Party Data Processors");
      expect(markdown).toContain("See the Third-Party Data Processors section above");
      expect(markdown).not.toContain("This document does not include a Third-Party Data Processors section");
    });

    it("renders the advertising sentence true, false, and unanswered", () => {
      for (const value of [true, false, null] as const) {
        const markdown = generatePolicyMarkdown(makeScanResult({}), makeConfig({ usesDataForAdvertising: value }));
        if (value === true) expect(markdown).toContain("has been declared to use personal data for cross-context behavioral advertising");
        if (value === false) expect(markdown).toContain("has not been declared to use personal data for cross-context behavioral advertising");
        if (value === null) expect(markdown).toContain("[TO COMPLETE: whether personal data is used for cross-context behavioral advertising]");
      }
    });

    it("renders the AI-services sentence true, false, and unanswered", () => {
      for (const value of [true, false, null] as const) {
        const markdown = generatePolicyMarkdown(makeScanResult({}), makeConfig({ sendsDataToAiServices: value }));
        if (value === true) expect(markdown).toContain("User data may be sent to third-party AI services");
        if (value === false) expect(markdown).toContain("User data is not sent to third-party AI services");
        if (value === null) expect(markdown).toContain("[TO COMPLETE: whether user data is sent to third-party AI services");
      }
    });

    it("renders retention and deletion text when supplied, placeholders when not", () => {
      const answered = generatePolicyMarkdown(
        makeScanResult({}),
        makeConfig({ dataRetentionPolicy: "2 years after account closure", accountDeletionInstructions: "Email privacy@acme.example" })
      );
      expect(answered).toContain("2 years after account closure");
      expect(answered).toContain("Email privacy@acme.example");

      const unanswered = generatePolicyMarkdown(makeScanResult({}), makeConfig());
      expect(unanswered).toContain("[TO COMPLETE: data retention period or policy]");
      expect(unanswered).toContain("[TO COMPLETE: how a user can delete their account or request data deletion]");
    });
  });

  describe("Your Rights", () => {
    it("renders the EU/UK paragraph only when true, omits it when false, placeholders when unanswered", () => {
      const yes = generatePolicyMarkdown(makeScanResult({}), makeConfig({ hasEuUkUsers: true, hasCaliforniaUsers: false }));
      expect(yes).toContain("GDPR and/or UK GDPR");

      const no = generatePolicyMarkdown(makeScanResult({}), makeConfig({ hasEuUkUsers: false, hasCaliforniaUsers: true }));
      expect(no).not.toContain("GDPR and/or UK GDPR");

      const unanswered = generatePolicyMarkdown(makeScanResult({}), makeConfig({ hasEuUkUsers: null, hasCaliforniaUsers: true }));
      expect(unanswered).toContain("[TO COMPLETE: whether this product has users in the EU/UK");
    });

    it("renders the California paragraph only when true, omits it when false, placeholders when unanswered", () => {
      const yes = generatePolicyMarkdown(makeScanResult({}), makeConfig({ hasCaliforniaUsers: true, hasEuUkUsers: false }));
      expect(yes).toContain("CCPA/CPRA");

      const unanswered = generatePolicyMarkdown(makeScanResult({}), makeConfig({ hasCaliforniaUsers: null, hasEuUkUsers: false }));
      expect(unanswered).toContain("[TO COMPLETE: whether this product has users in California");
    });

    it("renders one neutral line when both are false, instead of two omissions", () => {
      const markdown = generatePolicyMarkdown(makeScanResult({}), makeConfig({ hasEuUkUsers: false, hasCaliforniaUsers: false }));
      expect(markdown).toContain("has not declared users in jurisdictions with additional statutory privacy rights");
      expect(markdown).not.toContain("[TO COMPLETE: whether this product has users");
    });

    it("renders both placeholders when both are unanswered", () => {
      const markdown = generatePolicyMarkdown(makeScanResult({}), makeConfig());
      expect(markdown).toContain("[TO COMPLETE: whether this product has users in the EU/UK");
      expect(markdown).toContain("[TO COMPLETE: whether this product has users in California");
    });
  });

  describe("Children's Privacy", () => {
    it("renders collectsChildrensData true/false/null distinctly -- null is a placeholder, never 'no'", () => {
      const yes = generatePolicyMarkdown(makeScanResult({}), makeConfig({ collectsChildrensData: true }));
      expect(yes).toContain("knowingly collects personal data from children");

      const no = generatePolicyMarkdown(makeScanResult({}), makeConfig({ collectsChildrensData: false }));
      expect(no).toContain("does not knowingly collect personal data from children");

      const unanswered = generatePolicyMarkdown(makeScanResult({}), makeConfig({ collectsChildrensData: null }));
      expect(unanswered).toContain("[TO COMPLETE: whether this product knowingly collects personal data from children]");
      expect(unanswered).not.toContain("does not knowingly collect personal data from children");
    });

    it("renders the Scope bullet as 'not specified' (not 'no') when collectsChildrensData is null", () => {
      const markdown = generatePolicyMarkdown(makeScanResult({}), makeConfig({ collectsChildrensData: null }));
      expect(markdown).toContain("**Collects children's data:** not specified");
    });

    it("renders minimum age when supplied, a placeholder when not", () => {
      const answered = generatePolicyMarkdown(makeScanResult({}), makeConfig({ minimumAge: 13 }));
      expect(answered).toContain("Users must be at least 13 years old");

      const unanswered = generatePolicyMarkdown(makeScanResult({}), makeConfig());
      expect(unanswered).toContain("[TO COMPLETE: minimum age required to use this product, if any]");
    });
  });

  describe("Placeholders — Complete Before Publishing", () => {
    it("lists every unanswered field at the top of the document, after warnings and before the Generated-by line", () => {
      const markdown = generatePolicyMarkdown(makeScanResult({}), makeConfig());

      const summaryIndex = markdown.indexOf("## Placeholders — Complete Before Publishing");
      const generatedByIndex = markdown.indexOf("_Generated by SrcLawyer");
      const titleIndex = markdown.indexOf("# Privacy Policy");

      expect(summaryIndex).toBeGreaterThan(titleIndex);
      expect(summaryIndex).toBeLessThan(generatedByIndex);
      expect(markdown).toContain("- [TO COMPLETE: company or product name]");
    });

    it("is omitted entirely when every new field is answered", () => {
      const markdown = generatePolicyMarkdown(
        makeScanResult({}),
        makeConfig({
          companyName: "Acme",
          siteUrl: "https://acme.example",
          privacyContactEmail: "privacy@acme.example",
          hasEuUkUsers: false,
          hasCaliforniaUsers: false,
          sellsOrSharesData: false,
          usesDataForAdvertising: false,
          dataRetentionPolicy: "2 years",
          accountDeletionInstructions: "Email us",
          minimumAge: 13,
          sendsDataToAiServices: false,
          collectsChildrensData: false,
        })
      );

      expect(markdown).not.toContain("## Placeholders — Complete Before Publishing");
      expect(markdown).not.toContain("[TO COMPLETE:");
    });
  });
});

describe("generatePolicyMarkdown: workspace warning banner", () => {
  it("shows a banner at the top of the FILE when the workspace config was rejected", () => {
    const warning = "Workspace configuration in package.json was rejected (an entry is not a string); the default package locations (packages/*, apps/*) were scanned instead, so this scan may be incomplete.";
    const markdown = generatePolicyMarkdown(makeScanResult({ workspaceWarning: warning }), null);

    const bannerIndex = markdown.indexOf("WARNING: WORKSPACE CONFIGURATION REJECTED");
    expect(bannerIndex).toBeGreaterThan(markdown.indexOf("# Privacy Policy"));
    expect(bannerIndex).toBeLessThan(markdown.indexOf("## Scope"));
    expect(markdown).toContain("default package locations");
  });

  it("omits the banner when nothing was rejected", () => {
    expect(generatePolicyMarkdown(makeScanResult({ workspaceWarning: null }), null)).not.toContain("WORKSPACE CONFIGURATION REJECTED");
  });
});

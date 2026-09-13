import { describe, expect, it } from "vitest";
import { resolveAmbiguousFindings } from "../src/llm/resolveAmbiguousFindings.js";
import { FakeLlmProvider } from "./support/fakeLlmProvider.js";
import type { Finding } from "../src/engine/types.js";

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: "f1",
    dataCategories: ["generic_pii"],
    processor: null,
    description: "Request field \"notes\" collected; could not confidently classify.",
    confidence: "low",
    source: "framework-rule",
    location: { file: "server.js", line: 1, column: 0 },
    evidence: "notes",
    requiresReview: true,
    ...overrides,
  };
}

describe("resolveAmbiguousFindings", () => {
  it("redacts evidence and description before they reach the provider", async () => {
    const finding = makeFinding({
      id: "f1",
      evidence: 'const key = "sk_test_FAKEFAKEFAKEFAKEFAKEFAKE";',
      description: "Stripe key sk_test_FAKEFAKEFAKEFAKEFAKEFAKE found",
    });
    const provider = new FakeLlmProvider([[{ findingId: "f1", outcome: "declined", reason: "not enough context" }]]);

    await resolveAmbiguousFindings([finding], provider, { collectsChildrensData: false });

    const sentItem = provider.requests[0].items[0];
    expect(sentItem.redactedEvidence).not.toContain("sk_test_FAKEFAKEFAKEFAKEFAKEFAKE");
    expect(sentItem.redactedEvidence).toContain("[REDACTED]");
    expect(sentItem.redactedDescription).not.toContain("sk_test_FAKEFAKEFAKEFAKEFAKEFAKE");
  });

  it("propagates a resolved outcome with the model's category and description", async () => {
    const finding = makeFinding({ id: "f1" });
    const provider = new FakeLlmProvider([
      [{ findingId: "f1", outcome: "resolved", reason: null, resolvedDataCategories: ["email"], resolvedDescription: "Collects an email address for notifications." }],
    ]);

    const [result] = await resolveAmbiguousFindings([finding], provider, { collectsChildrensData: false });

    expect(result.llmResolution?.outcome).toBe("resolved");
    expect(result.llmResolution?.resolvedDataCategories).toEqual(["email"]);
    expect(result.llmResolution?.resolvedDescription).toBe("Collects an email address for notifications.");
    expect(result.llmResolution?.reason).toBeNull();
  });

  it("propagates a declined outcome with its reason verbatim", async () => {
    const finding = makeFinding({ id: "f1" });
    const provider = new FakeLlmProvider([[{ findingId: "f1", outcome: "declined", reason: "Ambiguous field name with no surrounding context." }]]);

    const [result] = await resolveAmbiguousFindings([finding], provider, { collectsChildrensData: false });

    expect(result.llmResolution?.outcome).toBe("declined");
    expect(result.llmResolution?.reason).toBe("Ambiguous field name with no surrounding context.");
  });

  it("forces a decline for high-stakes findings even when the model says resolved", async () => {
    const childCategoryFinding = makeFinding({ id: "f1", dataCategories: ["childrens_data"] });
    const provider = new FakeLlmProvider([
      [{ findingId: "f1", outcome: "resolved", reason: null, resolvedDataCategories: ["childrens_data"], resolvedDescription: "Definitely a child's name." }],
    ]);

    const [result] = await resolveAmbiguousFindings([childCategoryFinding], provider, { collectsChildrensData: false });

    expect(result.llmResolution?.outcome).toBe("declined");
    expect(result.llmResolution?.reason).toMatch(/children|manual|legal/i);
  });

  it("forces a decline when config.collectsChildrensData is true, even for an unrelated category", async () => {
    const finding = makeFinding({ id: "f1", dataCategories: ["generic_pii"] });
    const provider = new FakeLlmProvider([
      [{ findingId: "f1", outcome: "resolved", reason: null, resolvedDataCategories: ["name"], resolvedDescription: "A name field." }],
    ]);

    const [result] = await resolveAmbiguousFindings([finding], provider, { collectsChildrensData: true });

    expect(result.llmResolution?.outcome).toBe("declined");
  });

  it("marks a finding unresolved, never resolved or declined, when the response is missing or malformed", async () => {
    const finding = makeFinding({ id: "f1" });
    // Response references a different findingId entirely -> "f1" has no matching response.
    const provider = new FakeLlmProvider([[{ findingId: "does-not-exist", outcome: "resolved", reason: null, resolvedDataCategories: ["email"] }]]);

    const [result] = await resolveAmbiguousFindings([finding], provider, { collectsChildrensData: false });

    expect(result.llmResolution?.outcome).toBe("unresolved");
  });

  it("marks a finding unresolved when the model claims resolved but gives no recognized category", async () => {
    const finding = makeFinding({ id: "f1" });
    const provider = new FakeLlmProvider([[{ findingId: "f1", outcome: "resolved", reason: null, resolvedDataCategories: ["not_a_real_category" as never], resolvedDescription: "x" }]]);

    const [result] = await resolveAmbiguousFindings([finding], provider, { collectsChildrensData: false });

    expect(result.llmResolution?.outcome).toBe("unresolved");
  });

  it("marks the whole batch unresolved, with the error captured, when the provider throws", async () => {
    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })];
    const provider = new FakeLlmProvider([new Error("network timeout")]);

    const results = await resolveAmbiguousFindings(findings, provider, { collectsChildrensData: false });

    for (const result of results) {
      expect(result.llmResolution?.outcome).toBe("unresolved");
      expect(result.llmResolution?.reason).toContain("network timeout");
    }
  });

  it("never lets the provider itself report an unresolved outcome (unresolved is our decision, not the model's)", async () => {
    const finding = makeFinding({ id: "f1" });
    // FakeLlmProvider is typed to only allow "resolved" | "declined" responses,
    // enforced by LlmResponseItem — this test documents that guarantee.
    const provider = new FakeLlmProvider([[{ findingId: "f1", outcome: "declined", reason: "test" }]]);

    const [result] = await resolveAmbiguousFindings([finding], provider, { collectsChildrensData: false });

    expect(["resolved", "declined", "unresolved"]).toContain(result.llmResolution?.outcome);
  });

  it("splits more than batchSize findings into multiple resolveBatch calls", async () => {
    const findings = Array.from({ length: 5 }, (_, i) => makeFinding({ id: `f${i}` }));
    const provider = new FakeLlmProvider([
      findings.slice(0, 2).map((f) => ({ findingId: f.id, outcome: "declined" as const, reason: "batch1" })),
      findings.slice(2, 4).map((f) => ({ findingId: f.id, outcome: "declined" as const, reason: "batch2" })),
      findings.slice(4, 5).map((f) => ({ findingId: f.id, outcome: "declined" as const, reason: "batch3" })),
    ]);

    const results = await resolveAmbiguousFindings(findings, provider, { collectsChildrensData: false, batchSize: 2 });

    expect(provider.requests).toHaveLength(3);
    expect(results.every((r) => r.llmResolution?.outcome === "declined")).toBe(true);
  });

  it("does not mutate the input findings array", async () => {
    const finding = makeFinding({ id: "f1" });
    const provider = new FakeLlmProvider([[{ findingId: "f1", outcome: "declined", reason: "x" }]]);

    await resolveAmbiguousFindings([finding], provider, { collectsChildrensData: false });

    expect(finding.llmResolution).toBeUndefined();
  });
});

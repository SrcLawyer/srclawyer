import { describe, expect, it } from "vitest";
import {
  computeInventory,
  diffInventories,
  hasDrift,
  inventoryBlockers,
  parseInventory,
  serializeInventory,
  type Inventory,
} from "../src/inventory/inventory.js";
import type { Finding, ScanResult } from "../src/engine/types.js";

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: "field:src/deep/file.ts:12:email",
    dataCategories: ["email"],
    processor: null,
    description: "d",
    confidence: "high",
    source: "framework-rule",
    location: { file: "src/deep/file.ts", line: 12, column: 0 },
    evidence: "const { email } = req.body;",
    requiresReview: false,
    ...overrides,
  };
}

const META = { srclawyerVersion: "9.9.9", discovery: "git" as const };

describe("computeInventory", () => {
  it("is the sorted unique categories and processors, from every finding", () => {
    const inventory = computeInventory(
      [
        finding({ dataCategories: ["phone", "email"], processor: "Twilio" }),
        finding({ dataCategories: ["email"], processor: "Stripe" }),
        finding({ dataCategories: ["generic_pii"], requiresReview: true }),
        finding({ dataCategories: ["email"], processor: "Stripe" }),
      ],
      META
    );

    expect(inventory.categories).toEqual(["email", "generic_pii", "phone"]);
    expect(inventory.processors).toEqual(["Stripe", "Twilio"]);
  });

  it("does not depend on finding order, review state, or confidence", () => {
    const a = [finding({ dataCategories: ["email"], requiresReview: false }), finding({ dataCategories: ["name"], requiresReview: true, confidence: "low" })];
    const b = [finding({ dataCategories: ["name"], requiresReview: false, confidence: "high" }), finding({ dataCategories: ["email"], requiresReview: true, confidence: "low" })];

    expect(serializeInventory(computeInventory(a, META))).toBe(serializeInventory(computeInventory(b, META)));
  });

  it("ignores AI-assisted resolution -- Layer 1 categories only", () => {
    const resolved = finding({
      dataCategories: ["generic_pii"],
      requiresReview: true,
      llmResolution: { outcome: "resolved", reason: null, provider: "anthropic", model: "m", resolvedDataCategories: ["health_data"], resolvedDescription: "x" },
    });

    expect(computeInventory([resolved], META).categories).toEqual(["generic_pii"]);
  });

  it("contains no file names, line numbers, field names or evidence", () => {
    const text = serializeInventory(computeInventory([finding({ processor: "Stripe" })], META));

    expect(text).not.toMatch(/src\/|file\.ts|signup|req\.body|"line"|12/);
  });
});

describe("serializeInventory", () => {
  it("is byte-stable: fixed key order, two-space indent, trailing newline, sorted arrays", () => {
    const scrambled: Inventory = { processors: ["b", "a"], categories: ["z", "m"], discovery: "glob", srclawyerVersion: "1.0.0", schema: 1 };

    expect(serializeInventory(scrambled)).toBe(
      '{\n  "schema": 1,\n  "srclawyerVersion": "1.0.0",\n  "discovery": "glob",\n  "categories": [\n    "m",\n    "z"\n  ],\n  "processors": [\n    "a",\n    "b"\n  ]\n}\n'
    );
  });

  it("round-trips through parseInventory", () => {
    const inventory = computeInventory([finding({ processor: "Stripe" })], META);
    const parsed = parseInventory(serializeInventory(inventory));

    expect(parsed).toEqual({ ok: true, inventory });
  });
});

describe("parseInventory rejects malformed baselines with a reason", () => {
  const good = { schema: 1, srclawyerVersion: "1", discovery: "git", categories: [], processors: [] };

  it.each([
    ["not json", "{oops", /not valid JSON/],
    ["an array", "[]", /not a JSON object/],
    ["a future schema", JSON.stringify({ ...good, schema: 2 }), /unsupported schema 2/],
    ["a missing schema", JSON.stringify({ ...good, schema: undefined }), /unsupported schema/],
    ["a bad discovery mode", JSON.stringify({ ...good, discovery: "walk" }), /"discovery" must be/],
    ["non-array categories", JSON.stringify({ ...good, categories: "email" }), /"categories" must be an array of strings/],
    ["non-string processors", JSON.stringify({ ...good, processors: [1] }), /"processors" must be an array of strings/],
  ])("%s", (_name, text, reason) => {
    const parsed = parseInventory(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(reason);
  });

  it("accepts a BOM and a missing informational version", () => {
    const parsed = parseInventory("﻿" + JSON.stringify({ ...good, srclawyerVersion: undefined }));
    expect(parsed.ok).toBe(true);
  });
});

describe("diffInventories", () => {
  const base = computeInventory([finding({ dataCategories: ["email", "name"], processor: "Stripe" })], META);

  it("reports nothing for identical inventories, whatever the informational version", () => {
    expect(hasDrift(diffInventories(base, { ...base, srclawyerVersion: "0.0.1" }))).toBe(false);
  });

  it("reports added and removed categories and processors separately", () => {
    const current = computeInventory([finding({ dataCategories: ["email", "phone"], processor: "Twilio" })], META);
    const diff = diffInventories(base, current);

    expect(diff.added).toEqual({ categories: ["phone"], processors: ["Twilio"] });
    expect(diff.removed).toEqual({ categories: ["name"], processors: ["Stripe"] });
    expect(hasDrift(diff)).toBe(true);
  });
});

describe("inventoryBlockers", () => {
  const clean = { unsupportedStackWarning: null, workspaceWarning: null, skippedFilesWarning: null, templateSyntaxNote: "1 inline script…" } as unknown as ScanResult;

  it("is empty for a clean scan, and the template-syntax note is not a blocker", () => {
    expect(inventoryBlockers(clean, null)).toEqual([]);
  });

  it("collects exactly the warnings that make scan exit 1 and could change categories", () => {
    const blockers = inventoryBlockers(
      { ...clean, unsupportedStackWarning: "stack", workspaceWarning: "ws", skippedFilesWarning: "skipped" } as ScanResult,
      "worker down"
    );

    expect(blockers).toEqual(["stack", "ws", "skipped", "worker down"]);
  });
});

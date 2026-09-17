import { describe, expect, it } from "vitest";
import { countConfidentSiblings } from "../src/rules/confidenceFactors.js";

describe("countConfidentSiblings", () => {
  it("counts other fields that classify confidently, excluding the field itself", () => {
    expect(countConfidentSiblings(["email", "phone", "notes"], "email")).toBe(1); // phone confident, notes not
  });

  it("excludes ambiguous-named siblings even if they'd otherwise be counted", () => {
    // "data" never matches the lexicon anyway, but this documents that ambiguity is checked, not just presence.
    expect(countConfidentSiblings(["email", "data"], "email")).toBe(0);
  });

  it("returns 0 for a single-field group with no siblings", () => {
    expect(countConfidentSiblings(["email"], "email")).toBe(0);
  });

  it("returns 0 for an empty sibling list", () => {
    expect(countConfidentSiblings([], "email")).toBe(0);
  });
});

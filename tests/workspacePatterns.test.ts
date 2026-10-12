import { describe, expect, it } from "vitest";
import { validateWorkspacePatterns, MAX_PATTERN_LENGTH, MAX_WORKSPACE_PATTERNS } from "../src/engine/workspacePatterns.js";

function rejected(raw: unknown): string {
  const result = validateWorkspacePatterns(raw);
  if (result.ok) throw new Error(`expected rejection, got ok for ${JSON.stringify(raw)?.slice(0, 80)}`);
  return result.reason;
}

describe("validateWorkspacePatterns: accepts legitimate patterns", () => {
  it.each([
    ["packages/*"],
    ["apps/*"],
    ["{apps,packages}/*"],
    ["packages/**"],
    ["tools/*/packages/*"],
    ["!packages/ignored"],
    ["apps/*", "packages/**", "!packages/ignored", "{tools,apps}/*"],
    ["packages/{a,b,c}/src"],
    ["pkg-{1..5}"],
  ])("%s", (...patterns) => {
    expect(validateWorkspacePatterns(patterns)).toEqual({ ok: true, patterns });
  });
});

describe("validateWorkspacePatterns: rejects hostile or malformed input", () => {
  it("the 37-character cartesian range pattern", () => {
    expect(rejected(["{1..300}{1..300}{1..300}"])).toMatch(/brace expansion/);
  });

  it("small ranges whose product is still too wide", () => {
    expect(rejected(["{1..10}{1..10}{1..10}"])).toMatch(/brace expansion/);
  });

  it("deep nesting, including the 4,990-deep case under braces' own length limit", () => {
    expect(rejected(["{{{a}}}"])).toMatch(/nesting/);
    expect(rejected(["{".repeat(4990) + "a" + "}".repeat(4990)])).toMatch(/longer than/);
  });

  it("too many brace groups", () => {
    expect(rejected(["{a,b}{c,d}{e,f}{g,h}"])).toMatch(/brace groups/);
  });

  it("unbalanced braces", () => {
    expect(rejected(["{a,b"])).toMatch(/unbalanced/);
    expect(rejected(["a,b}"])).toMatch(/unbalanced/);
  });

  it("over-long patterns and too many patterns", () => {
    expect(rejected(["a/".repeat(MAX_PATTERN_LENGTH) + "*"])).toMatch(/longer than/);
    expect(rejected(Array.from({ length: MAX_WORKSPACE_PATTERNS + 1 }, (_, i) => `p${i}/*`))).toMatch(/more than/);
  });

  it("'..' segments, including behind a negation", () => {
    expect(rejected(["../*"])).toMatch(/escapes/);
    expect(rejected(["packages/../../*"])).toMatch(/escapes/);
    expect(rejected(["!../x"])).toMatch(/escapes/);
  });

  it("absolute paths, POSIX and Windows-style", () => {
    expect(rejected(["/etc/*"])).toMatch(/absolute/);
    expect(rejected(["C:/Users/*"])).toMatch(/absolute/);
    expect(rejected(["!/etc/*"])).toMatch(/absolute/);
  });

  it("non-array containers", () => {
    for (const raw of [5, "packages/*", { packages: ["a"] }, true]) expect(rejected(raw)).toMatch(/not an array/);
  });

  it("non-string and empty entries", () => {
    expect(rejected([1])).toMatch(/not a string/);
    expect(rejected([null])).toMatch(/not a string/);
    expect(rejected([["packages/*"]])).toMatch(/not a string/);
    expect(rejected([""])).toMatch(/empty/);
  });

  it("backslashes, NUL bytes, and a doubled negation", () => {
    expect(rejected(["packages\\*"])).toMatch(/backslash/);
    expect(rejected(["packages/\0"])).toMatch(/NUL/);
    expect(rejected(["!!packages/*"])).toMatch(/leading/);
  });
});

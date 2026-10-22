import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTION,
  buildChangeLines,
  describeBaselineChange,
  fingerprintOf,
  firstReviewLines,
  renderComment,
  renderIssue,
  renderRunSummary,
} from "../src/report/reviewText.js";
import { buildSummary } from "../src/policy/reviewFile.js";

const CATALOG = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "question-catalog.md"), "utf8");
const PLAIN = CATALOG.replace(/\*\*/g, "");

/** The markdown block that follows a worked-example label in section 7.7. */
function example(label: string): string {
  const start = CATALOG.indexOf(label);
  expect(start, label).toBeGreaterThan(-1);
  const open = CATALOG.indexOf("```markdown\n", start) + "```markdown\n".length;
  return CATALOG.slice(open, CATALOG.indexOf("\n```", open)) + "\n";
}

const COVERAGE_212 =
  "Coverage: scanned 212 files (git discovery) for personal data read from requests in JavaScript/TypeScript (Express, Next.js) and Python (Flask), and for 18 known third-party services. Not covered: other languages and frameworks, calls to third-party services made with plain HTTP, scripts your pages load at runtime, and data handled outside this repository.";
const ctx = { target: "srclawyer@0.10.0", coverage: COVERAGE_212, runLink: null };
const diff = { added: { categories: ["phone"], processors: ["Twilio"] }, removed: { categories: [], processors: [] } };

describe("the rendered text is the text in docs/question-catalog.md section 7.7", () => {
  it("case A (one new service, one question) matches the worked example exactly", () => {
    const view = {
      kind: "drift" as const,
      changes: buildChangeLines(diff, false, { bold: true, onlyKnown: true }),
      questions: [{ ask: "Do you have users in the European Union or the United Kingdom?", sensitive: true }],
      baselineChanged: false,
    };
    expect(renderComment(view, ctx)).toBe(example("**Case A**, one new service"));
  });

  it("case C (a pull request that records changes as reviewed) matches the worked example, apart from the abbreviated coverage line", () => {
    const change = describeBaselineChange(
      JSON.stringify({ schema: 1, discovery: "git", categories: [], processors: [] }),
      JSON.stringify({ schema: 1, discovery: "git", categories: ["phone"], processors: ["Twilio"] })
    )!;
    expect(renderComment({ kind: "baseline-changed", change }, { ...ctx, coverage: "Coverage: (as above)" })).toBe(example("**Case C**, a pull request"));
  });
});

describe("every Action sentence is in the catalog", () => {
  it.each(Object.entries(ACTION))("%s", (_key, sentence) => {
    expect(CATALOG.includes(sentence) || PLAIN.includes(sentence), sentence).toBe(true);
  });
});

describe("change lines", () => {
  it("bold the names for GitHub, keep the approved sentences, and use the children line without bold", () => {
    const lines = buildChangeLines({ added: { categories: ["childrens_data", "ip_address"], processors: ["Twilio"] }, removed: { categories: ["email"], processors: ["Stripe"] } }, false, { bold: true });
    expect(lines).toEqual([
      "Your code now uses **Twilio**.",
      "Your code now appears to handle information that may relate to children.",
      "Your code now appears to handle **IP addresses**.",
      "Your code no longer uses **Stripe**.",
      "The scanner no longer finds **email addresses**.",
    ]);
  });

  it("the plain summary is unchanged by sharing the code", () => {
    expect(buildSummary({ diff, questionCount: 2, blankCount: 0 })).toEqual([
      "Your code now uses Twilio.",
      "Your code now appears to handle phone numbers.",
      "2 questions need your answers.",
      "Nothing has been published or committed.",
    ]);
  });

  it("names that are not in SrcLawyer's tables are replaced when onlyKnown is set", () => {
    const hostile = { added: { categories: [], processors: [] }, removed: { categories: ["[x](https://evil.example)"], processors: ["<img src=x>"] } };
    expect(buildChangeLines(hostile, false, { bold: true, onlyKnown: true }).join("\n")).not.toMatch(/evil|<img/);
    expect(buildChangeLines(hostile, false).join("\n")).toContain("evil.example");
  });
});

describe("baseline change", () => {
  const inv = (processors: string[], categories: string[], extra: object = {}) => JSON.stringify({ schema: 1, discovery: "git", processors, categories, ...extra });

  it("lists services and kinds of data added and removed, in lower case, joined as sentences", () => {
    const change = describeBaselineChange(inv(["Stripe", "Sentry"], ["payment_info", "ip_address"]), inv(["Twilio", "Mixpanel", "Sentry"], ["phone", "ip_address", "email"]))!;
    expect(change).toEqual({ servicesAdded: "Mixpanel and Twilio", dataAdded: "email addresses and phone numbers", servicesRemoved: "Stripe", dataRemoved: "payment information" });
  });

  it("is all empty when only the approval record changed, and never carries the note", () => {
    const change = describeBaselineChange(inv(["Twilio"], ["phone"]), inv(["Twilio"], ["phone"], { approval: { review: "r", note: "yes [x](https://evil.example)" } }))!;
    expect(change).toEqual({ servicesAdded: "", dataAdded: "", servicesRemoved: "", dataRemoved: "" });
  });

  it("shows names it does not know as one unrecognized item, and returns null for an unreadable baseline", () => {
    const change = describeBaselineChange(inv([], []), inv(["Nope A", "Nope B", "Twilio"], ["zzz"]))!;
    expect(change.servicesAdded).toBe("Twilio and a service this version of SrcLawyer doesn't recognize");
    expect(change.dataAdded).toBe("a kind of data this version of SrcLawyer doesn't recognize");
    expect(describeBaselineChange("not json", inv([], []))).toBeNull();
  });
});

describe("first review, issue and summary", () => {
  it("reads the found items from the baseline and fingerprints them", () => {
    const found = firstReviewLines(JSON.stringify({ schema: 1, discovery: "git", processors: ["Twilio"], categories: ["phone"] }))!;
    expect(found.lines).toEqual(["Your code uses **Twilio**.", "Your code appears to handle **phone numbers**."]);
    expect(fingerprintOf(found.items)).toMatch(/^[0-9a-f]{12}$/);
    expect(fingerprintOf(["b", "a"])).toBe(fingerprintOf(["a", "b"]));
    expect(firstReviewLines(JSON.stringify({ schema: 1, discovery: "git", processors: [], categories: [] }))!.lines).toEqual(["The scanner found no personal data or third-party services in your code."]);
  });

  it("the issue carries both hidden lines on drift and a fingerprint-less marker on 'no new items'; other cases write none", () => {
    const view = { kind: "drift" as const, changes: ["x"], questions: [], baselineChanged: false };
    expect(renderIssue(view, ctx, "abcdef012345")!.split("\n").slice(0, 2)).toEqual(["<!-- srclawyer-drift-check -->", "<!-- srclawyer-fingerprint:abcdef012345 -->"]);
    expect(renderIssue({ kind: "no-drift" }, ctx, "")!).not.toContain("fingerprint");
    expect(renderIssue({ kind: "inconclusive", reasons: [] }, ctx, "")).toBeNull();
    expect(renderComment({ kind: "first-review", lines: [], questions: [] }, ctx)).toBeNull();
  });

  it("the run summary has no hidden lines, mentions artifacts only when there are some, and puts the fork sentence first", () => {
    const view = { kind: "no-drift" as const };
    const plain = renderRunSummary(view, ctx, { issueText: false, artifacts: false, fork: false });
    expect(plain).not.toContain("<!--");
    expect(plain).not.toContain("artifact");
    const withAll = renderRunSummary(view, ctx, { issueText: false, artifacts: true, fork: true });
    expect(withAll.startsWith(ACTION.fork)).toBe(true);
    expect(withAll).toContain(ACTION.artifacts);
  });
});

import { describe, expect, it } from "vitest";
import { triggeredQuestions, joinNames, unansweredQuestions, isAnswered, currentAnswerWord, QUESTION_BY_ID } from "../src/assistant/questions.js";
import { coverageLine, knownServiceCount, unsupportedStackName } from "../src/report/coverage.js";
import { buildSummary, renderReviewFile } from "../src/policy/reviewFile.js";
import { lowerLabel, categoryLabel } from "../src/assistant/labels.js";
import { extractPlaceholders, generatePolicyMarkdown } from "../src/policy/generatePolicy.js";
import { DEFAULT_CONFIG } from "../src/config/config.js";

const noScan = { filesScanned: 212, unsupportedStackWarning: null, skippedFiles: [], templateSyntaxNote: null };

describe("coverageLine", () => {
  it("standard", () => {
    expect(coverageLine({ scan: noScan, discovery: "git", aiReviewOn: false })).toBe(
      `Coverage: scanned 212 files (git discovery) for personal data read from requests in JavaScript/TypeScript (Express, Next.js) and Python (Flask), and for ${knownServiceCount()} known third-party services. Not covered: other languages and frameworks, calls to third-party services made with plain HTTP, scripts your pages load at runtime, and data handled outside this repository. AI-assisted review is off.`
    );
  });
  it("uses 'file-system' for the ordinary walk and singular forms", () => {
    const line = coverageLine({ scan: { ...noScan, filesScanned: 1, skippedFiles: [{ file: "a", reason: "oversized" }] }, discovery: "glob", aiReviewOn: true });
    expect(line).toContain("scanned 1 file (file-system discovery)");
    expect(line).toContain(" 1 file was skipped (too large or unreadable).");
    expect(line).not.toContain("AI-assisted review is off");
  });
  it("names an unsupported stack instead of claiming coverage", () => {
    const warning = "UNSUPPORTED CODEBASE — FastAPI detected (a `fastapi` import was found) — FastAPI support isn't built yet. SrcLawyer only analyzes ...";
    expect(unsupportedStackName(warning)).toBe("FastAPI");
    const line = coverageLine({ scan: { ...noScan, unsupportedStackWarning: warning }, discovery: "git", aiReviewOn: false });
    expect(line).toBe(`Coverage: this project's main stack (FastAPI) isn't supported yet, so request data in it was not scanned. SrcLawyer did scan for ${knownServiceCount()} known third-party services. AI-assisted review is off.`);
  });
  it("adds the template-syntax note and counts skipped files without template-syntax entries", () => {
    const line = coverageLine({
      scan: { ...noScan, templateSyntaxNote: "x", skippedFiles: [{ file: "t.html", reason: "template-syntax" }, { file: "b.js", reason: "unreadable" }, { file: "c.js", reason: "parse-failed" }] },
      discovery: "git",
      aiReviewOn: true,
    });
    expect(line).toContain(" 2 files were skipped (too large or unreadable).");
    expect(line).toContain(" Some HTML files contain template syntax, which is not analyzed.");
  });
});

describe("labels", () => {
  it("lower-cases the first letter but keeps an acronym", () => {
    expect(lowerLabel("email")).toBe("email addresses");
    expect(lowerLabel("ip_address")).toBe("IP addresses");
    expect(lowerLabel("childrens_data")).toBe("children's data");
    expect(categoryLabel("something_new")).toBe("something_new");
  });
});

describe("triggeredQuestions (catalog section 1.2)", () => {
  const base = { addedCategories: [], addedCategoryLabels: [], addedProcessors: [] };
  const ids = (t: ReturnType<typeof triggeredQuestions>) => t.map((x) => x.def.id);

  it("an AI provider asks the AI question with the vendor names", () => {
    const t = triggeredQuestions({ ...base, addedProcessors: [{ name: "OpenAI", tags: ["ai"] }, { name: "Anthropic", tags: ["ai"] }] });
    expect(ids(t)).toEqual(["dataRetentionPolicy", "sendsDataToAiServices"]);
    expect(t.find((x) => x.def.id === "sendsDataToAiServices")!.why).toBe(
      "Your code now uses OpenAI and Anthropic. A privacy policy should say whether user content is shared with AI providers."
    );
  });
  it("analytics asks the EU/UK and California questions; advertising asks sell/share and ads", () => {
    const a = triggeredQuestions({ ...base, addedProcessors: [{ name: "PostHog", tags: ["analytics"] }] });
    expect(ids(a)).toEqual(expect.arrayContaining(["hasEuUkUsers", "hasCaliforniaUsers"]));
    const m = triggeredQuestions({ ...base, addedProcessors: [{ name: "AdCo", tags: ["advertising"] }] });
    expect(ids(m)).toEqual(expect.arrayContaining(["sellsOrSharesData", "usesDataForAdvertising"]));
  });
  it("monitoring counts like analytics", () => {
    expect(ids(triggeredQuestions({ ...base, addedProcessors: [{ name: "Sentry", tags: ["monitoring"] }] }))).toContain("hasEuUkUsers");
  });
  it("children's data asks the children and minimum-age questions", () => {
    const t = triggeredQuestions({ ...base, addedCategories: ["childrens_data"], addedCategoryLabels: ["children's data"] });
    expect(ids(t)).toEqual(expect.arrayContaining(["collectsChildrensData", "minimumAge", "dataRetentionPolicy"]));
  });
  it("account data asks about deletion; other data does not", () => {
    expect(ids(triggeredQuestions({ ...base, addedCategories: ["email"], addedCategoryLabels: ["email addresses"] }))).toContain("accountDeletionInstructions");
    expect(ids(triggeredQuestions({ ...base, addedCategories: ["phone"], addedCategoryLabels: ["phone numbers"] }))).not.toContain("accountDeletionInstructions");
  });
  it("the retention question has three variants", () => {
    const why = (t: Partial<typeof base>) => triggeredQuestions({ ...base, ...t }).find((x) => x.def.id === "dataRetentionPolicy")!.why;
    expect(why({ addedCategories: ["phone"], addedCategoryLabels: ["phone numbers"] })).toBe("Your code now appears to handle phone numbers. Please check that your policy says how long that data is kept.");
    expect(why({ addedProcessors: [{ name: "Twilio", tags: [] }] })).toBe("Your code now uses Twilio. Please check that your policy says how long that data is kept.");
    expect(why({ addedCategories: ["phone"], addedCategoryLabels: ["phone numbers"], addedProcessors: [{ name: "Twilio", tags: [] }] })).toContain("or uses Twilio");
  });
  it("asks nothing when nothing was added", () => {
    expect(triggeredQuestions(base)).toEqual([]);
  });
  it("joinNames", () => {
    expect([joinNames([]), joinNames(["A"]), joinNames(["A", "B"]), joinNames(["A", "B", "C"])]).toEqual(["", "A", "A and B", "A, B and C"]);
  });
});

describe("answers", () => {
  it("tells answered from unanswered, including minimumAge 0 ('no minimum')", () => {
    expect(isAnswered(QUESTION_BY_ID.get("minimumAge")!, { ...DEFAULT_CONFIG, minimumAge: 0 })).toBe(true);
    expect(isAnswered(QUESTION_BY_ID.get("minimumAge")!, DEFAULT_CONFIG)).toBe(false);
    expect(isAnswered(QUESTION_BY_ID.get("collectsChildrensData")!, { ...DEFAULT_CONFIG, collectsChildrensData: false })).toBe(true);
    expect(currentAnswerWord(QUESTION_BY_ID.get("hasEuUkUsers")!, { ...DEFAULT_CONFIG, hasEuUkUsers: true })).toBe("yes");
    expect(currentAnswerWord(QUESTION_BY_ID.get("companyName")!, { ...DEFAULT_CONFIG, companyName: "Acme" })).toBe("answered");
    expect(unansweredQuestions(null).length).toBe(15);
  });
});

describe("summary and review file", () => {
  const diff = { added: { categories: ["phone", "childrens_data", "ip_address"], processors: ["Twilio"] }, removed: { categories: ["location"], processors: ["Mixpanel"] } };

  it("buildSummary uses the approved sentences", () => {
    expect(buildSummary({ diff, questionCount: 1, blankCount: 3 })).toEqual([
      "Your code now uses Twilio.",
      "Your code now appears to handle phone numbers.",
      "Your code now appears to handle information that may relate to children.",
      "Your code now appears to handle IP addresses.",
      "Your code no longer uses Mixpanel.",
      "The scanner no longer finds location data.",
      "1 question needs your answer.",
      "3 blanks in your policy still need filling in, so it can't be marked ready to publish yet.",
      "Nothing has been published or committed.",
    ]);
    expect(buildSummary({ diff: { added: { categories: [], processors: [] }, removed: { categories: [], processors: [] } }, questionCount: 2, blankCount: 1 })).toEqual([
      "2 questions need your answers.",
      "1 blank in your policy still needs filling in, so it can't be marked ready to publish yet.",
      "Nothing has been published or committed.",
    ]);
  });

  it("renderReviewFile golden", () => {
    const text = renderReviewFile({
      coverage: "Coverage: X.",
      diff: { added: { categories: ["phone", "health_data"], processors: ["Twilio"] }, removed: { categories: [], processors: ["Mixpanel"] } },
      questions: [
        {
          def: QUESTION_BY_ID.get("dataRetentionPolicy")!,
          why: "Why text.",
          currentAnswer: "not answered",
        },
      ],
    });
    expect(text).toBe(
      [
        "# Privacy policy review",
        "",
        "_This is automated analysis, not legal advice. It lists what the scanner found. It does not say that your product or your policy is compliant._",
        "",
        "Coverage: X.",
        "",
        "## What changed since your last approved review",
        "",
        "### New kinds of personal data",
        "- Phone numbers",
        "- Health data",
        "",
        "### New third-party services",
        "- Twilio",
        "",
        "### No longer found",
        "- Mixpanel",
        "",
        "## Suggested wording",
        "",
        "Check that each line is accurate for how you really use the service or data before you use it.",
        "",
        "- **Twilio** — SMS/voice communications provider. Processes phone numbers.",
        "- We collect phone numbers.",
        "- Health data: this is a sensitive kind of data. SrcLawyer doesn't suggest wording for it. Write this part yourself, ideally with legal advice.",
        "",
        "## Check these",
        "",
        "- Check whether your policy still mentions Mixpanel. The scanner no longer finds it in your code. If you no longer collect or use it, you can remove it from the policy.",
        "",
        "## Questions to answer",
        "",
        `1. ${QUESTION_BY_ID.get("dataRetentionPolicy")!.ask}`,
        "   Why: Why text.",
        "   Current answer: not answered",
        "",
        "## When you are done",
        "",
        "Update your policy, then record your approval with your assistant, or run `srclawyer scan --write-inventory` and commit `.srclawyer.inventory.json`.",
        "",
      ].join("\n")
    );
  });

  it("omits sections that have no items", () => {
    const text = renderReviewFile({ coverage: "C.", diff: { added: { categories: [], processors: ["Twilio"] }, removed: { categories: [], processors: [] } }, questions: [] });
    expect(text).not.toContain("### New kinds of personal data");
    expect(text).not.toContain("### No longer found");
    expect(text).not.toContain("## Check these");
    expect(text).not.toContain("## Questions to answer");
    expect(text).toContain("### New third-party services");
  });
});

describe("extractPlaceholders", () => {
  it("lists the blank labels from a generated policy and is empty when everything is answered", () => {
    const result = { projects: [], findings: [], ambiguousCount: 0, filesScanned: 0, unsupportedStackWarning: null, workspaceWarning: null, skippedFiles: [], skippedFilesWarning: null, templateSyntaxNote: null, pendingZodCandidates: [], oversizedZodFiles: [], maxZodFragmentBytes: 0 };
    const blank = extractPlaceholders(generatePolicyMarkdown(result, DEFAULT_CONFIG));
    expect(blank).toContain("company or product name");
    expect(blank.length).toBe(12 - 0);
    const full = {
      ...DEFAULT_CONFIG, companyName: "A", siteUrl: "https://a.test", privacyContactEmail: "a@a.test", hasEuUkUsers: false, hasCaliforniaUsers: false, sellsOrSharesData: false,
      usesDataForAdvertising: false, dataRetentionPolicy: "x", accountDeletionInstructions: "y", minimumAge: 13, sendsDataToAiServices: false, collectsChildrensData: false,
    };
    expect(extractPlaceholders(generatePolicyMarkdown(result, full))).toEqual([]);
  });
});

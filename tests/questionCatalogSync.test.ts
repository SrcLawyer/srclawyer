import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IF_UNSURE_BLOCKING,
  IF_UNSURE_NON_BLOCKING,
  QUESTION_DEFS,
  TRIGGER_WHY_TEMPLATES,
} from "../src/assistant/questions.js";
import * as W from "../src/assistant/wording.js";

const DOC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "question-catalog.md"), "utf8");

function strings(group: Record<string, unknown>): string[] {
  return Object.values(group).filter((v): v is string => typeof v === "string");
}

// The reviewed document is the source of truth: every sentence the code can say must be in it verbatim.
describe("docs/question-catalog.md matches the code", () => {
  it("contains every question's ask, why and explain", () => {
    for (const q of QUESTION_DEFS) {
      expect(DOC, `${q.id} ask`).toContain(q.ask);
      expect(DOC, `${q.id} why`).toContain(q.why);
      if (q.explain) expect(DOC, `${q.id} explain`).toContain(q.explain);
    }
  });

  it("has an explain text for exactly the sensitive questions", () => {
    const sensitive = QUESTION_DEFS.filter((q) => q.sensitive).map((q) => q.id).sort();
    expect(sensitive).toEqual(["collectsChildrensData", "hasCaliforniaUsers", "hasEuUkUsers", "sellsOrSharesData", "sendsDataToAiServices", "usesDataForAdvertising"].sort());
    for (const q of QUESTION_DEFS) expect(Boolean(q.explain), q.id).toBe(q.sensitive);
  });

  it("contains the if-unsure sentences and the triggered why templates", () => {
    expect(DOC).toContain(IF_UNSURE_BLOCKING);
    expect(DOC).toContain(IF_UNSURE_NON_BLOCKING);
    for (const t of TRIGGER_WHY_TEMPLATES) expect(DOC, t).toContain(t);
  });

  it("contains the first-review wording", () => {
    for (const text of strings(W.FIRST_REVIEW)) expectInDoc(text);
  });

  it("the Action's copy of the no-drift statement is the approved sentence", () => {
    const run = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "action", "run.mjs"), "utf8");
    expect(run).toContain(W.NO_DRIFT_STATEMENT);
  });

  it("contains the no-drift statement, coverage, summary, review-file and command wording", () => {
    for (const group of [W.SUMMARY, W.REVIEW, W.COMMAND, W.PUBLISHABLE, W.STATUS, W.OPTION_LABELS]) {
      for (const text of strings(group)) expect(DOC, text).toContain(text);
    }
    for (const text of strings(W.STATUS_TEXT)) expect(DOC, text).toContain(text.replace(/:$/, ""));
    for (const text of [W.NO_DRIFT_STATEMENT, W.CHECK_NO_DRIFT_LINE, W.COVERAGE_STANDARD, W.COVERAGE_UNSUPPORTED, W.COVERAGE_SKIPPED, W.COVERAGE_TEMPLATE_SYNTAX, W.COVERAGE_AI_OFF]) {
      expect(DOC, text).toContain(text);
    }
  });
});

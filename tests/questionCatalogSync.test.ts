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
import { RULES_END, SKILL_TEXT, rulesBlock, CLAUDE_ASK_RULES } from "../src/assistant/agentText.js";
import { GENERATED_FOOTER, GENERATED_HEADER_COMMENT, NO_MINIMUM_AGE_SENTENCE } from "../src/policy/generatePolicy.js";

const RAW = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "question-catalog.md"), "utf8");
// Bold markers in the document are formatting, not wording, so a sentence may match with or without them.
const PLAIN = RAW.replace(/\*\*/g, "");
const DOC = { includes: (text: string) => RAW.includes(text) || PLAIN.includes(text) };
const expectInDoc = (text: string, label = text) => expect(DOC.includes(text), `not found in docs/question-catalog.md: ${label}`).toBe(true);

function strings(group: Record<string, unknown>): string[] {
  return Object.values(group).filter((v): v is string => typeof v === "string");
}

// The reviewed document is the source of truth: every sentence the code can say must be in it verbatim.
describe("docs/question-catalog.md matches the code", () => {
  it("contains every question's ask, why and explain", () => {
    for (const q of QUESTION_DEFS) {
      expectInDoc(q.ask, `${q.id} ask`);
      expectInDoc(q.why, `${q.id} why`);
      if (q.explain) expectInDoc(q.explain, `${q.id} explain`);
    }
  });

  it("has an explain text for exactly the sensitive questions", () => {
    const sensitive = QUESTION_DEFS.filter((q) => q.sensitive).map((q) => q.id).sort();
    expect(sensitive).toEqual(["collectsChildrensData", "hasCaliforniaUsers", "hasEuUkUsers", "sellsOrSharesData", "sendsDataToAiServices", "usesDataForAdvertising"].sort());
    for (const q of QUESTION_DEFS) expect(Boolean(q.explain), q.id).toBe(q.sensitive);
  });

  it("contains the if-unsure sentences and the triggered why templates", () => {
    expectInDoc(IF_UNSURE_BLOCKING);
    expectInDoc(IF_UNSURE_NON_BLOCKING);
    for (const t of TRIGGER_WHY_TEMPLATES) expectInDoc(t, t);
  });

  it("contains the generated-mode wording: backup note, file choices and policy-text questions", () => {
    for (const group of [W.POLICY_FILE_OPTION_LABELS, W.POLICY_TEXT_QUESTIONS, W.POLICY_FILE_QUESTION]) for (const text of strings(group)) expectInDoc(text, text);
    expectInDoc(W.BACKUP_NOTE);
    expectInDoc(GENERATED_HEADER_COMMENT);
    expectInDoc(GENERATED_FOOTER);
    expectInDoc(NO_MINIMUM_AGE_SENTENCE);
    expectInDoc("Last updated: {value}");
  });

  it("contains the assistant instructions exactly as they are written into a project", () => {
    expectInDoc(rulesBlock("0.9.0"), "rules block");
    expectInDoc(SKILL_TEXT, "skill");
    expect(rulesBlock("0.9.0").endsWith(RULES_END)).toBe(true);
    for (const text of strings(W.AGENT_SETUP)) expectInDoc(text);
    for (const rule of CLAUDE_ASK_RULES) expectInDoc(rule);
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
      for (const text of strings(group)) expectInDoc(text, text);
    }
    for (const text of strings(W.STATUS_TEXT)) expectInDoc(text.replace(/:$/, ""), text);
    for (const text of [W.NO_DRIFT_STATEMENT, W.CHECK_NO_DRIFT_LINE, W.COVERAGE_STANDARD, W.COVERAGE_UNSUPPORTED, W.COVERAGE_SKIPPED, W.COVERAGE_TEMPLATE_SYNTAX, W.COVERAGE_AI_OFF]) {
      expectInDoc(text, text);
    }
  });
});

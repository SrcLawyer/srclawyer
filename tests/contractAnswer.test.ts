import { describe, expect, it, vi, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AnswerError, answerReport, parseAnswer, validateNote } from "../src/commands/answer.js";
import { QUESTION_BY_ID } from "../src/assistant/questions.js";
import { loadConfig, writeConfig, DEFAULT_CONFIG } from "../src/config/config.js";
import { readDeferred } from "../src/assistant/stateDir.js";
import { tempDir } from "./support/gitFixture.js";

const dirs: string[] = [];
const fresh = () => {
  const d = tempDir();
  dirs.push(d);
  writeConfig(d, { ...DEFAULT_CONFIG });
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const def = (id: string) => QUESTION_BY_ID.get(id)!;
const answer = (root: string, id: string, value: string, note?: string) => answerReport(root, { inventoryPath: ".srclawyer.inventory.json", id, value, note, json: true });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof AnswerError ? e.code : "other";
  }
  return null;
};

describe("parseAnswer", () => {
  it("yes/no accepts true/false/yes/no and unsure, nothing else", () => {
    expect(parseAnswer(def("hasEuUkUsers"), "true")).toEqual({ kind: "value", value: true });
    expect(parseAnswer(def("hasEuUkUsers"), "No")).toEqual({ kind: "value", value: false });
    expect(parseAnswer(def("hasEuUkUsers"), "unsure")).toEqual({ kind: "unsure" });
    expect(parseAnswer(def("hasEuUkUsers"), "I'm not sure")).toEqual({ kind: "unsure" });
    expect(code(() => parseAnswer(def("hasEuUkUsers"), "maybe"))).toBe("invalid-value");
    expect(code(() => parseAnswer(def("hasEuUkUsers"), ""))).toBe("invalid-value");
  });

  it("yes, no, y and n, in any case, are aliases for true and false on every yes/no question, and only there", () => {
    for (const id of ["hasEuUkUsers", "service.supabase.auth"]) {
      for (const yes of ["yes", "YES", "Yes", "y", "Y", "true", "TRUE"]) expect(parseAnswer(def(id), yes), `${id} ${yes}`).toEqual({ kind: "value", value: true });
      for (const no of ["no", "NO", "No", "n", "N", "false", "False"]) expect(parseAnswer(def(id), no), `${id} ${no}`).toEqual({ kind: "value", value: false });
      for (const bad of ["yep", "ye", "nope", "yes please", "y,n", "1", "0", "t", "f", " yes no"]) expect(code(() => parseAnswer(def(id), bad)), `${id} ${bad}`).toBe("invalid-value");
    }
    // Not a yes/no question: "y" and "n" are just text or just invalid.
    expect(code(() => parseAnswer(def("minimumAge"), "y"))).toBe("invalid-value");
    expect(parseAnswer(def("companyName"), "N")).toEqual({ kind: "value", value: "N" });
  });

  it("minimum age accepts 1-120, 'none' (stored as 0) and unsure", () => {
    expect(parseAnswer(def("minimumAge"), "13")).toEqual({ kind: "value", value: 13 });
    expect(parseAnswer(def("minimumAge"), "none")).toEqual({ kind: "value", value: 0 });
    expect(parseAnswer(def("minimumAge"), "No minimum")).toEqual({ kind: "value", value: 0 });
    for (const bad of ["0", "121", "-1", "13.5", "thirteen", "1e2"]) expect(code(() => parseAnswer(def("minimumAge"), bad)), bad).toBe("invalid-value");
  });

  it("text fields reject empty, long, multi-line and control-character answers", () => {
    expect(parseAnswer(def("companyName"), "  Acme Inc.  ")).toEqual({ kind: "value", value: "Acme Inc." });
    expect(code(() => parseAnswer(def("companyName"), "   "))).toBe("invalid-value");
    expect(code(() => parseAnswer(def("companyName"), "x".repeat(501)))).toBe("invalid-value");
    expect(code(() => parseAnswer(def("companyName"), "line one\nline two"))).toBe("invalid-value");
    expect(code(() => parseAnswer(def("companyName"), "tab\there"))).toBe("invalid-value");
    expect(code(() => parseAnswer(def("companyName"), "nul\u0000byte"))).toBe("invalid-value");
  });

  it("validates the contact email and the site address", () => {
    expect(parseAnswer(def("privacyContactEmail"), "privacy@example.com")).toEqual({ kind: "value", value: "privacy@example.com" });
    for (const bad of ["privacy", "a@b", "a b@c.com", "<a@b.com>"]) expect(code(() => parseAnswer(def("privacyContactEmail"), bad)), bad).toBe("invalid-value");
    expect(parseAnswer(def("siteUrl"), "https://example.com")).toEqual({ kind: "value", value: "https://example.com" });
    for (const bad of ["example.com", "javascript:alert(1)", "ftp://x.test", "https://"]) expect(code(() => parseAnswer(def("siteUrl"), bad)), bad).toBe("invalid-value");
  });

  it("lists are split, trimmed and bounded", () => {
    expect(parseAnswer(def("targetMarkets"), "US, EU , UK")).toEqual({ kind: "value", value: ["US", "EU", "UK"] });
    expect(code(() => parseAnswer(def("targetMarkets"), ","))).toBe("invalid-value");
    expect(code(() => parseAnswer(def("targetMarkets"), Array.from({ length: 21 }, (_, i) => `r${i}`).join(",")))).toBe("invalid-value");
    expect(code(() => parseAnswer(def("targetMarkets"), "x".repeat(41)))).toBe("invalid-value");
  });
});

describe("validateNote", () => {
  it("is required for sensitive answers, single-line and at most 120 characters", () => {
    expect(validateNote("owner said no", true)).toBe("owner said no");
    expect(validateNote(undefined, false)).toBeUndefined();
    expect(code(() => validateNote(undefined, true))).toBe("note-required");
    expect(code(() => validateNote("  ", true))).toBe("note-required");
    expect(code(() => validateNote("two\nlines", false))).toBe("invalid-note");
    expect(code(() => validateNote("x".repeat(121), false))).toBe("invalid-note");
    expect(validateNote("x".repeat(120), false)).toHaveLength(120);
  });
});

describe("answerReport", () => {
  it("writes the value, keeps the file's comments, and puts the note in a trailing comment", () => {
    const root = fresh();
    const before = readFileSync(join(root, ".srclawyer.config.yml"), "utf8");
    expect(before.startsWith("# Generated by srclawyer init. Safe to edit by hand.")).toBe(true);

    const report = answer(root, "collectsChildrensData", "false", "owner said no, it is a B2B tool");

    expect(report).toMatchObject({ ok: true, id: "collectsChildrensData", recorded: true, written: true, previous: { answered: false }, current: { answered: true, value: false } });
    const text = readFileSync(join(root, ".srclawyer.config.yml"), "utf8");
    expect(text.startsWith("# Generated by srclawyer init. Safe to edit by hand.")).toBe(true);
    expect(text).toContain("collectsChildrensData: false # owner said no, it is a B2B tool");
    expect(loadConfig(root)!.collectsChildrensData).toBe(false);
  });

  it("refuses a sensitive answer without a note, and writes nothing", () => {
    const root = fresh();
    const before = readFileSync(join(root, ".srclawyer.config.yml"), "utf8");
    expect(code(() => answer(root, "sendsDataToAiServices", "true"))).toBe("note-required");
    expect(readFileSync(join(root, ".srclawyer.config.yml"), "utf8")).toBe(before);
  });

  it("a non-sensitive answer needs no note, and re-answering replaces an old note", () => {
    const root = fresh();
    answer(root, "companyName", "Acme", "typed by the owner");
    expect(readFileSync(join(root, ".srclawyer.config.yml"), "utf8")).toContain("companyName: Acme # typed by the owner");
    answer(root, "companyName", "Acme Inc.");
    const text = readFileSync(join(root, ".srclawyer.config.yml"), "utf8");
    expect(text).toContain("companyName: Acme Inc.");
    expect(text).not.toContain("typed by the owner");
  });

  it("round-trips awkward text exactly (colons, hashes, quotes, leading dashes), never as YAML structure", () => {
    const root = fresh();
    for (const value of ["Acme: the company", "# not a comment", 'say "hi"', "- item", "key: value, other: thing", "yes", "null", "123"]) {
      answer(root, "dataRetentionPolicy", value);
      expect(loadConfig(root)!.dataRetentionPolicy, value).toBe(value);
    }
    // And a value that looks like injected structure is rejected as multi-line rather than interpreted.
    expect(code(() => answer(root, "dataRetentionPolicy", "x\nsellsOrSharesData: true"))).toBe("invalid-value");
    expect(loadConfig(root)!.sellsOrSharesData).toBeNull();
  });

  it("'unsure' on a blank records nothing in the config but defers the question on this machine", () => {
    const root = fresh();
    const before = readFileSync(join(root, ".srclawyer.config.yml"), "utf8");
    const report = answer(root, "hasEuUkUsers", "unsure");
    expect(report).toMatchObject({ ok: true, recorded: false, written: false });
    expect(readFileSync(join(root, ".srclawyer.config.yml"), "utf8")).toBe(before);
    expect(readDeferred(root)).toEqual(["hasEuUkUsers"]);
  });

  it("'unsure' on an answered question leaves the answer alone, and a real answer clears the deferral", () => {
    const root = fresh();
    answer(root, "hasEuUkUsers", "unsure");
    answer(root, "hasEuUkUsers", "true", "owner has users in Germany");
    expect(readDeferred(root)).toEqual([]);
    const report = answer(root, "hasEuUkUsers", "unsure");
    expect(report.current).toEqual({ answered: true, value: true });
    expect(readDeferred(root)).toEqual([]);
  });

  it("stores 'no minimum' as 0 and a list as a YAML sequence", () => {
    const root = fresh();
    answer(root, "minimumAge", "none");
    answer(root, "targetMarkets", "US, EU");
    const config = loadConfig(root)!;
    expect(config.minimumAge).toBe(0);
    expect(config.targetMarkets).toEqual(["US", "EU"]);
  });

  it("refuses an unknown question, and a project with no config", () => {
    const root = fresh();
    expect(code(() => answer(root, "tier", "byok"))).toBe("unknown-question");
    expect(code(() => answer(root, "__proto__", "x"))).toBe("unknown-question");
    rmSync(join(root, ".srclawyer.config.yml"));
    expect(code(() => answer(root, "companyName", "Acme"))).toBe("no-config");
    expect(existsSync(join(root, ".srclawyer.config.yml"))).toBe(false);
  });

  it("never lets an answer touch another key (tier, llm settings)", () => {
    const root = fresh();
    writeFileSync(join(root, ".srclawyer.config.yml"), readFileSync(join(root, ".srclawyer.config.yml"), "utf8") + "llm:\n  apiKeyEnvVar: MY_KEY\n");
    answer(root, "companyName", "Acme");
    const config = loadConfig(root)!;
    expect(config.tier).toBe("free");
    expect(config.llm).toEqual({ apiKeyEnvVar: "MY_KEY" });
  });
});

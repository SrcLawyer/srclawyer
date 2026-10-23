import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { configPath, loadConfig, POLICY_TEXT_LIMITS } from "../config/config.js";
import { DEFAULT_POLICY_PATH } from "../policy/policyGuard.js";
import { POLICY_FILE_CHOICES, POLICY_FILE_EDITED_ID, QUESTION_BY_ID, isServiceQuestion, policyTextKeyOf, serviceKeyOf, type PolicyFileChoice, type PolicyTextKey, type QuestionDef } from "../assistant/questions.js";
import { computeProjectState, readBaseline } from "../assistant/state.js";
import { backupFile, markAnswered, readDeferred, readFreshLastUpdate, writeDeferred, writePolicyChoice } from "../assistant/stateDir.js";
import { BACKUP_NOTE, STATUS } from "../assistant/wording.js";
import { currentOf } from "./questionsCommand.js";
import { readPackageVersion } from "../version.js";

export const MAX_TEXT_CHARS = 500;
export const MAX_NOTE_CHARS = 120;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

export interface AnswerOptions {
  inventoryPath: string;
  id: string;
  value: string;
  note?: string;
  /** policyText.additionalSections only: the section heading. */
  heading?: string;
  json: boolean;
}

export class AnswerError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

type Parsed = { kind: "unsure" } | { kind: "value"; value: boolean | number | string | string[] };

/** Validates one answer against the question's kind. Throws AnswerError; never returns a value it did not check. */
export function parseAnswer(def: QuestionDef, raw: string): Parsed {
  const text = raw.trim();
  if (/^(unsure|i'?m not sure|not sure)$/i.test(text)) return { kind: "unsure" };
  if (CONTROL_CHARS.test(raw.replace(/\r?\n$/, ""))) throw new AnswerError("invalid-value", "The answer contains a line break or control character.");

  switch (def.kind) {
    case "yes_no": {
      if (/^(true|yes|y)$/i.test(text)) return { kind: "value", value: true };
      if (/^(false|no|n)$/i.test(text)) return { kind: "value", value: false };
      throw new AnswerError("invalid-value", "Use true, false or unsure.");
    }
    case "age": {
      if (/^(none|no minimum)$/i.test(text)) return { kind: "value", value: 0 };
      if (!/^\d{1,3}$/.test(text) || Number(text) < 1 || Number(text) > 120) throw new AnswerError("invalid-value", "Use a whole number from 1 to 120, none, or unsure.");
      return { kind: "value", value: Number(text) };
    }
    case "list": {
      const items = text.split(",").map((s) => s.trim()).filter(Boolean);
      if (items.length === 0 || items.length > 20 || items.some((i) => i.length > 40)) throw new AnswerError("invalid-value", "Use up to 20 short, comma-separated items.");
      return { kind: "value", value: items };
    }
    case "choice":
      throw new AnswerError("invalid-value", "This question is answered with one of its listed options.");
    case "text": {
      if (text === "") throw new AnswerError("invalid-value", "The answer is empty.");
      if (text.length > MAX_TEXT_CHARS) throw new AnswerError("invalid-value", `The answer is longer than ${MAX_TEXT_CHARS} characters.`);
      if (def.id === "privacyContactEmail" && !EMAIL.test(text)) throw new AnswerError("invalid-value", "That doesn't look like an email address.");
      if (def.id === "siteUrl") {
        let url: URL | null = null;
        try {
          url = new URL(text);
        } catch {
          url = null;
        }
        if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) throw new AnswerError("invalid-value", "Use a full web address starting with https:// or http://.");
      }
      return { kind: "value", value: text };
    }
  }
}

export function validateNote(note: string | undefined, required: boolean): string | undefined {
  if (note === undefined || note.trim() === "") {
    if (required) throw new AnswerError("note-required", "A note with what the user said is required for this question.");
    return undefined;
  }
  const trimmed = note.trim();
  if (CONTROL_CHARS.test(trimmed)) throw new AnswerError("invalid-note", "The note must be a single line.");
  if (trimmed.length > MAX_NOTE_CHARS) throw new AnswerError("invalid-note", `The note is longer than ${MAX_NOTE_CHARS} characters.`);
  return trimmed;
}

/** Writes one value into the config with its comments intact, and the note as a trailing comment. */
function writeConfigValue(root: string, field: string | string[], value: unknown, note: string | undefined): void {
  const path = configPath(root);
  const doc = parseDocument(readFileSync(path, "utf8"));
  const keys = Array.isArray(field) ? field : [field];
  doc.setIn(keys, value);
  const node = doc.getIn(keys, true) as { comment?: string | null } | null;
  if (node && typeof node === "object") node.comment = note ? ` ${note}` : null;
  const out = doc.toString();
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, out, "utf8");
  renameSync(tmp, path);
}

const TEXT_LIMITS: Record<PolicyTextKey, number> = {
  lastUpdated: POLICY_TEXT_LIMITS.lastUpdated,
  intro: POLICY_TEXT_LIMITS.intro,
  closing: POLICY_TEXT_LIMITS.closing,
  additionalSections: POLICY_TEXT_LIMITS.body,
};

/** Text that goes into the policy: several lines allowed (not for the date), no control characters other than line breaks and tabs. */
export function parsePolicyText(key: PolicyTextKey, raw: string): string {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text === "") throw new AnswerError("invalid-value", "The text is empty.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new AnswerError("invalid-value", "The text contains a control character.");
  if (key === "lastUpdated" && text.includes("\n")) throw new AnswerError("invalid-value", "The date must be on one line.");
  if (text.length > TEXT_LIMITS[key]) throw new AnswerError("invalid-value", `The text is longer than ${TEXT_LIMITS[key]} characters.`);
  if (text.includes("srclawyer:policy-sha256")) throw new AnswerError("invalid-value", "The text contains a line SrcLawyer reserves.");
  return text;
}

function policyFileSha(root: string): string | null {
  const file = join(root, DEFAULT_POLICY_PATH);
  return existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null;
}

function reportFor(root: string, options: AnswerOptions, def: QuestionDef, extra: Record<string, unknown>) {
  const state = computeProjectState(root, options.inventoryPath);
  return {
    schema: 1 as const,
    srclawyerVersion: readPackageVersion(),
    ok: true as const,
    id: def.id,
    field: String(def.field),
    ...extra,
    state: state.state,
    nextAction: state.nextAction,
  };
}

/** `policy-file-edited`: what to do with a policy file the owner edited in generated mode. */
function answerPolicyFile(root: string, options: AnswerOptions, def: QuestionDef) {
  const choice = options.value.trim() as PolicyFileChoice;
  if (!(POLICY_FILE_CHOICES as readonly string[]).includes(choice)) throw new AnswerError("invalid-value", `Use one of: ${POLICY_FILE_CHOICES.join(", ")}.`);
  const file = join(root, DEFAULT_POLICY_PATH);
  const sha = policyFileSha(root);
  if (choice === "keep_mine") {
    // The file becomes the owner's: generated mode ends and the 0.8.0 behaviour (drafts next to it) applies.
    writeConfigValue(root, "policyMode", "handwritten", undefined);
    return reportFor(root, options, def, { recorded: true, written: true, choice });
  }
  if (sha === null) throw new AnswerError("invalid-value", "There is no policy file to decide about.");
  if (choice === "discard") {
    // Nothing is deleted now: the next regeneration may replace exactly this version, after a backup copy.
    const backup = backupFile(root, file, "PRIVACY_POLICY");
    writePolicyChoice(root, { choice: "discard", fileSha256: sha });
    return reportFor(root, options, def, { recorded: true, written: false, choice, backup, backupNote: BACKUP_NOTE.replace("{path}", backup) });
  }
  writePolicyChoice(root, { choice: "move", fileSha256: sha });
  return reportFor(root, options, def, { recorded: true, written: false, choice });
}

/** `policyText.*`: text the owner wants shown in the generated policy. */
function answerPolicyText(root: string, options: AnswerOptions, def: QuestionDef, key: PolicyTextKey) {
  const baselineText = readBaseline(root, options.inventoryPath).text;
  if (key === "lastUpdated" && /^(none|no date)$/i.test(options.value.trim())) {
    writeDeferred(root, [...readDeferred(root), def.id]);
    return reportFor(root, options, def, { recorded: false, written: false });
  }
  const text = parsePolicyText(key, options.value);
  if (key === "additionalSections") {
    const heading = (options.heading ?? "").trim();
    if (heading === "" || heading.length > POLICY_TEXT_LIMITS.heading || /[\u0000-\u001f\u007f]/.test(heading)) {
      throw new AnswerError("invalid-value", `Give a one-line heading of at most ${POLICY_TEXT_LIMITS.heading} characters with --heading.`);
    }
    const existing = loadConfig(root)?.policyText?.additionalSections ?? [];
    if (existing.length >= POLICY_TEXT_LIMITS.sections) throw new AnswerError("invalid-value", `There can be at most ${POLICY_TEXT_LIMITS.sections} added sections.`);
    writeConfigValue(root, ["policyText", "additionalSections"], [...existing, { heading, body: text }], undefined);
  } else {
    writeConfigValue(root, ["policyText", key], text, undefined);
  }
  writeDeferred(root, readDeferred(root).filter((id) => id !== def.id));
  markAnswered(root, baselineText, def.id);
  return reportFor(root, options, def, { recorded: true, written: true });
}

/** `service.<profile>.<feature>`: whether the owner uses an optional feature of a service they use. */
function answerServiceFeature(root: string, options: AnswerOptions, def: QuestionDef) {
  const parsed = parseAnswer(def, options.value);
  if (parsed.kind === "unsure") {
    writeDeferred(root, [...readDeferred(root), def.id]);
    return reportFor(root, options, def, { recorded: false, written: false });
  }
  writeConfigValue(root, ["serviceUse", serviceKeyOf(def.id)!], parsed.value, undefined);
  writeDeferred(root, readDeferred(root).filter((id) => id !== def.id));
  return reportFor(root, options, def, { recorded: true, written: true });
}

export function answerReport(root: string, options: AnswerOptions) {
  const def = QUESTION_BY_ID.get(options.id);
  if (!def) throw new AnswerError("unknown-question", "That isn't one of the questions SrcLawyer asks.");
  if (!existsSync(configPath(root))) throw new AnswerError("no-config", STATUS.notSetUp);
  if (def.id === POLICY_FILE_EDITED_ID) return answerPolicyFile(root, options, def);
  const textKey = policyTextKeyOf(def.id);
  if (textKey) return answerPolicyText(root, options, def, textKey);
  if (isServiceQuestion(def)) return answerServiceFeature(root, options, def);

  const parsed = parseAnswer(def, options.value);
  const note = validateNote(options.note, def.sensitive && parsed.kind === "value");
  const before = loadConfig(root);
  const previous = currentOf(def, before);
  const baselineText = readBaseline(root, options.inventoryPath).text;

  let written = false;
  let cleared = false;
  if (parsed.kind === "value") {
    writeConfigValue(root, String(def.field), parsed.value, note);
    written = true;
    writeDeferred(root, readDeferred(root).filter((id) => id !== def.id));
  } else if (!previous.answered) {
    writeDeferred(root, [...readDeferred(root), def.id]);
  } else if (readFreshLastUpdate(root, baselineText)?.triggered.some((t) => t.id === def.id)) {
    // A change in the code raised this question so the owner could confirm an earlier answer, and they
    // cannot. Keeping the old answer would let the policy state something nobody has confirmed, so it
    // becomes a marked blank ("I'll leave a clearly marked blank in the policy").
    writeConfigValue(root, String(def.field), def.kind === "list" ? [] : null, undefined);
    written = true;
    cleared = true;
    writeDeferred(root, [...readDeferred(root), def.id]);
  }
  markAnswered(root, baselineText, def.id);

  const state = computeProjectState(root, options.inventoryPath);
  return {
    schema: 1 as const,
    srclawyerVersion: readPackageVersion(),
    ok: true as const,
    id: def.id,
    field: String(def.field),
    recorded: parsed.kind === "value",
    written,
    cleared,
    previous,
    current: currentOf(def, loadConfig(root)),
    ...(note ? { note } : {}),
    state: state.state,
    nextAction: state.nextAction,
  };
}

/** `srclawyer answer <id> <value>`: records one answer, non-interactively. Exit 0 recorded, 2 refused. */
export function runAnswer(root: string, options: AnswerOptions): number {
  try {
    console.log(JSON.stringify(answerReport(root, options), null, 2));
    return 0;
  } catch (error) {
    if (!(error instanceof AnswerError)) throw error;
    console.log(JSON.stringify({ schema: 1, ok: false, id: options.id, error: { code: error.code, message: error.message } }, null, 2));
    return 2;
  }
}

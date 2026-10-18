import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { configPath, loadConfig } from "../config/config.js";
import { QUESTION_BY_ID, type QuestionDef } from "../assistant/questions.js";
import { computeProjectState, readBaseline } from "../assistant/state.js";
import { markAnswered, readDeferred, writeDeferred } from "../assistant/stateDir.js";
import { STATUS } from "../assistant/wording.js";
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
      if (/^(true|yes)$/i.test(text)) return { kind: "value", value: true };
      if (/^(false|no)$/i.test(text)) return { kind: "value", value: false };
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
function writeConfigValue(root: string, field: string, value: boolean | number | string | string[], note: string | undefined): void {
  const path = configPath(root);
  const doc = parseDocument(readFileSync(path, "utf8"));
  doc.set(field, value);
  const node = doc.get(field, true) as { comment?: string | null } | null;
  if (node && typeof node === "object") node.comment = note ? ` ${note}` : null;
  const out = doc.toString();
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, out, "utf8");
  renameSync(tmp, path);
}

export function answerReport(root: string, options: AnswerOptions) {
  const def = QUESTION_BY_ID.get(options.id);
  if (!def) throw new AnswerError("unknown-question", "That isn't one of the questions SrcLawyer asks.");
  if (!existsSync(configPath(root))) throw new AnswerError("no-config", STATUS.notSetUp);

  const parsed = parseAnswer(def, options.value);
  const note = validateNote(options.note, def.sensitive && parsed.kind === "value");
  const before = loadConfig(root);
  const previous = currentOf(def, before);
  const baselineText = readBaseline(root, options.inventoryPath).text;

  let written = false;
  if (parsed.kind === "value") {
    writeConfigValue(root, String(def.field), parsed.value, note);
    written = true;
    writeDeferred(root, readDeferred(root).filter((id) => id !== def.id));
  } else if (!previous.answered) {
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

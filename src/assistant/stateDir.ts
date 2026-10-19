import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Machine-local state, never committed: a `.gitignore` containing `*` is written inside it so nothing
 * in it can reach the repository. It holds one file, written by `update`, that lets `status` and
 * `questions` answer without scanning again. It contains no paths, code or free text from the project.
 */
export const STATE_DIR = ".srclawyer";
export const LAST_UPDATE_FILE = "last-update.json";
export const DEFERRED_FILE = "deferred.json";
export const POLICY_CHOICE_FILE = "policy-choice.json";
export const BACKUP_DIR = "backups";

export interface LastUpdate {
  schema: 1;
  srclawyerVersion: string;
  /** SHA-256 of the baseline file the update compared against; the record is stale once the baseline changes. */
  baselineSha256: string;
  result: "no-drift" | "drift" | "inconclusive";
  /** True when this was the first review of a baseline with no approval record. */
  firstReview?: boolean;
  /** First 8 hex characters of the review file's hash; null when there was no drift. */
  reviewHash: string | null;
  /** Questions this drift raised, with the reason each is asked. */
  triggered: Array<{ id: string; why: string }>;
  /** Ids of triggered questions the owner has answered since. */
  answered: string[];
  /** Added and removed items, by display name. */
  diff: { addedCategories: string[]; addedProcessors: string[]; removedCategories: string[]; removedProcessors: string[] } | null;
  summary: string[];
  inconclusiveReasonCount: number;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function ensureStateDir(root: string): string {
  const dir = join(root, STATE_DIR);
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  return dir;
}

export function writeLastUpdate(root: string, record: LastUpdate): void {
  const dir = ensureStateDir(root);
  const file = join(dir, LAST_UPDATE_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");
  renameSync(tmp, file);
}

/** The record, or null when it is missing, unreadable, or belongs to a different baseline. */
export function readFreshLastUpdate(root: string, baselineText: string | null): LastUpdate | null {
  if (baselineText === null) return null;
  try {
    const parsed = JSON.parse(readFileSync(join(root, STATE_DIR, LAST_UPDATE_FILE), "utf8")) as LastUpdate;
    if (parsed.schema !== 1 || parsed.baselineSha256 !== sha256(baselineText)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Marks a triggered question as answered in the current record; a no-op when there is none. */
export function markAnswered(root: string, baselineText: string | null, id: string): void {
  const record = readFreshLastUpdate(root, baselineText);
  if (!record || record.answered.includes(id) || !record.triggered.some((t) => t.id === id)) return;
  writeLastUpdate(root, { ...record, answered: [...record.answered, id] });
}

/** Ids of questions the owner said they were not sure about; they stay blank but stop being re-asked on this machine. */
export function readDeferred(root: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(join(root, STATE_DIR, DEFERRED_FILE), "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeDeferred(root: string, ids: string[]): void {
  const dir = ensureStateDir(root);
  const file = join(dir, DEFERRED_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify([...new Set(ids)].sort(), null, 2) + "\n");
  renameSync(tmp, file);
}

/**
 * The owner's choice about an edited policy file in generated mode, tied to the exact bytes it was made
 * about: "discard" lets the next regeneration replace that file (after a backup); "move" marks that the
 * owner is moving their text into settings. A different file contents makes the record void.
 */
export interface PolicyChoice {
  choice: "discard" | "move";
  /** SHA-256 of the policy file the choice was made about. */
  fileSha256: string;
}

export function readPolicyChoice(root: string): PolicyChoice | null {
  try {
    const parsed = JSON.parse(readFileSync(join(root, STATE_DIR, POLICY_CHOICE_FILE), "utf8")) as PolicyChoice;
    return (parsed.choice === "discard" || parsed.choice === "move") && typeof parsed.fileSha256 === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function writePolicyChoice(root: string, choice: PolicyChoice): void {
  const dir = ensureStateDir(root);
  const file = join(dir, POLICY_CHOICE_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(choice, null, 2) + "\n");
  renameSync(tmp, file);
}

/** Copies `absPath` into .srclawyer/backups/ named by the first 8 hex of its hash; returns the project-relative path. */
export function backupFile(root: string, absPath: string, baseName: string): string {
  const dir = join(ensureStateDir(root), BACKUP_DIR);
  mkdirSync(dir, { recursive: true });
  const text = readFileSync(absPath);
  const target = join(dir, `${baseName}.${createHash("sha256").update(text).digest("hex").slice(0, 8)}.md`);
  writeFileSync(target, text);
  return join(STATE_DIR, BACKUP_DIR, `${baseName}.${createHash("sha256").update(text).digest("hex").slice(0, 8)}.md`);
}

import type { Finding, ScanResult } from "../engine/types.js";

/**
 * The drift baseline: WHICH data categories and third-party processors the code touches, and nothing
 * else -- no file names, line numbers, field names or timestamps. Users hand-edit their generated
 * policy, so drift is judged against this, never against policy text.
 *
 * Built from Layer 1 only (finding.dataCategories / finding.processor) over ALL findings: AI-assisted
 * review never changes it (so it's identical on every tier), and a finding moving between "confident"
 * and "needs review" is not drift.
 */
export const INVENTORY_SCHEMA = 1;
export const DEFAULT_INVENTORY_PATH = ".srclawyer.inventory.json";

/** "git": git ls-files --cached --others --exclude-standard; "glob": the ordinary filesystem walk. */
export type DiscoveryMode = "git" | "glob";

export interface Inventory {
  schema: number;
  /** Informational only -- never compared. Lets a drift report say "the baseline was written by an older version". */
  srclawyerVersion: string;
  discovery: DiscoveryMode;
  categories: string[];
  processors: string[];
  /**
   * Present only when the baseline was recorded by `srclawyer approve`: the hash of the review that was
   * approved and a short note with the owner's reply (at most 120 characters, one line). No dates;
   * git history is the timestamp. It is committed to the repository together with the rest of the file.
   */
  approval?: { review: string; note: string };
}

export const MAX_APPROVAL_NOTE_CHARS = 120;

// Default code-point sort, deliberately not localeCompare: locale-aware ordering differs between
// machines (ICU data, LANG), which would make the committed file differ byte-for-byte between a laptop and CI.
function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export function computeInventory(findings: Finding[], meta: { srclawyerVersion: string; discovery: DiscoveryMode }): Inventory {
  return {
    schema: INVENTORY_SCHEMA,
    srclawyerVersion: meta.srclawyerVersion,
    discovery: meta.discovery,
    categories: sortedUnique(findings.flatMap((f) => f.dataCategories)),
    processors: sortedUnique(findings.flatMap((f) => (f.processor ? [f.processor] : []))),
  };
}

/** Fixed key order, two-space indent, trailing newline: the same inventory is always the same bytes. */
export function serializeInventory(inventory: Inventory): string {
  const ordered: Inventory = {
    schema: inventory.schema,
    srclawyerVersion: inventory.srclawyerVersion,
    discovery: inventory.discovery,
    categories: sortedUnique(inventory.categories),
    processors: sortedUnique(inventory.processors),
    ...(inventory.approval ? { approval: { review: inventory.approval.review, note: inventory.approval.note } } : {}),
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}

export type ParsedInventory = { ok: true; inventory: Inventory } | { ok: false; reason: string };

function parseApproval(value: unknown): { approval?: { review: string; note: string } } {
  if (typeof value !== "object" || value === null) return {};
  const a = value as Record<string, unknown>;
  if (typeof a.review !== "string" || typeof a.note !== "string") return {};
  return { approval: { review: a.review, note: a.note.slice(0, MAX_APPROVAL_NOTE_CHARS) } };
}

export function parseInventory(text: string): ParsedInventory {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, reason: "it is not valid JSON" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "it is not a JSON object" };
  const o = raw as Record<string, unknown>;

  if (o.schema !== INVENTORY_SCHEMA) return { ok: false, reason: `unsupported schema ${JSON.stringify(o.schema)} (this version reads schema ${INVENTORY_SCHEMA})` };
  if (o.discovery !== "git" && o.discovery !== "glob") return { ok: false, reason: '"discovery" must be "git" or "glob"' };
  const stringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
  if (!stringArray(o.categories)) return { ok: false, reason: '"categories" must be an array of strings' };
  if (!stringArray(o.processors)) return { ok: false, reason: '"processors" must be an array of strings' };

  return {
    ok: true,
    inventory: {
      schema: INVENTORY_SCHEMA,
      srclawyerVersion: typeof o.srclawyerVersion === "string" ? o.srclawyerVersion : "unknown",
      discovery: o.discovery,
      categories: sortedUnique(o.categories),
      processors: sortedUnique(o.processors),
      ...parseApproval(o.approval),
    },
  };
}

export interface InventoryDiff {
  added: { categories: string[]; processors: string[] };
  removed: { categories: string[]; processors: string[] };
}

function difference(from: string[], minus: string[]): string[] {
  const exclude = new Set(minus);
  return from.filter((v) => !exclude.has(v));
}

export function diffInventories(baseline: Inventory, current: Inventory): InventoryDiff {
  return {
    added: {
      categories: difference(current.categories, baseline.categories),
      processors: difference(current.processors, baseline.processors),
    },
    removed: {
      categories: difference(baseline.categories, current.categories),
      processors: difference(baseline.processors, current.processors),
    },
  };
}

export function hasDrift(diff: InventoryDiff): boolean {
  return Object.values(diff.added).some((v) => v.length > 0) || Object.values(diff.removed).some((v) => v.length > 0);
}

/**
 * The warnings that make a drift verdict untrustworthy -- exactly the ones that make `scan` exit 1,
 * minus the two that can't affect Layer 1 categories (an AI-review misconfiguration, and the legacy
 * config filename). A degraded scan is missing findings, which would read as "removed" categories.
 */
export function inventoryBlockers(result: ScanResult, protectedLogicWarning: string | null): string[] {
  return [result.unsupportedStackWarning, result.workspaceWarning, result.skippedFilesWarning, protectedLogicWarning].filter(
    (w): w is string => !!w
  );
}

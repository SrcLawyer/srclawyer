import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, policyModeOf, type SrcLawyerConfig } from "../config/config.js";
import { parseInventory, DEFAULT_INVENTORY_PATH, type Inventory } from "../inventory/inventory.js";
import { createHash } from "node:crypto";
import { DEFAULT_POLICY_PATH, classifyPolicyFile } from "../policy/policyGuard.js";
import { POLICY_FILE_DEF, POLICY_TEXT_DEFS, QUESTION_DEFS, isAnswered, isPolicyTextAnswered, policyTextKeyOf, type QuestionDef } from "./questions.js";
import { readDeferred, readFreshLastUpdate, readPolicyChoice, type LastUpdate } from "./stateDir.js";
import { assessPublishable, type Publishability } from "./publishable.js";
import { STATUS } from "./wording.js";

export type ProjectStateName = "needs-setup" | "needs-answers" | "needs-update" | "needs-approval" | "up-to-date" | "blocked";

export interface OpenQuestion {
  def: QuestionDef;
  /** "unanswered": the field is empty. "changed": a change in the code means the answer should be confirmed. "attention": the policy file needs a decision. */
  reason: "unanswered" | "changed" | "attention";
  why: string;
  /** Blocking questions stop the state reaching "up-to-date" and must be answered (or named) before approval. */
  blocking: boolean;
  /** The owner said they were not sure: the blank stays in the policy but the question is not re-asked on this machine. */
  deferred: boolean;
}

export type NextAction =
  | { do: "run-command"; command: string }
  | { do: "run-update"; command: string }
  | { do: "ask-user"; questionId: string }
  | { do: "ask-user-to-confirm"; reviewHash: string }
  | { do: "none" };

export interface ProjectState extends Publishability {
  state: ProjectStateName;
  blockedBy: Array<{ code: string; message: string }>;
  policyMode: "generated" | "handwritten";
  /** Whether `srclawyer approve` has recorded an approval in the baseline. */
  baselineApproved: boolean;
  policyPath: string;
  reviewHash: string | null;
  openQuestions: OpenQuestion[];
  /** Number of open questions that are blocking. */
  openQuestionCount: number;
  nextAction: NextAction;
  config: SrcLawyerConfig | null;
  baselineText: string | null;
  baseline: Inventory | null;
  last: LastUpdate | null;
}

/** True when the policy file exists, SrcLawyer did not write it as it is, and the owner has not chosen to discard exactly this version. */
function policyFileNeedsDecision(root: string, policyFile: string): boolean {
  if (!existsSync(policyFile)) return false;
  const state = classifyPolicyFile(policyFile);
  if (state !== "edited" && state !== "unmarked") return false;
  const choice = readPolicyChoice(root);
  const sha = createHash("sha256").update(readFileSync(policyFile)).digest("hex");
  return !(choice?.choice === "discard" && choice.fileSha256 === sha);
}

export function readBaseline(root: string, inventoryPath = DEFAULT_INVENTORY_PATH): { text: string | null; inventory: Inventory | null } {
  const path = join(root, inventoryPath);
  if (!existsSync(path)) return { text: null, inventory: null };
  const text = readFileSync(path, "utf8");
  const parsed = parseInventory(text);
  return { text, inventory: parsed.ok ? parsed.inventory : null };
}

export function computeOpenQuestions(config: SrcLawyerConfig | null, last: LastUpdate | null, deferredIds: string[] = []): OpenQuestion[] {
  const deferredSet = new Set(deferredIds);
  const triggered = new Map((last?.triggered ?? []).map((t) => [t.id, t.why]));
  const answered = new Set(last?.answered ?? []);
  const out: OpenQuestion[] = [];
  for (const def of QUESTION_DEFS) {
    const unanswered = !isAnswered(def, config);
    const changed = triggered.has(def.id) && !answered.has(def.id);
    if (!unanswered && !changed) continue;
    const deferred = unanswered && !changed && deferredSet.has(def.id);
    out.push({ def, reason: unanswered ? "unanswered" : "changed", why: triggered.get(def.id) ?? def.why, blocking: (def.blocking || changed) && !deferred, deferred });
  }
  return out;
}

/**
 * Where the project stands, read from local files only (no scan, no network). `last` is the record the
 * most recent `update` left behind; it is ignored once the baseline has changed.
 */
export function computeProjectState(root: string, inventoryPath = DEFAULT_INVENTORY_PATH): ProjectState {
  const config = loadConfig(root);
  const { text: baselineText, inventory: baseline } = readBaseline(root, inventoryPath);
  const last = readFreshLastUpdate(root, baselineText);
  const policyFile = join(root, DEFAULT_POLICY_PATH);
  const policyText = existsSync(policyFile) ? readFileSync(policyFile, "utf8") : null;
  const publishability = assessPublishable(policyText);
  const openQuestions = computeOpenQuestions(config, last, readDeferred(root));

  // policyMode: generated. A policy file that SrcLawyer did not write (or that was edited) is never
  // overwritten; the owner decides what happens to it. Text the owner is moving into settings, and the
  // "last updated" date, are offered as optional questions.
  const policyFileEdited = policyModeOf(config) === "generated" && policyFileNeedsDecision(root, policyFile);
  if (policyFileEdited) {
    openQuestions.unshift({ def: POLICY_FILE_DEF, reason: "attention", why: POLICY_FILE_DEF.why, blocking: true, deferred: false });
    if (readPolicyChoice(root)?.choice === "move") {
      for (const def of POLICY_TEXT_DEFS.filter((d) => d.id !== "policyText.lastUpdated")) {
        const key = policyTextKeyOf(def.id)!;
        if (!isPolicyTextAnswered(key, config)) openQuestions.push({ def, reason: "unanswered", why: def.why, blocking: false, deferred: false });
      }
    }
  } else if (policyModeOf(config) === "generated" && baseline !== null) {
    const lastUpdated = POLICY_TEXT_DEFS.find((d) => d.id === "policyText.lastUpdated")!;
    if (!isPolicyTextAnswered("lastUpdated", config) && !readDeferred(root).includes(lastUpdated.id)) {
      openQuestions.push({ def: lastUpdated, reason: "unanswered", why: lastUpdated.why, blocking: false, deferred: false });
    }
  }
  const blocking = openQuestions.filter((q) => q.blocking);

  const base = {
    ...publishability,
    policyMode: policyModeOf(config),
    baselineApproved: baseline?.approval !== undefined,
    policyPath: DEFAULT_POLICY_PATH,
    reviewHash: last?.reviewHash ?? null,
    openQuestions,
    openQuestionCount: blocking.length,
    config,
    baselineText,
    baseline,
    last,
  };

  if (config === null) {
    return { ...base, state: "needs-setup", blockedBy: [{ code: "no-config", message: STATUS.notSetUp }], nextAction: { do: "run-command", command: "srclawyer init --yes" } };
  }
  if (baseline === null) {
    return { ...base, state: "needs-setup", blockedBy: [{ code: "no-baseline", message: STATUS.noBaseline }], nextAction: { do: "run-command", command: "srclawyer scan --write-inventory" } };
  }
  if (policyFileEdited) {
    return { ...base, state: "blocked", blockedBy: [{ code: "policy-file-edited", message: POLICY_FILE_DEF.ask }], nextAction: { do: "ask-user", questionId: POLICY_FILE_DEF.id } };
  }
  if (last?.result === "inconclusive") {
    return { ...base, state: "blocked", blockedBy: [{ code: "inconclusive", message: STATUS.inconclusive }], nextAction: { do: "run-update", command: "srclawyer update --json" } };
  }
  if (blocking.length > 0) {
    return { ...base, state: "needs-answers", blockedBy: [], nextAction: { do: "ask-user", questionId: blocking[0]!.def.id } };
  }
  if (last === null) {
    return { ...base, state: "needs-update", blockedBy: [], nextAction: { do: "run-update", command: "srclawyer update --json" } };
  }
  if ((last.result === "drift" || last.firstReview) && last.reviewHash) {
    return { ...base, state: "needs-approval", blockedBy: [], nextAction: { do: "ask-user-to-confirm", reviewHash: last.reviewHash } };
  }
  // A baseline with no approval record has never been approved, however clean the last update was.
  if (baseline.approval === undefined) return { ...base, state: "needs-update", blockedBy: [], nextAction: { do: "run-update", command: "srclawyer update --json" } };
  return { ...base, state: "up-to-date", blockedBy: [], nextAction: { do: "none" } };
}

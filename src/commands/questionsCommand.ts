import type { SrcLawyerConfig } from "../config/config.js";
import { IF_UNSURE_BLOCKING, IF_UNSURE_NON_BLOCKING, POLICY_FILE_CHOICES, isPolicyTextAnswered, isServiceQuestion, policyTextKeyOf, serviceKeyOf, type QuestionDef } from "../assistant/questions.js";
import { computeProjectState, type OpenQuestion } from "../assistant/state.js";
import { OPTION_LABELS, POLICY_FILE_OPTION_LABELS, POLICY_TEXT_QUESTIONS, SERVICE_SECTION } from "../assistant/wording.js";
import { readPackageVersion } from "../version.js";

export interface QuestionsOptions {
  inventoryPath: string;
  json: boolean;
}

const PREVIEW_CHARS = 60;

function optionsFor(def: QuestionDef) {
  const unsure = { value: "unsure" as const, label: OPTION_LABELS.unsure };
  switch (def.kind) {
    case "yes_no":
      return [{ value: true, label: OPTION_LABELS.yes }, { value: false, label: OPTION_LABELS.no }, unsure];
    case "age":
      return [{ value: "none" as const, label: OPTION_LABELS.noMinimum }, unsure];
    case "choice":
      return POLICY_FILE_CHOICES.map((value) => ({ value, label: POLICY_FILE_OPTION_LABELS[value] }));
    default:
      if (def.id === "policyText.lastUpdated") return [{ value: "none" as const, label: POLICY_TEXT_QUESTIONS.noDate }];
      return [unsure];
  }
}

/** The owner's current answer, in a form that never carries a long or repository-influenced string. */
export function currentOf(def: QuestionDef, config: SrcLawyerConfig | null) {
  const textKey = policyTextKeyOf(def.id);
  if (textKey) {
    const answered = isPolicyTextAnswered(textKey, config);
    const v = config?.policyText?.[textKey];
    if (textKey === "additionalSections") return { answered, count: Array.isArray(v) ? v.length : 0 };
    return typeof v === "string" && v.trim() !== ""
      ? { answered, length: v.length, preview: v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, PREVIEW_CHARS), untrusted: true }
      : { answered, length: 0 };
  }
  if (isServiceQuestion(def)) {
    const v = config?.serviceUse?.[serviceKeyOf(def.id)!];
    return typeof v === "boolean" ? { answered: true, value: v } : { answered: false, value: null };
  }
  if (def.kind === "choice") return { answered: false, value: null };
  const value = config?.[def.field];
  switch (def.kind) {
    case "yes_no":
      return value === true || value === false ? { answered: true, value } : { answered: false, value: null };
    case "age":
      return typeof value === "number" ? { answered: true, value } : { answered: false, value: null };
    case "list":
      return Array.isArray(value) && value.length > 0 ? { answered: true, count: value.length } : { answered: false, count: 0 };
    default:
      return typeof value === "string" && value.trim() !== ""
        ? { answered: true, length: value.length, preview: value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, PREVIEW_CHARS), untrusted: true }
        : { answered: false, length: 0 };
  }
}

function answerWith(def: QuestionDef): string {
  if (isServiceQuestion(def)) return `srclawyer answer ${def.id} <true|false|unsure>`;
  if (def.kind === "choice") return `srclawyer answer ${def.id} <${POLICY_FILE_CHOICES.join("|")}>`;
  if (def.id === "policyText.additionalSections") return 'srclawyer answer policyText.additionalSections --heading "<heading>" --stdin';
  if (def.id.startsWith("policyText.")) return `srclawyer answer ${def.id} --stdin`;
  const hint = def.kind === "yes_no" ? "<true|false|unsure>" : def.kind === "age" ? "<number|none|unsure>" : '"<answer>"';
  return `srclawyer answer ${def.id} ${hint}${def.sensitive ? ' --note "<what the user said>"' : ""}`;
}

export function questionJson(q: OpenQuestion, config: SrcLawyerConfig | null, evidence: { addedServices: string[]; addedDataKinds: string[] }) {
  const def = q.def;
  return {
    id: def.id,
    field: String(def.field),
    kind: def.kind,
    reason: q.reason,
    blocking: q.blocking,
    deferred: q.deferred,
    sensitive: def.sensitive,
    ask: def.ask,
    why: q.why,
    ...(def.explain ? { explain: def.explain } : {}),
    options: optionsFor(def),
    ...(def.kind === "choice" || def.id.startsWith("policyText.") ? {} : { ifUnsure: isServiceQuestion(def) ? SERVICE_SECTION.ifUnsure : def.blocking ? IF_UNSURE_BLOCKING : IF_UNSURE_NON_BLOCKING }),
    evidence: q.reason === "changed" ? evidence : { addedServices: [], addedDataKinds: [] },
    current: currentOf(def, config),
    answerWith: answerWith(def),
  };
}

/** `srclawyer questions`: the open questions, in plain wording, from local files only (no scan, no network). */
export function runQuestions(root: string, options: QuestionsOptions): number {
  const state = computeProjectState(root, options.inventoryPath);
  const evidence = { addedServices: state.last?.diff?.addedProcessors ?? [], addedDataKinds: state.last?.diff?.addedCategories ?? [] };
  const questions = state.openQuestions.map((q) => questionJson(q, state.config, evidence));
  const report = {
    schema: 1 as const,
    srclawyerVersion: readPackageVersion(),
    state: state.state,
    reviewHash: state.reviewHash,
    questions,
    nextAction: state.nextAction,
  };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  questions.forEach((q, i) => {
    console.log(`${i + 1}. ${q.ask}`);
    console.log(`   Why: ${q.why}`);
  });
  return 0;
}

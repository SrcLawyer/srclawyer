import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { CLAUDE_ASK_RULES, RULES_END, RULES_START_RE, SKILL_PATH, SKILL_TEXT, rulesBlock } from "../assistant/agentText.js";
import { AGENT_SETUP, SUMMARY } from "../assistant/wording.js";
import { EXIT_CRASH, EXIT_OK } from "../exitCodes.js";
import { readPackageVersion } from "../version.js";

export type WriteAction = "create" | "insert-block" | "replace-block" | "merge-json" | "unchanged" | "left-alone";

export interface PlannedWrite {
  path: string;
  action: WriteAction;
  /** Why a file was left alone. */
  reason?: "edited" | "malformed" | "invalid-json" | "unexpected-shape";
}

export type BlockState = "missing" | "current" | "older" | "edited" | "malformed";

const RULES_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
const SETTINGS_PATH = ".claude/settings.json";

function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

interface BlockLocation {
  state: BlockState;
  start?: number;
  end?: number;
}

/** Where our block is in a file, and whether it is exactly what we would write for the version it names. */
export function locateBlock(text: string, currentVersion: string): BlockLocation {
  const normalized = text.replace(/\r\n/g, "\n");
  const starts = [...normalized.matchAll(new RegExp(RULES_START_RE.source, "gm"))];
  if (starts.length === 0) return { state: normalized.includes("srclawyer:agent-rules") ? "malformed" : "missing" };
  if (starts.length > 1) return { state: "malformed" };
  const start = starts[0]!.index!;
  const end = normalized.indexOf(RULES_END, start);
  if (end === -1) return { state: "malformed" };
  const endExclusive = end + RULES_END.length;
  const version = starts[0]![1]!;
  const found = normalized.slice(start, endExclusive);
  if (found !== rulesBlock(version)) return { state: "edited", start, end: endExclusive };
  return { state: version === currentVersion ? "current" : "older", start, end: endExclusive };
}

function withEol(text: string, eol: string): string {
  return eol === "\n" ? text : text.replace(/\n/g, eol);
}

function planRulesFile(root: string, file: string, version: string): { write: PlannedWrite; next?: string } | null {
  const abs = join(root, file);
  if (!existsSync(abs)) {
    // AGENTS.md is created; CLAUDE.md never is (creating it would change what Claude Code reads).
    return file === "AGENTS.md" ? { write: { path: file, action: "create" }, next: `${rulesBlock(version)}\n` } : null;
  }
  const text = readFileSync(abs, "utf8");
  const eol = eolOf(text);
  const located = locateBlock(text, version);
  switch (located.state) {
    case "missing": {
      const separator = text === "" ? "" : text.endsWith("\n") ? eol : eol + eol;
      return { write: { path: file, action: "insert-block" }, next: text + separator + withEol(rulesBlock(version), eol) + eol };
    }
    case "current":
      return { write: { path: file, action: "unchanged" } };
    case "older": {
      const normalized = text.replace(/\r\n/g, "\n");
      const replaced = normalized.slice(0, located.start) + rulesBlock(version) + normalized.slice(located.end);
      return { write: { path: file, action: "replace-block" }, next: withEol(replaced, eol) };
    }
    case "edited":
      return { write: { path: file, action: "left-alone", reason: "edited" } };
    case "malformed":
      return { write: { path: file, action: "left-alone", reason: "malformed" } };
  }
}

function planSkill(root: string): { write: PlannedWrite; next?: string } {
  const abs = join(root, SKILL_PATH);
  if (!existsSync(abs)) return { write: { path: SKILL_PATH, action: "create" }, next: SKILL_TEXT };
  return readFileSync(abs, "utf8") === SKILL_TEXT
    ? { write: { path: SKILL_PATH, action: "unchanged" } }
    : { write: { path: SKILL_PATH, action: "left-alone", reason: "edited" } };
}

function planSettings(root: string): { write: PlannedWrite; next?: string } {
  const abs = join(root, SETTINGS_PATH);
  const wanted = [...CLAUDE_ASK_RULES];
  if (!existsSync(abs)) return { write: { path: SETTINGS_PATH, action: "create" }, next: JSON.stringify({ permissions: { ask: wanted } }, null, 2) + "\n" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(abs, "utf8"));
  } catch {
    return { write: { path: SETTINGS_PATH, action: "left-alone", reason: "invalid-json" } };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { write: { path: SETTINGS_PATH, action: "left-alone", reason: "unexpected-shape" } };
  const settings = parsed as Record<string, unknown>;
  const permissions = settings.permissions;
  if (permissions !== undefined && (typeof permissions !== "object" || permissions === null || Array.isArray(permissions))) {
    return { write: { path: SETTINGS_PATH, action: "left-alone", reason: "unexpected-shape" } };
  }
  const perms = (permissions ?? {}) as Record<string, unknown>;
  if (perms.ask !== undefined && !Array.isArray(perms.ask)) return { write: { path: SETTINGS_PATH, action: "left-alone", reason: "unexpected-shape" } };
  const ask = (perms.ask ?? []) as unknown[];
  const missing = wanted.filter((rule) => !ask.includes(rule));
  if (missing.length === 0) return { write: { path: SETTINGS_PATH, action: "unchanged" } };
  const merged = { ...settings, permissions: { ...perms, ask: [...ask, ...missing] } };
  return { write: { path: SETTINGS_PATH, action: "merge-json" }, next: JSON.stringify(merged, null, 2) + "\n" };
}

export interface AgentSetupPlan {
  writes: PlannedWrite[];
  contents: Map<string, string>;
}

export function planAgentSetup(root: string, version: string, includeAskRules: boolean): AgentSetupPlan {
  const writes: PlannedWrite[] = [];
  const contents = new Map<string, string>();
  const take = (item: { write: PlannedWrite; next?: string } | null) => {
    if (!item) return;
    writes.push(item.write);
    if (item.next !== undefined) contents.set(item.write.path, item.next);
  };
  for (const file of RULES_FILES) take(planRulesFile(root, file, version));
  take(planSkill(root));
  if (includeAskRules) take(planSettings(root));
  return { writes, contents };
}

/** Writes the planned contents, each atomically. Files whose action is unchanged or left-alone have no contents and are never touched. */
export function applyAgentSetup(root: string, plan: AgentSetupPlan): void {
  for (const [path, text] of plan.contents) {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.tmp`;
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, abs);
  }
}

/** The state of what is installed, for `status`. Reads only. */
export function inspectAgentSetup(root: string, version: string) {
  const rules = (file: string): BlockState | "not-present" => (existsSync(join(root, file)) ? locateBlock(readFileSync(join(root, file), "utf8"), version).state : "not-present");
  const skillPath = join(root, SKILL_PATH);
  return {
    version,
    agentsMd: rules("AGENTS.md"),
    claudeMd: rules("CLAUDE.md"),
    skill: !existsSync(skillPath) ? ("missing" as const) : readFileSync(skillPath, "utf8") === SKILL_TEXT ? ("current" as const) : ("edited" as const),
  };
}

function needsNodeInstallHint(root: string): boolean {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return !(pkg.dependencies?.srclawyer || pkg.devDependencies?.srclawyer);
  } catch {
    return false;
  }
}

export interface AgentSetupOptions {
  dryRun: boolean;
  yes: boolean;
  /** Also merge the `ask` rules into .claude/settings.json (the owner agreed). */
  claudeAskRules: boolean;
  json: boolean;
}

export interface AgentSetupIo {
  isTTY: boolean;
  ask: (question: string) => Promise<string>;
}

const WRITING_ACTIONS: WriteAction[] = ["create", "insert-block", "replace-block", "merge-json"];

function describe(write: PlannedWrite): string {
  switch (write.action) {
    case "create":
      return AGENT_SETUP.create;
    case "insert-block":
      return AGENT_SETUP.insert;
    case "replace-block":
      return AGENT_SETUP.replace;
    case "merge-json":
      return AGENT_SETUP.merge;
    case "unchanged":
      return AGENT_SETUP.unchanged;
    case "left-alone":
      return write.reason === "edited" ? AGENT_SETUP.leftEdited : AGENT_SETUP.leftOther;
  }
}

function defaultIo(): AgentSetupIo {
  return {
    isTTY: process.stdin.isTTY === true,
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
  };
}

/**
 * `srclawyer agent-setup`: shows exactly what it would write, and writes only with a yes (or --yes).
 * It adds one marked block to AGENTS.md (and to CLAUDE.md if that exists, never creating it), writes the
 * skill, and, only when asked, merges four `ask` rules into .claude/settings.json. It never overwrites a
 * file: an edited block or skill is left alone and said so.
 */
export async function runAgentSetup(root: string, options: AgentSetupOptions, io: AgentSetupIo = defaultIo()): Promise<number> {
  const version = readPackageVersion();
  let includeAsk = options.claudeAskRules;
  let plan = planAgentSetup(root, version, includeAsk);
  const changes = () => plan.writes.some((w) => WRITING_ACTIONS.includes(w.action));

  let written = false;
  let printed = false;
  let refusal: string | null = null;
  let code = EXIT_OK;

  if (!options.dryRun && changes()) {
    if (options.yes) {
      applyAgentSetup(root, plan);
      written = true;
    } else if (io.isTTY && !options.json) {
      printPlan(plan, includeAsk);
      printed = true;
      if (/^y(es)?$/i.test((await io.ask(AGENT_SETUP.promptWrite)).trim())) {
        if (!includeAsk && /^y(es)?$/i.test((await io.ask(AGENT_SETUP.promptAskRules)).trim())) {
          includeAsk = true;
          plan = planAgentSetup(root, version, true);
        }
        applyAgentSetup(root, plan);
        written = true;
      }
    } else {
      refusal = AGENT_SETUP.needsYes;
      code = EXIT_CRASH;
    }
  }

  const installHint = needsNodeInstallHint(root) ? AGENT_SETUP.installHint.replace("{version}", version) : null;
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          schema: 1,
          srclawyerVersion: version,
          ok: code === EXIT_OK,
          dryRun: options.dryRun,
          written,
          writes: plan.writes.map((w) => ({ ...w, description: describe(w) })),
          claudeAskRules: { included: includeAsk, offer: includeAsk ? null : AGENT_SETUP.promptAskRules, flag: "--claude-ask-rules", rules: [...CLAUDE_ASK_RULES] },
          installHint,
          ...(refusal ? { error: { code: "needs-yes", message: refusal } } : {}),
          published: false,
          committed: false,
        },
        null,
        2
      )
    );
  } else {
    if (!printed) printPlan(plan, includeAsk);
    if (refusal) console.log(refusal);
    if (installHint) console.log(installHint);
    if (written || options.dryRun || !changes()) console.log(SUMMARY.nothingPublished);
  }
  return code;
}

function printPlan(plan: AgentSetupPlan, includeAsk: boolean): void {
  for (const w of plan.writes) console.log(`${w.path}: ${describe(w)}`);
  if (!includeAsk) console.log(AGENT_SETUP.askRulesNotIncluded);
}

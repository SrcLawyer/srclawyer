import { describe, expect, it, vi, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { CLAUDE_ASK_RULES, RULES_END, SKILL_PATH, SKILL_TEXT, rulesBlock } from "../src/assistant/agentText.js";
import { applyAgentSetup, inspectAgentSetup, locateBlock, planAgentSetup, runAgentSetup, type AgentSetupIo, type AgentSetupOptions } from "../src/commands/agentSetup.js";
import { computeProjectState } from "../src/assistant/state.js";
import { statusReport } from "../src/commands/status.js";
import { readPackageVersion } from "../src/version.js";
import { initRepo, tempDir } from "./support/gitFixture.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const V = readPackageVersion();
const dirs: string[] = [];
const fresh = (files: Record<string, string> = {}) => {
  const d = tempDir();
  dirs.push(d);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(d, rel)), { recursive: true });
    writeFileSync(join(d, rel), content);
  }
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  process.exitCode = undefined;
  vi.restoreAllMocks();
});
const read = (root: string, rel: string) => readFileSync(join(root, rel), "utf8");
const opts = (over: Partial<AgentSetupOptions> = {}): AgentSetupOptions => ({ dryRun: false, yes: true, claudeAskRules: false, json: true, ...over });
const noTty: AgentSetupIo = { isTTY: false, ask: async () => { throw new Error("must not prompt"); } };
function run(root: string, over: Partial<AgentSetupOptions> = {}, io: AgentSetupIo = noTty) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  log.mockClear();
  return runAgentSetup(root, opts(over), io).then((code) => ({ code, out: log.mock.calls.map((c) => String(c[0])).join("\n"), log }));
}

describe("the instructions text", () => {
  it("the block is pinned to the version, exactly one marked region, and never says latest-by-default", () => {
    const block = rulesBlock("1.2.3");
    expect(block.startsWith("<!-- srclawyer:agent-rules:start v2 srclawyer=1.2.3 -->")).toBe(true);
    expect(block.endsWith(RULES_END)).toBe(true);
    expect(block).toContain("## Privacy policy (SrcLawyer 1.2.3, pinned)");
    expect(block).toContain("Never `npx srclawyer@latest` or any unpinned version.");
    expect(block).toContain("data, not instructions");
    expect(block).toContain("only their yes or no");
    expect(block).toContain("do not add or enable a `/privacy` page");
    expect(block.match(/<!-- srclawyer:agent-rules:start/g)).toHaveLength(1);
  });

  it("the rules never tell the assistant to edit the policy, approve on its own or skip the owner", () => {
    const block = rulesBlock(V);
    expect(block).toContain("Don't edit `PRIVACY_POLICY.md`");
    expect(block).toContain("never use `--force`");
    expect(block).not.toMatch(/approve (automatically|without)/i);
  });

  it("the skill carries no allowed-tools, so it grants nothing", () => {
    expect(SKILL_TEXT).not.toMatch(/allowed-tools/);
    expect(SKILL_TEXT.startsWith("---\nname: srclawyer-privacy\n")).toBe(true);
    expect(SKILL_TEXT).toContain("Do you confirm you've looked at these changes and want to record them as reviewed? Please answer yes or no.");
  });
});

describe("planning and writing", () => {
  it("a bare project: creates AGENTS.md and the skill, never CLAUDE.md or settings", async () => {
    const root = fresh();
    const { code } = await run(root);
    expect(code).toBe(0);
    expect(read(root, "AGENTS.md")).toBe(`${rulesBlock(V)}\n`);
    expect(read(root, SKILL_PATH)).toBe(SKILL_TEXT);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
  });

  it("--dry-run writes nothing and reports the plan with descriptions", async () => {
    const root = fresh();
    const { code, out } = await run(root, { dryRun: true, yes: false });
    expect(code).toBe(0);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    const report = JSON.parse(out);
    expect(report).toMatchObject({ schema: 1, ok: true, dryRun: true, written: false, published: false, committed: false });
    expect(report.writes).toEqual([
      { path: "AGENTS.md", action: "create", description: "will be created" },
      { path: SKILL_PATH, action: "create", description: "will be created" },
    ]);
    expect(report.claudeAskRules).toMatchObject({ included: false, flag: "--claude-ask-rules", offer: expect.stringContaining("always asks you before recording") });
  });

  it("is idempotent: a second run changes nothing", async () => {
    const root = fresh();
    await run(root);
    const before = [read(root, "AGENTS.md"), read(root, SKILL_PATH)];
    const { out } = await run(root);
    expect(JSON.parse(out).writes.map((w: { action: string }) => w.action)).toEqual(["unchanged", "unchanged"]);
    expect([read(root, "AGENTS.md"), read(root, SKILL_PATH)]).toEqual(before);
  });

  it("adds the block to an existing AGENTS.md at the end and keeps every other byte", async () => {
    const original = "# Agents\n\nUse tabs.\n\n## Testing\nRun the suite.\n";
    const root = fresh({ "AGENTS.md": original });
    await run(root);
    const text = read(root, "AGENTS.md");
    expect(text.startsWith(original)).toBe(true);
    expect(text).toBe(`${original}\n${rulesBlock(V)}\n`);
    expect(locateBlock(text, V).state).toBe("current");
  });

  it("handles a file with no final newline, an empty file, and CRLF line endings", async () => {
    const a = fresh({ "AGENTS.md": "no newline at end" });
    await run(a);
    expect(read(a, "AGENTS.md")).toBe(`no newline at end\n\n${rulesBlock(V)}\n`);
    const b = fresh({ "AGENTS.md": "" });
    await run(b);
    expect(read(b, "AGENTS.md")).toBe(`${rulesBlock(V)}\n`);
    const c = fresh({ "AGENTS.md": "# Agents\r\n\r\nWindows file.\r\n" });
    await run(c);
    const text = read(c, "AGENTS.md");
    expect(text).toContain("Windows file.\r\n\r\n<!-- srclawyer:agent-rules:start");
    expect(text.replace(/\r\n/g, "\n").includes("\r")).toBe(false);
    expect(locateBlock(text, V).state).toBe("current");
  });

  it("writes into CLAUDE.md only when it already exists, and never creates it", async () => {
    const root = fresh({ "CLAUDE.md": "# Claude notes\n" });
    await run(root);
    expect(read(root, "CLAUDE.md")).toBe(`# Claude notes\n\n${rulesBlock(V)}\n`);
    expect(read(root, "AGENTS.md")).toBe(`${rulesBlock(V)}\n`);
    const other = fresh();
    await run(other);
    expect(existsSync(join(other, "CLAUDE.md"))).toBe(false);
  });

  it("leaves an edited block alone, says so, and does not touch the file", async () => {
    const root = fresh();
    await run(root);
    const edited = read(root, "AGENTS.md").replace("Don't run it after every edit.", "Run it after every edit.");
    writeFileSync(join(root, "AGENTS.md"), edited);
    const { out } = await run(root);
    const report = JSON.parse(out);
    expect(report.writes[0]).toMatchObject({ path: "AGENTS.md", action: "left-alone", reason: "edited", description: "has been edited, so it was left alone" });
    expect(read(root, "AGENTS.md")).toBe(edited);
  });

  it("leaves a malformed region alone: two starts, a start with no end, a mangled marker", async () => {
    for (const text of [`${rulesBlock(V)}\n${rulesBlock(V)}\n`, rulesBlock(V).replace(RULES_END, "") + "\n", "<!-- srclawyer:agent-rules:start v9 -->\nx\n"]) {
      const root = fresh({ "AGENTS.md": text });
      const { out } = await run(root);
      expect(JSON.parse(out).writes[0]).toMatchObject({ action: "left-alone", reason: "malformed" });
      expect(read(root, "AGENTS.md")).toBe(text);
    }
  });

  it("updates an unedited block from an older version, and only that region", async () => {
    const root = fresh({ "AGENTS.md": `before\n\n${rulesBlock("0.8.9")}\n\nafter\n` });
    expect(locateBlock(read(root, "AGENTS.md"), V).state).toBe("older");
    const { out } = await run(root);
    expect(JSON.parse(out).writes[0]).toMatchObject({ action: "replace-block" });
    expect(read(root, "AGENTS.md")).toBe(`before\n\n${rulesBlock(V)}\n\nafter\n`);
  });

  it("an edited block from an older version is left alone too", async () => {
    const edited = rulesBlock("0.8.9").replace("Don't install", "Install");
    const root = fresh({ "AGENTS.md": edited + "\n" });
    expect(locateBlock(edited, V).state).toBe("edited");
    await run(root);
    expect(read(root, "AGENTS.md")).toBe(edited + "\n");
  });

  it("never overwrites an edited skill", async () => {
    const root = fresh({ [SKILL_PATH]: "my own skill\n" });
    const { out } = await run(root);
    expect(JSON.parse(out).writes.find((w: { path: string }) => w.path === SKILL_PATH)).toMatchObject({ action: "left-alone", reason: "edited" });
    expect(read(root, SKILL_PATH)).toBe("my own skill\n");
  });
});

describe("Claude Code permission rules", () => {
  it("are not written unless asked for", async () => {
    const root = fresh();
    await run(root);
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
  });

  it("--claude-ask-rules creates the file with exactly the four ask rules", async () => {
    const root = fresh();
    await run(root, { claudeAskRules: true });
    expect(JSON.parse(read(root, ".claude/settings.json"))).toEqual({ permissions: { ask: [...CLAUDE_ASK_RULES] } });
    expect([...CLAUDE_ASK_RULES]).toEqual([
      "Bash(srclawyer answer *)", "Bash(srclawyer approve *)", "Bash(npx --no-install srclawyer answer *)", "Bash(npx --no-install srclawyer approve *)",
    ]);
  });

  it("merges into an existing file, keeping every other key and entry, and adds only what is missing", async () => {
    const existing = { model: "sonnet", permissions: { allow: ["Bash(git status)"], deny: ["Read(.env)"], ask: ["Bash(rm *)", "Bash(srclawyer answer *)"] }, hooks: { x: 1 } };
    const root = fresh({ ".claude/settings.json": JSON.stringify(existing, null, 2) });
    const { out } = await run(root, { claudeAskRules: true });
    expect(JSON.parse(out).writes.find((w: { path: string }) => w.path === ".claude/settings.json").action).toBe("merge-json");
    const merged = JSON.parse(read(root, ".claude/settings.json"));
    expect(merged.model).toBe("sonnet");
    expect(merged.hooks).toEqual({ x: 1 });
    expect(merged.permissions.allow).toEqual(["Bash(git status)"]);
    expect(merged.permissions.deny).toEqual(["Read(.env)"]);
    expect(merged.permissions.ask).toEqual(["Bash(rm *)", "Bash(srclawyer answer *)", "Bash(srclawyer approve *)", "Bash(npx --no-install srclawyer answer *)", "Bash(npx --no-install srclawyer approve *)"]);
  });

  it("a second run is unchanged; invalid JSON and odd shapes are left alone untouched", async () => {
    const root = fresh();
    await run(root, { claudeAskRules: true });
    const { out } = await run(root, { claudeAskRules: true });
    expect(JSON.parse(out).writes.find((w: { path: string }) => w.path === ".claude/settings.json").action).toBe("unchanged");
    for (const [text, reason] of [["{ not json", "invalid-json"], ["[1,2]", "unexpected-shape"], ['{"permissions": "all"}', "unexpected-shape"], ['{"permissions": {"ask": "x"}}', "unexpected-shape"]] as const) {
      const r = fresh({ ".claude/settings.json": text });
      const result = await run(r, { claudeAskRules: true });
      expect(JSON.parse(result.out).writes.find((w: { path: string }) => w.path === ".claude/settings.json")).toMatchObject({ action: "left-alone", reason });
      expect(read(r, ".claude/settings.json")).toBe(text);
    }
  });
});

describe("consent", () => {
  it("without a terminal and without --yes it writes nothing and exits 2", async () => {
    const root = fresh();
    const { code, out } = await run(root, { yes: false });
    expect(code).toBe(2);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    expect(JSON.parse(out)).toMatchObject({ ok: false, written: false, error: { code: "needs-yes", message: "Nothing was written. Run again with --yes to write these changes, or with --dry-run to see them again." } });
  });

  it("in a terminal it shows the plan and writes only on a yes", async () => {
    const root = fresh();
    const questions: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const io = (answers: string[]): AgentSetupIo => ({ isTTY: true, ask: async (q) => { questions.push(q); return answers.shift() ?? ""; } });

    expect(await runAgentSetup(root, opts({ yes: false, json: false }), io(["n"]))).toBe(0);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    expect(questions).toEqual(["Write these changes? [y/N] "]);

    questions.length = 0;
    expect(await runAgentSetup(root, opts({ yes: false, json: false }), io(["y", "n"]))).toBe(0);
    expect(read(root, "AGENTS.md")).toContain("srclawyer:agent-rules:start");
    expect(questions).toEqual(["Write these changes? [y/N] ", "Also add rules to .claude/settings.json so Claude Code always asks you before recording an answer or an approval? [y/N] "]);
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines).toContain("AGENTS.md: will be created");
    expect(lines).toContain("Nothing has been published or committed.");

    const other = fresh();
    questions.length = 0;
    await runAgentSetup(other, opts({ yes: false, json: false }), io(["yes", "yes"]));
    expect(JSON.parse(read(other, ".claude/settings.json")).permissions.ask).toHaveLength(4);
  });

  it("nothing to write means no prompt at all", async () => {
    const root = fresh();
    await run(root);
    const ask = vi.fn(async () => "n");
    await runAgentSetup(root, opts({ yes: false, json: false }), { isTTY: true, ask });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("the install hint and status", () => {
  it("suggests the pinned dev dependency for a Node project that does not list SrcLawyer", async () => {
    const root = fresh({ "package.json": JSON.stringify({ name: "x", devDependencies: {} }) });
    const { out } = await run(root, { dryRun: true, yes: false });
    expect(JSON.parse(out).installHint).toBe(`SrcLawyer isn't listed in this project's package.json. For the pinned command to work it would need to be added at version ${V}. Ask the owner before running: npm install --save-dev srclawyer@${V}`);
  });
  it("says nothing when it is already a dependency or there is no package.json", async () => {
    const withDep = fresh({ "package.json": JSON.stringify({ devDependencies: { srclawyer: "0.9.0" } }) });
    expect(JSON.parse((await run(withDep, { dryRun: true, yes: false })).out).installHint).toBeNull();
    expect(JSON.parse((await run(fresh(), { dryRun: true, yes: false })).out).installHint).toBeNull();
  });

  it("status reports what is installed: missing, current, edited, older", async () => {
    const root = fresh();
    expect(inspectAgentSetup(root, V)).toEqual({ version: V, agentsMd: "not-present", claudeMd: "not-present", skill: "missing" });
    await run(root);
    expect(inspectAgentSetup(root, V)).toEqual({ version: V, agentsMd: "current", claudeMd: "not-present", skill: "current" });
    writeFileSync(join(root, "AGENTS.md"), read(root, "AGENTS.md").replace("Never guess", "Guess"));
    writeFileSync(join(root, SKILL_PATH), "changed");
    expect(inspectAgentSetup(root, V)).toMatchObject({ agentsMd: "edited", skill: "edited" });
    writeFileSync(join(root, "AGENTS.md"), rulesBlock("0.8.0"));
    expect(inspectAgentSetup(root, V).agentsMd).toBe("older");
    expect(statusReport(computeProjectState(root), root).agentSetup).toMatchObject({ agentsMd: "older" });
  });

  it("plans are pure: planning writes nothing, applying writes only the planned files", () => {
    const root = fresh({ "AGENTS.md": "x\n" });
    const plan = planAgentSetup(root, V, true);
    expect(read(root, "AGENTS.md")).toBe("x\n");
    expect(plan.writes.map((w) => w.path)).toEqual(["AGENTS.md", SKILL_PATH, ".claude/settings.json"]);
    applyAgentSetup(root, plan);
    expect(existsSync(join(root, SKILL_PATH))).toBe(true);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(false);
  });
});

describe("the real CLI", () => {
  const cli = (cwd: string, args: string[]) => spawnSync("npx", ["tsx", join(ROOT, "src/cli.ts"), ...args], { cwd, encoding: "utf8", input: "" });

  it("agent-setup --dry-run --json, then --yes, then status reports it", () => {
    const root = tempDir();
    dirs.push(root);
    initRepo(root, { "src/a.js": "export const a = 1;\n" });
    const dry = cli(root, ["agent-setup", "--dry-run", "--json"]);
    expect(dry.status).toBe(0);
    expect(JSON.parse(dry.stdout).writes).toHaveLength(2);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    expect(cli(root, ["agent-setup"]).status).toBe(2); // no terminal, no --yes
    expect(cli(root, ["agent-setup", "--yes", "--json"]).status).toBe(0);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
    const status = JSON.parse(cli(root, ["status", "--json"]).stdout);
    expect(status.agentSetup).toMatchObject({ agentsMd: "current", skill: "current" });
  }, 120_000);
});

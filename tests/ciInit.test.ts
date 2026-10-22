import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { runCiInit, defaultBranch, type CiInitIo } from "../src/commands/ciInit.js";
import { CHECKOUT_SHA, CHECKOUT_VERSION, renderWorkflow, WORKFLOW_TEMPLATE } from "../src/ci/workflow.js";
import { CI_INIT } from "../src/assistant/wording.js";
import { DEFAULT_INVENTORY_PATH, parseInventory } from "../src/inventory/inventory.js";
import { cloneRepo, git, initRepo, tempDir, workerStandIn } from "./support/gitFixture.js";

const CATALOG = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "question-catalog.md"), "utf8");
const PLAIN = CATALOG.replace(/\*\*/g, "");
const WORKFLOW = ".github/workflows/srclawyer.yml";

const dirs: string[] = [];
const fresh = () => {
  const d = tempDir();
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const APP = { ".gitignore": "generated/\n", "src/app.js": "const { email } = req.body;\n" };
const io = (over: Partial<CiInitIo> = {}): CiInitIo => ({ isTTY: false, ask: async () => "n", random: () => 0, ...over });

function setup() {
  const worker = workerStandIn();
  vi.spyOn(globalThis, "fetch").mockImplementation(worker.impl as typeof fetch);
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  return { stdout: () => log.mock.calls.map((c) => c.join(" ")).join("\n"), stderr: () => err.mock.calls.map((c) => String(c[0])).join("\n") };
}

describe("the workflow file", () => {
  it("is Appendix D of the catalog, apart from the placeholders", () => {
    const start = CATALOG.indexOf("## Appendix D.");
    const open = CATALOG.indexOf("```yaml\n", start) + "```yaml\n".length;
    const catalog = CATALOG.slice(open, CATALOG.indexOf("\n```", open)) + "\n";
    expect(WORKFLOW_TEMPLATE).toBe(catalog);
  });

  const input = { branch: "main", versionSpec: "0.10.0", actionRef: "v0.10.0", folder: "", schedule: { minute: 17, hour: 6, weekday: 1 } };
  const parsed = yaml.load(renderWorkflow(input)) as {
    on: Record<string, unknown>;
    jobs: Record<string, { permissions: Record<string, string>; steps: Array<{ uses: string; with?: Record<string, string> }>; if: string }>;
  };

  it("parses, runs on pull requests, pushes to the default branch, a weekly schedule and manual runs", () => {
    expect(Object.keys(parsed.on).sort()).toEqual(["pull_request", "push", "schedule", "workflow_dispatch"]);
    expect(parsed.on.push).toEqual({ branches: ["main"] });
    expect(parsed.on.schedule).toEqual([{ cron: "17 6 * * 1" }]);
  });

  it("gives each job only the permission it needs", () => {
    expect(parsed.jobs["pull-request"].permissions).toEqual({ contents: "read", "pull-requests": "write" });
    expect(parsed.jobs["default-branch"].permissions).toEqual({ contents: "read", issues: "write" });
  });

  it("pins checkout to a full commit, pins SrcLawyer to the exact version, and is advisory", () => {
    for (const job of Object.values(parsed.jobs)) {
      expect(job.steps[0].uses).toBe(`actions/checkout@${CHECKOUT_SHA}`);
      expect(job.steps[1].uses).toBe("SrcLawyer/srclawyer@v0.10.0");
      expect(job.steps[1].with).toEqual({ "srclawyer-version": "0.10.0", mode: "review", "fail-on-drift": "false" });
    }
    expect(CHECKOUT_SHA).toMatch(/^[0-9a-f]{40}$/);
    expect(renderWorkflow(input)).toContain(`@${CHECKOUT_SHA} # v${CHECKOUT_VERSION}`);
    expect(renderWorkflow(input)).not.toMatch(/srclawyer-version: latest|@latest|@main/);
  });

  it("sets path inside a monorepo folder, quotes anything that is not plainly safe, and honors the testing overrides", () => {
    const sub = yaml.load(renderWorkflow({ ...input, folder: "apps/web" })) as typeof parsed;
    expect(sub.jobs["pull-request"].steps[1].with!.path).toBe("apps/web");
    const odd = renderWorkflow({ ...input, branch: "release: 1 #x", folder: "my app" });
    const oddParsed = yaml.load(odd) as typeof parsed;
    expect(oddParsed.on.push).toEqual({ branches: ["release: 1 #x"] });
    expect(oddParsed.jobs["pull-request"].steps[1].with!.path).toBe("my app");
    const sha = `github:SrcLawyer/srclawyer#${"a".repeat(40)}`;
    const pinned = yaml.load(renderWorkflow({ ...input, versionSpec: sha, actionRef: "b".repeat(40) })) as typeof parsed;
    expect(pinned.jobs["default-branch"].steps[1].uses).toBe(`SrcLawyer/srclawyer@${"b".repeat(40)}`);
    expect(pinned.jobs["default-branch"].steps[1].with!["srclawyer-version"]).toBe(sha);
  });
});

describe("every ci init sentence is in the catalog", () => {
  it.each(Object.entries(CI_INIT))("%s", (_k, sentence) => {
    expect(CATALOG.includes(sentence) || PLAIN.includes(sentence), sentence).toBe(true);
  });
});

describe("srclawyer ci init", () => {
  it("--yes: writes the workflow and a baseline with no approval record, and nothing else; commits nothing", async () => {
    const root = fresh();
    initRepo(root, APP);
    const { stdout } = setup();

    expect(await runCiInit(root, { yes: true }, io())).toBe(0);

    const workflow = readFileSync(join(root, WORKFLOW), "utf8");
    expect(workflow).toContain("SrcLawyer/srclawyer@v0.10.0");
    const baseline = parseInventory(readFileSync(join(root, DEFAULT_INVENTORY_PATH), "utf8"));
    expect(baseline.ok && baseline.inventory.approval).toBeUndefined();
    expect(existsSync(join(root, "PRIVACY_POLICY.md"))).toBe(false);
    expect(git(root, "status", "--porcelain").trim().split("\n").sort()).toEqual([`?? .github/`, `?? .srclawyer.inventory.json`].sort());
    expect(git(root, "log", "--oneline").trim().split("\n")).toHaveLength(1);

    const out = stdout();
    expect(out).toContain(CI_INIT.intro);
    expect(out).toContain(CI_INIT.createdWorkflow);
    expect(out).toContain(CI_INIT.createdBaseline);
    expect(out).toContain("  git add .github/workflows/srclawyer.yml .srclawyer.inventory.json");
    expect(out).toContain("on pushes to main, and once a week. Scheduled runs and issues start only after the workflow is on main");
    expect(out).toContain(CI_INIT.notApproved);
  });

  it("the schedule never uses minute 0", async () => {
    const root = fresh();
    initRepo(root, APP);
    setup();
    await runCiInit(root, { yes: true }, io({ random: () => 0 }));
    expect(readFileSync(join(root, WORKFLOW), "utf8")).toContain('cron: "1 0 * * 0"');
  });

  it("refuses outside a git repository and writes nothing", async () => {
    const root = fresh();
    const { stderr } = setup();

    expect(await runCiInit(root, { yes: true }, io())).toBe(2);

    expect(stderr()).toContain(CI_INIT.notGit);
    expect(existsSync(join(root, ".github"))).toBe(false);
    expect(existsSync(join(root, DEFAULT_INVENTORY_PATH))).toBe(false);
  });

  it("never overwrites: an existing file, a symlink or a directory at the workflow path is left exactly as it was", async () => {
    for (const make of [
      (p: string) => writeFileSync(p, "my own workflow\n"),
      (p: string) => symlinkSync("/nonexistent/target", p),
      (p: string) => mkdirSync(p),
    ]) {
      const root = fresh();
      initRepo(root, APP);
      mkdirSync(join(root, ".github/workflows"), { recursive: true });
      make(join(root, WORKFLOW));
      const before = lstatSync(join(root, WORKFLOW)).isFile() ? readFileSync(join(root, WORKFLOW), "utf8") : null;
      const { stderr } = setup();

      expect(await runCiInit(root, { yes: true }, io())).toBe(2);

      expect(stderr()).toContain(CI_INIT.exists);
      if (before !== null) expect(readFileSync(join(root, WORKFLOW), "utf8")).toBe(before);
      expect(existsSync(join(root, DEFAULT_INVENTORY_PATH))).toBe(false);
      vi.restoreAllMocks();
    }
  });

  it("without a terminal and without --yes it writes nothing and says how to proceed", async () => {
    const root = fresh();
    initRepo(root, APP);
    const { stderr } = setup();

    expect(await runCiInit(root, { yes: false }, io({ isTTY: false }))).toBe(2);

    expect(stderr()).toContain(CI_INIT.needsYes);
    expect(existsSync(join(root, ".github"))).toBe(false);
  });

  it("asks first on a terminal: a yes writes, anything else writes nothing", async () => {
    const yesRoot = fresh();
    initRepo(yesRoot, APP);
    const first = setup();
    const asked: string[] = [];
    expect(await runCiInit(yesRoot, { yes: false }, io({ isTTY: true, ask: async (q) => (asked.push(q), "y") }))).toBe(0);
    expect(asked).toEqual([CI_INIT.prompt]);
    expect(first.stdout()).toContain(CI_INIT.createBaseline);
    expect(existsSync(join(yesRoot, WORKFLOW))).toBe(true);
    vi.restoreAllMocks();

    const noRoot = fresh();
    initRepo(noRoot, APP);
    const second = setup();
    expect(await runCiInit(noRoot, { yes: false }, io({ isTTY: true, ask: async () => "maybe" }))).toBe(2);
    expect(second.stderr()).toContain(CI_INIT.declined);
    expect(existsSync(join(noRoot, ".github"))).toBe(false);
    expect(existsSync(join(noRoot, DEFAULT_INVENTORY_PATH))).toBe(false);
  });

  it("keeps an existing baseline byte for byte and says so", async () => {
    const root = fresh();
    initRepo(root, APP);
    const own = '{"schema":1,"srclawyerVersion":"0.9.0","discovery":"git","categories":[],"processors":[],"approval":{"review":"r","note":"yes"}}\n';
    writeFileSync(join(root, DEFAULT_INVENTORY_PATH), own);
    const { stdout } = setup();

    expect(await runCiInit(root, { yes: true }, io())).toBe(0);

    expect(readFileSync(join(root, DEFAULT_INVENTORY_PATH), "utf8")).toBe(own);
    expect(stdout()).toContain(CI_INIT.keepBaseline);
    expect(stdout()).toContain(CI_INIT.keptBaseline);
    expect(stdout()).not.toContain(CI_INIT.notApproved);
  });

  it("a baseline that cannot be trusted leaves no workflow behind", async () => {
    const root = fresh();
    initRepo(root, { ...APP, "manage.py": "# django\n" });
    const { stderr } = setup();

    expect(await runCiInit(root, { yes: true }, io())).toBe(2);

    expect(stderr()).toContain(CI_INIT.baselineFailed);
    expect(existsSync(join(root, WORKFLOW))).toBe(false);
    expect(existsSync(join(root, DEFAULT_INVENTORY_PATH))).toBe(false);
  });

  it("if the workflow cannot be written, the baseline it just wrote is removed again", async () => {
    const root = fresh();
    initRepo(root, APP);
    writeFileSync(join(root, ".github"), "this is a file, not a folder\n");
    setup();

    expect(await runCiInit(root, { yes: true }, io())).toBe(2);

    expect(existsSync(join(root, DEFAULT_INVENTORY_PATH))).toBe(false);
  });

  it("inside a monorepo folder, writes the workflow at the repository root with that folder as `path`, and the baseline in the folder", async () => {
    const root = fresh();
    initRepo(root, { "apps/web/src/app.js": "const { email } = req.body;\n", "README.md": "x\n" });
    setup();

    expect(await runCiInit(join(root, "apps/web"), { yes: true }, io())).toBe(0);

    const parsed = yaml.load(readFileSync(join(root, WORKFLOW), "utf8")) as { jobs: Record<string, { steps: Array<{ with?: Record<string, string> }> }> };
    expect(parsed.jobs["pull-request"].steps[1].with!.path).toBe("apps/web");
    expect(existsSync(join(root, "apps/web", DEFAULT_INVENTORY_PATH))).toBe(true);
    expect(existsSync(join(root, "apps/web/.github"))).toBe(false);
  });

  it("uses the repository's default branch, and main when there is none", async () => {
    const origin = fresh();
    initRepo(origin, APP);
    git(origin, "branch", "-m", "trunk");
    const clone = fresh();
    cloneRepo(origin, clone);
    expect(defaultBranch(clone)).toBe("trunk");
    setup();
    await runCiInit(clone, { yes: true }, io());
    expect(readFileSync(join(clone, WORKFLOW), "utf8")).toContain("branches: [trunk]");

    const lone = fresh();
    initRepo(lone, APP);
    expect(defaultBranch(lone)).toBe("main");
  });

  it("the testing overrides pin a commit", async () => {
    const root = fresh();
    initRepo(root, APP);
    setup();
    const sha = `github:SrcLawyer/srclawyer#${"a".repeat(40)}`;

    await runCiInit(root, { yes: true, versionSpec: sha, actionRef: "b".repeat(40) }, io());

    const text = readFileSync(join(root, WORKFLOW), "utf8");
    expect(text).toContain(`srclawyer-version: ${sha}`);
    expect(text).toContain(`SrcLawyer/srclawyer@${"b".repeat(40)}`);
  });
});

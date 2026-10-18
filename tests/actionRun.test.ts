import { describe, expect, it, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
// @ts-expect-error -- plain ESM with no type declarations; this is the file the Action actually runs.
import * as action from "../action/run.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHA = "a".repeat(40);

describe("validateVersionSpec", () => {
  it.each(["0.7.0", "10.20.30", "1.0.0-beta.1", `github:SrcLawyer/srclawyer#${SHA}`])("accepts %s", (spec) => {
    expect(action.validateVersionSpec(spec).ok).toBe(true);
  });

  it.each([
    "",
    "latest",
    "^0.7.0",
    "~0.7.0",
    "0.7",
    "0.7.x",
    ">=0.7.0",
    "*",
    "github:SrcLawyer/srclawyer#main",
    "github:SrcLawyer/srclawyer#v0.7.0",
    "github:SrcLawyer/srclawyer#abc123",
    "github:someone-else/srclawyer#" + SHA,
    "srclawyer@0.7.0",
    "file:../x",
    "0.7.0 && curl evil",
  ])("rejects %j", (spec) => {
    const result = action.validateVersionSpec(spec);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

describe("readInputs", () => {
  it("applies the documented defaults", () => {
    expect(action.readInputs({ INPUT_SRCLAWYER_VERSION: "0.7.0" })).toEqual({
      version: "0.7.0",
      inventoryPath: ".srclawyer.inventory.json",
      path: ".",
      failOnDrift: true,
      failOnInconclusive: false,
      prComment: false,
      token: "",
    });
  });

  it("parses the booleans", () => {
    const inputs = action.readInputs({ INPUT_FAIL_ON_DRIFT: "false", INPUT_FAIL_ON_INCONCLUSIVE: "true", INPUT_PR_COMMENT: "TRUE" });
    expect(inputs).toMatchObject({ failOnDrift: false, failOnInconclusive: true, prComment: true });
  });
});

const DRIFT = {
  result: "drift",
  exitCode: 1,
  srclawyerVersion: "0.7.0",
  baseline: { path: ".srclawyer.inventory.json", srclawyerVersion: "0.7.0", discovery: "git" },
  diff: { added: { categories: ["phone"], processors: ["Twilio"] }, removed: { categories: [], processors: ["Stripe"] } },
  inconclusiveReasons: [],
  error: null,
};
const INCONCLUSIVE = { ...DRIFT, result: "inconclusive", exitCode: 3, diff: null, inconclusiveReasons: ["Zod-schema detection unavailable (fetch failed)", "Discovery mode mismatch: …"] };
const NO_DRIFT = { ...DRIFT, result: "no-drift", exitCode: 0, diff: { added: { categories: [], processors: [] }, removed: { categories: [], processors: [] } } };
const flags = { failOnDrift: true, failOnInconclusive: false };

describe("decideOutcome", () => {
  it("no drift passes", () => {
    expect(action.decideOutcome({ exitCode: 0, report: NO_DRIFT, ...flags })).toMatchObject({ result: "no-drift", failed: false, level: null });
  });

  it("drift fails by default, naming what changed, and is only a warning when fail-on-drift is off", () => {
    const strict = action.decideOutcome({ exitCode: 1, report: DRIFT, ...flags });
    expect(strict).toMatchObject({ result: "drift", failed: true, level: "error" });
    expect(strict.message).toBe("Drift detected: added category:phone, processor:Twilio; removed processor:Stripe.");

    expect(action.decideOutcome({ exitCode: 1, report: DRIFT, failOnDrift: false, failOnInconclusive: false })).toMatchObject({ failed: false, level: "warning" });
  });

  it("inconclusive is a warning by default and fails only when asked", () => {
    expect(action.decideOutcome({ exitCode: 3, report: INCONCLUSIVE, ...flags })).toMatchObject({ result: "inconclusive", failed: false, level: "warning" });
    expect(action.decideOutcome({ exitCode: 3, report: INCONCLUSIVE, failOnDrift: true, failOnInconclusive: true })).toMatchObject({ failed: true, level: "error" });
  });

  it("a crash, a bad baseline, an unknown code, or a report that disagrees with the exit code always fails", () => {
    for (const exitCode of [2, 4, 127, null]) {
      expect(action.decideOutcome({ exitCode, report: null, failOnDrift: false, failOnInconclusive: false })).toMatchObject({ result: "error", failed: true });
    }
    expect(action.decideOutcome({ exitCode: 2, report: { result: "error", error: "no baseline found at x" }, ...flags }).message).toBe("no baseline found at x");
    expect(action.decideOutcome({ exitCode: 0, report: DRIFT, ...flags }).result).toBe("error");
  });
});

describe("renderSummary", () => {
  const ctx = (outcome: unknown, report: unknown, spec = "0.7.0") => ({ outcome, report, spec, inventoryPath: ".srclawyer.inventory.json" });

  it("drift: a table of added and removed items and a one-line fix with the pinned version", () => {
    const text = action.renderSummary(ctx(action.decideOutcome({ exitCode: 1, report: DRIFT, ...flags }), DRIFT));

    expect(text).toContain("| Data categories | `phone` | — |");
    expect(text).toContain("| Processors | `Twilio` | `Stripe` |");
    expect(text).toContain("**To fix:** if this change is intended, update your privacy policy, then run `npx srclawyer@0.7.0 scan --write-inventory` and commit `.srclawyer.inventory.json`.");
  });

  it("the fix command for a pinned commit uses the same spec", () => {
    expect(action.fixCommand(`github:SrcLawyer/srclawyer#${SHA}`)).toBe(`npx github:SrcLawyer/srclawyer#${SHA} scan --write-inventory`);
  });

  it("notes when the baseline came from a different srclawyer version", () => {
    const report = { ...DRIFT, baseline: { ...DRIFT.baseline, srclawyerVersion: "0.6.3" } };
    expect(action.renderSummary(ctx(action.decideOutcome({ exitCode: 1, report, ...flags }), report))).toContain("The baseline was written by srclawyer 0.6.3; this check ran 0.7.0");
  });

  it("inconclusive: lists every reason and says plainly it is not drift", () => {
    const text = action.renderSummary(ctx(action.decideOutcome({ exitCode: 3, report: INCONCLUSIVE, ...flags }), INCONCLUSIVE));

    expect(text).toContain("inconclusive");
    expect(text).toContain("- Zod-schema detection unavailable (fetch failed)");
    expect(text).toContain("- Discovery mode mismatch");
    expect(text).toContain("This is not drift.");
    expect(text).not.toContain("To fix");
  });

  it("no drift and error are one-liners", () => {
    expect(action.renderSummary(ctx(action.decideOutcome({ exitCode: 0, report: NO_DRIFT, ...flags }), NO_DRIFT))).toContain("no new items found");
    expect(action.renderSummary(ctx({ result: "error", message: "boom" }, null))).toContain("boom");
  });
});

describe("escapeAnnotation", () => {
  it("escapes characters that would end or split a workflow command", () => {
    expect(action.escapeAnnotation("100%\nline2\r")).toBe("100%25%0Aline2%0D");
  });
});

// ---- main(), with every side effect replaced -------------------------------------------------------------

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

interface Call {
  command: string;
  args: string[];
}

function harness(options: {
  inputs?: Record<string, string>;
  checkStatus?: number;
  checkStdout?: string;
  installStatus?: number;
  event?: Record<string, unknown> | null;
  eventName?: string;
  ghComments?: string;
  ghStatus?: number;
}) {
  dir = mkdtempSync(join(tmpdir(), "srclawyer-action-"));
  const out = join(dir, "output.txt");
  const summary = join(dir, "summary.md");
  const eventPath = join(dir, "event.json");
  if (options.event) writeFileSync(eventPath, JSON.stringify(options.event));
  const env = {
    INPUT_SRCLAWYER_VERSION: "0.7.0",
    RUNNER_TEMP: dir,
    GITHUB_OUTPUT: out,
    GITHUB_STEP_SUMMARY: summary,
    GITHUB_REPOSITORY: "acme/app",
    GITHUB_EVENT_NAME: options.eventName ?? "push",
    ...(options.event ? { GITHUB_EVENT_PATH: eventPath } : {}),
    ...options.inputs,
  } as Record<string, string>;
  const calls: Call[] = [];
  const logs: string[] = [];
  const appended = new Map<string, string>();
  const deps = {
    env,
    run: (command: string, args: string[]) => {
      calls.push({ command, args });
      if (command === "npm") return { status: options.installStatus ?? 0, stdout: "", stderr: "" };
      if (command === "node") return { status: options.checkStatus ?? 0, stdout: options.checkStdout ?? "", stderr: "scan chatter\n" };
      if (command === "gh") return { status: options.ghStatus ?? 0, stdout: options.ghComments ?? "", stderr: "" };
      throw new Error(`unexpected command ${command}`);
    },
    appendFile: (file: string, text: string) => appended.set(file, (appended.get(file) ?? "") + text),
    readFile: (file: string) => readFileSync(file, "utf8"),
    log: (line: string) => logs.push(line),
  };
  return { deps, calls, logs, out: () => appended.get(out) ?? "", summary: () => appended.get(summary) ?? "" };
}

describe("main", () => {
  it("rejects an unpinned version before installing or running anything", () => {
    const h = harness({ inputs: { INPUT_SRCLAWYER_VERSION: "latest" } });

    expect(action.main(h.deps)).toBe(1);
    expect(h.calls).toEqual([]);
    expect(h.logs.join("\n")).toContain("::error title=SrcLawyer drift check::srclawyer-version must be an exact version");
    expect(h.out()).toContain("result=error");
  });

  it("installs the exact pinned version and checks with --format json and the given baseline path", () => {
    const h = harness({ checkStatus: 0, checkStdout: JSON.stringify(NO_DRIFT), inputs: { INPUT_INVENTORY_PATH: "docs/inv.json" } });

    expect(action.main(h.deps)).toBe(0);
    expect(h.calls[0].command).toBe("npm");
    expect(h.calls[0].args).toContain("srclawyer@0.7.0");
    expect(h.calls[1].args.slice(-5)).toEqual(["check", "--format", "json", "--inventory", "docs/inv.json"]);
    expect(h.out()).toContain("result=no-drift");
    expect(h.summary()).toContain("no new items found");
  });

  it("installs a pinned commit as given", () => {
    const spec = `github:SrcLawyer/srclawyer#${SHA}`;
    const h = harness({ inputs: { INPUT_SRCLAWYER_VERSION: spec }, checkStatus: 0, checkStdout: JSON.stringify(NO_DRIFT) });

    action.main(h.deps);

    expect(h.calls[0].args).toContain(spec);
  });

  it("drift fails the step, annotates, writes outputs, and the summary lists added and removed with the fix", () => {
    const h = harness({ checkStatus: 1, checkStdout: JSON.stringify(DRIFT) });

    expect(action.main(h.deps)).toBe(1);
    expect(h.logs.join("\n")).toContain("::error title=SrcLawyer drift check::Drift detected: added category:phone, processor:Twilio; removed processor:Stripe.");
    expect(h.out()).toContain("result=drift");
    expect(h.out()).toContain("added=category:phone,processor:Twilio");
    expect(h.out()).toContain("removed=processor:Stripe");
    expect(h.summary()).toContain("| Processors | `Twilio` | `Stripe` |");
    expect(h.summary()).toContain("**To fix:**");
  });

  it("with fail-on-drift false, drift is a warning and the step passes", () => {
    const h = harness({ checkStatus: 1, checkStdout: JSON.stringify(DRIFT), inputs: { INPUT_FAIL_ON_DRIFT: "false" } });

    expect(action.main(h.deps)).toBe(0);
    expect(h.logs.join("\n")).toContain("::warning title=SrcLawyer drift check::Drift detected");
  });

  it("inconclusive passes with a warning by default, and fails only with fail-on-inconclusive", () => {
    const warn = harness({ checkStatus: 3, checkStdout: JSON.stringify(INCONCLUSIVE) });
    expect(action.main(warn.deps)).toBe(0);
    expect(warn.logs.join("\n")).toContain("::warning title=SrcLawyer drift check::No drift verdict");
    expect(warn.out()).toContain("result=inconclusive");

    const strict = harness({ checkStatus: 3, checkStdout: JSON.stringify(INCONCLUSIVE), inputs: { INPUT_FAIL_ON_INCONCLUSIVE: "true" } });
    expect(action.main(strict.deps)).toBe(1);
  });

  it("a crash (exit 2) always fails, and surfaces the CLI's message", () => {
    const h = harness({ checkStatus: 2, checkStdout: JSON.stringify({ result: "error", error: "no baseline found at .srclawyer.inventory.json. Create one…" }), inputs: { INPUT_FAIL_ON_DRIFT: "false" } });

    expect(action.main(h.deps)).toBe(1);
    expect(h.logs.join("\n")).toContain("no baseline found");
  });

  it("unparseable output from the CLI is an error", () => {
    const h = harness({ checkStatus: 0, checkStdout: "not json" });
    expect(action.main(h.deps)).toBe(1);
    expect(h.out()).toContain("result=error");
  });

  it("an install failure is an error", () => {
    const h = harness({ installStatus: 1 });
    expect(action.main(h.deps)).toBe(1);
    expect(h.calls.map((c) => c.command)).toEqual(["npm"]);
  });

  it("forwards the CLI's stderr to the log", () => {
    const h = harness({ checkStatus: 0, checkStdout: JSON.stringify(NO_DRIFT) });
    action.main(h.deps);
    expect(h.logs).toContain("scan chatter");
  });
});

describe("main: optional pull request comment", () => {
  const PR_EVENT = { pull_request: { number: 7, head: { repo: { full_name: "acme/app" } } } };
  const prInputs = { INPUT_PR_COMMENT: "true", INPUT_GITHUB_TOKEN: "ghs_test_token" };
  const ghCalls = (h: ReturnType<typeof harness>) => h.calls.filter((c) => c.command === "gh");

  it("creates one marked comment on drift", () => {
    const h = harness({ checkStatus: 1, checkStdout: JSON.stringify(DRIFT), event: PR_EVENT, eventName: "pull_request", inputs: prInputs });

    action.main(h.deps);

    const post = ghCalls(h).find((c) => c.args.includes("POST"))!;
    expect(post.args).toContain("repos/acme/app/issues/7/comments");
    expect(post.args.join(" ")).toContain(action.COMMENT_MARKER);
  });

  it("updates its own earlier comment instead of adding another", () => {
    const h = harness({
      checkStatus: 1,
      checkStdout: JSON.stringify(DRIFT),
      event: PR_EVENT,
      eventName: "pull_request",
      inputs: prInputs,
      ghComments: JSON.stringify({ id: 99, body: `${action.COMMENT_MARKER}\nold` }) + "\n" + JSON.stringify({ id: 5, body: "someone else" }) + "\n",
    });

    action.main(h.deps);

    const patch = ghCalls(h).find((c) => c.args.includes("PATCH"))!;
    expect(patch.args).toContain("repos/acme/app/issues/comments/99");
    expect(ghCalls(h).some((c) => c.args.includes("POST"))).toBe(false);
  });

  it("says nothing on a clean run when there is no earlier comment, and updates it to 'no new items found' when there is", () => {
    const clean = harness({ checkStatus: 0, checkStdout: JSON.stringify(NO_DRIFT), event: PR_EVENT, eventName: "pull_request", inputs: prInputs });
    action.main(clean.deps);
    expect(ghCalls(clean).filter((c) => c.args.includes("POST") || c.args.includes("PATCH"))).toEqual([]);

    const resolved = harness({
      checkStatus: 0,
      checkStdout: JSON.stringify(NO_DRIFT),
      event: PR_EVENT,
      eventName: "pull_request",
      inputs: prInputs,
      ghComments: JSON.stringify({ id: 99, body: `${action.COMMENT_MARKER}\nold` }) + "\n",
    });
    action.main(resolved.deps);
    expect(ghCalls(resolved).some((c) => c.args.includes("PATCH") && c.args.join(" ").includes("no new items found"))).toBe(true);
  });

  it("is skipped for pull requests from forks, for non-PR events, and without the option", () => {
    const fork = harness({ checkStatus: 1, checkStdout: JSON.stringify(DRIFT), event: { pull_request: { number: 7, head: { repo: { full_name: "evil/app" } } } }, eventName: "pull_request", inputs: prInputs });
    expect(action.main(fork.deps)).toBe(1);
    expect(ghCalls(fork)).toEqual([]);

    const push = harness({ checkStatus: 1, checkStdout: JSON.stringify(DRIFT), inputs: prInputs });
    action.main(push.deps);
    expect(ghCalls(push)).toEqual([]);

    const off = harness({ checkStatus: 1, checkStdout: JSON.stringify(DRIFT), event: PR_EVENT, eventName: "pull_request" });
    action.main(off.deps);
    expect(ghCalls(off)).toEqual([]);
  });

  it("a failing gh never changes the check result", () => {
    const h = harness({ checkStatus: 3, checkStdout: JSON.stringify(INCONCLUSIVE), event: PR_EVENT, eventName: "pull_request", inputs: prInputs, ghStatus: 1 });

    expect(action.main(h.deps)).toBe(0);
    expect(h.logs.join("\n")).toContain("pr-comment skipped: could not list comments");
  });

  it("passes the token only to gh, through its environment", () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const h = harness({ checkStatus: 1, checkStdout: JSON.stringify(DRIFT), event: PR_EVENT, eventName: "pull_request", inputs: prInputs });
    const original = h.deps.run;
    h.deps.run = ((command: string, args: string[], options?: { env?: Record<string, string> }) => {
      if (command === "gh") seen.push(options?.env);
      return (original as (c: string, a: string[]) => unknown)(command, args);
    }) as typeof h.deps.run;

    action.main(h.deps);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((env) => env?.GH_TOKEN === "ghs_test_token")).toBe(true);
  });
});

describe("action.yml", () => {
  const manifest = yaml.load(readFileSync(join(ROOT, "action.yml"), "utf8")) as {
    inputs: Record<string, { required?: boolean; default?: string }>;
    outputs: Record<string, unknown>;
    runs: { using: string; steps: Array<{ uses?: string; run?: string; env?: Record<string, string> }> };
  };
  const text = readFileSync(join(ROOT, "action.yml"), "utf8");

  it("declares exactly the documented inputs -- and no config-path", () => {
    expect(Object.keys(manifest.inputs).sort()).toEqual(["fail-on-drift", "fail-on-inconclusive", "github-token", "inventory-path", "path", "pr-comment", "srclawyer-version"]);
    expect(manifest.inputs["srclawyer-version"].required).toBe(true);
    expect(manifest.inputs["fail-on-drift"].default).toBe("true");
    expect(manifest.inputs["fail-on-inconclusive"].default).toBe("false");
    expect(manifest.inputs["pr-comment"].default).toBe("false");
    expect(manifest.inputs["inventory-path"].default).toBe(".srclawyer.inventory.json");
  });

  it("exposes result, added and removed", () => {
    expect(Object.keys(manifest.outputs).sort()).toEqual(["added", "removed", "result"]);
  });

  it("is a composite action whose third-party steps are pinned to a full commit sha", () => {
    expect(manifest.runs.using).toBe("composite");
    const uses = manifest.runs.steps.map((s) => s.uses).filter(Boolean) as string[];
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("needs no secrets, and every input reaches run.mjs through the environment run.mjs reads", () => {
    expect(text).not.toMatch(/secrets\./);
    const env = manifest.runs.steps.find((s) => s.run)!.env!;
    expect(Object.keys(env).sort()).toEqual(
      ["INPUT_FAIL_ON_DRIFT", "INPUT_FAIL_ON_INCONCLUSIVE", "INPUT_GITHUB_TOKEN", "INPUT_INVENTORY_PATH", "INPUT_PATH", "INPUT_PR_COMMENT", "INPUT_SRCLAWYER_VERSION"].sort()
    );
    for (const name of Object.keys(env)) expect(readFileSync(join(ROOT, "action/run.mjs"), "utf8")).toContain(name);
  });

  it("points at a script that exists", () => {
    expect(manifest.runs.steps.find((s) => s.run)!.run).toContain("action/run.mjs");
    expect(existsSync(join(ROOT, "action/run.mjs"))).toBe(true);
  });
});

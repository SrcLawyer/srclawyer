import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { scan } from "../engine/scanEngine.js";
import { selectDiscovery } from "../engine/gitDiscovery.js";
import { resolveScanProtectedLogic } from "./protectedLogicStep.js";
import { DEFAULT_INVENTORY_PATH, computeInventory, inventoryBlockers, parseInventory, serializeInventory } from "../inventory/inventory.js";
import { renderWorkflow, WORKFLOW_RELATIVE_PATH } from "../ci/workflow.js";
import { CI_INIT } from "../assistant/wording.js";
import { NETWORK_CALLS_NOTICE } from "../policy/legalNotices.js";
import { EXIT_CRASH, EXIT_OK } from "../exitCodes.js";
import { readPackageVersion } from "../version.js";

export interface CiInitOptions {
  /** Skip the question. */
  yes: boolean;
  /** Testing only: what `srclawyer-version` is pinned to. Default: this CLI's version. */
  versionSpec?: string;
  /** Testing only: the ref of the Action. Default: `v<this CLI's version>`. */
  actionRef?: string;
}

export interface CiInitIo {
  isTTY: boolean;
  ask: (question: string) => Promise<string>;
  /** Random integer in [0, n); injectable so the schedule is testable. */
  random: (n: number) => number;
}

function defaultIo(): CiInitIo {
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
    random: (n) => Math.floor(Math.random() * n),
  };
}

function git(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.error || result.status !== 0 ? null : result.stdout.trim();
}

/** The repository's default branch (`origin/HEAD`), or `main` when it cannot be found. */
export function defaultBranch(cwd: string): string {
  const ref = git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  return ref?.startsWith("origin/") && ref.length > "origin/".length ? ref.slice("origin/".length) : "main";
}

const sameDir = (a: string, b: string): boolean => realpathSync(a) === realpathSync(b);

/**
 * `srclawyer ci init`: with the owner's yes, writes one GitHub workflow (never over an existing file) and,
 * if there is none, the baseline. Writes the baseline first, because it can fail, and leaves no workflow
 * behind if it does. Never touches the policy, never commits or pushes, never changes a GitHub setting.
 */
export async function runCiInit(root: string, options: CiInitOptions, io: CiInitIo = defaultIo()): Promise<number> {
  const refuse = (message: string): number => {
    console.error(message);
    return EXIT_CRASH;
  };

  const toplevel = git(root, ["rev-parse", "--show-toplevel"]);
  if (!toplevel) return refuse(CI_INIT.notGit);
  const workflowPath = join(toplevel, WORKFLOW_RELATIVE_PATH);
  // lstat, not exists: a dangling symlink or a directory at that path counts as "something is there".
  try {
    lstatSync(workflowPath);
    return refuse(CI_INIT.exists);
  } catch {
    /* nothing there */
  }

  const baselinePath = join(root, DEFAULT_INVENTORY_PATH);
  const baselineExists = existsSync(baselinePath);

  if (!baselineExists) console.log(`${NETWORK_CALLS_NOTICE}\n`);
  console.log(
    [CI_INIT.intro, CI_INIT.createWorkflow, baselineExists ? CI_INIT.keepBaseline : CI_INIT.createBaseline, CI_INIT.unchanged, CI_INIT.reports].join("\n")
  );
  if (!options.yes) {
    if (!io.isTTY) return refuse(CI_INIT.needsYes);
    if (!/^y(es)?$/i.test((await io.ask(CI_INIT.prompt)).trim())) return refuse(CI_INIT.declined);
  }

  let createdBaseline = false;
  if (!baselineExists) {
    const discovery = selectDiscovery(root);
    const result = await scan(root, { onlyFiles: discovery.files });
    if (result.workspaceWarning) console.error(result.workspaceWarning);
    if (result.skippedFilesWarning) console.error(result.skippedFilesWarning);
    if (result.templateSyntaxNote) console.error(result.templateSyntaxNote);
    const protectedLogic = await resolveScanProtectedLogic(result);
    if (protectedLogic.warning) console.error(protectedLogic.warning);
    if (result.unsupportedStackWarning) console.error(result.unsupportedStackWarning);
    const blockers = inventoryBlockers(result, protectedLogic.warning);
    if (blockers.length > 0) {
      for (const reason of blockers) console.error(reason);
      return refuse(CI_INIT.baselineFailed);
    }
    writeFileSync(baselinePath, serializeInventory(computeInventory(protectedLogic.findings, { srclawyerVersion: readPackageVersion(), discovery: discovery.mode })));
    createdBaseline = true;
  }

  const version = readPackageVersion();
  const folder = sameDir(root, toplevel) ? "" : relative(realpathSync(toplevel), realpathSync(root)).split("\\").join("/");
  const branch = defaultBranch(root);
  const body = renderWorkflow({
    branch,
    versionSpec: options.versionSpec ?? version,
    actionRef: options.actionRef ?? `v${version}`,
    folder,
    schedule: { minute: 1 + io.random(59), hour: io.random(24), weekday: io.random(7) },
  });
  try {
    mkdirSync(dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, body, { flag: "wx" });
  } catch (error) {
    // Lost a race with another writer, or the folder cannot be created: leave nothing of ours behind.
    if (createdBaseline) rmSync(baselinePath, { force: true });
    return refuse((error as NodeJS.ErrnoException).code === "EEXIST" ? CI_INIT.exists : `${(error as Error).message}\n${CI_INIT.declined}`);
  }

  console.log(CI_INIT.createdWorkflow);
  console.log(baselineExists ? CI_INIT.keptBaseline : CI_INIT.createdBaseline);
  console.log([CI_INIT.commitIntro, CI_INIT.commitAdd, CI_INIT.commitCommit, CI_INIT.commitPush].join("\n"));
  console.log(CI_INIT.runsOn.replaceAll("{branch}", branch));
  console.log(CI_INIT.stop);
  const parsed = parseInventory(readFileSync(baselinePath, "utf8"));
  if (!parsed.ok || parsed.inventory.approval === undefined) console.log(CI_INIT.notApproved);
  return EXIT_OK;
}

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { DiscoveryMode } from "../inventory/inventory.js";

/**
 * The shared discovery mode for the drift baseline (`scan --write-inventory`) and `check`. A baseline
 * written on a laptop and checked on a CI runner must see the same files, but the ordinary walk also
 * sees whatever untracked, gitignored output happens to be on disk (generated code, local scratch
 * dirs) that a clean checkout never has -- which would show up as phantom drift. So inside a git
 * repository both sides use `git ls-files --cached --others --exclude-standard` (tracked, plus
 * untracked-but-not-ignored); anywhere else, the ordinary walk. `scan`'s own default discovery is not
 * changed. The mode is recorded in the baseline, and a mismatch is reported as inconclusive.
 */
export type DiscoverySelection =
  | { mode: "git"; files: Set<string> }
  | { mode: "glob"; files: null; reason: string };

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

export function selectDiscovery(root: string): DiscoverySelection {
  const git = (args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "buffer", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 512 * 1024 * 1024 });

  try {
    git(["rev-parse", "--is-inside-work-tree"]);
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
    const reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "git is not installed" : stderr.includes("not a git repository") ? "not a git repository" : `git is not usable here (${firstLine(stderr) || "unknown error"})`;
    return { mode: "glob", files: null, reason };
  }

  try {
    const listing = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).toString("utf8");
    const files = new Set<string>();
    for (const relative of listing.split("\0")) if (relative) files.add(resolve(root, relative));
    return { mode: "git", files };
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
    return { mode: "glob", files: null, reason: `git ls-files failed (${firstLine(stderr) || "unknown error"})` };
  }
}

export function discoveryMode(selection: DiscoverySelection): DiscoveryMode {
  return selection.mode;
}

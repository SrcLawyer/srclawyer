#!/usr/bin/env node
"use strict";

/**
 * Advisory-only PATH check, run via the "postinstall" lifecycle hook. Plain, dependency-free
 * CommonJS (not compiled from src/) on purpose: postinstall fires BEFORE "prepare" in npm's
 * lifecycle order, so dist/ doesn't exist yet during this repo's own `npm install` -- a compiled
 * script referencing dist/ would break every contributor's first install. A real, pre-built
 * tarball install (the actual target of this check) always has this file on disk already.
 *
 * IMPORTANT, confirmed empirically: npm (v7+) does NOT share stdio with lifecycle scripts by
 * default -- normal process.stdout/stderr writes from here are silently swallowed for a plain
 * `npm install -g`, visible only with the rarely-used --foreground-scripts flag. Exiting non-zero
 * to force visibility was tried and rejected -- it doesn't just print an ugly error, it makes npm
 * abort the install entirely (the package's files never get placed), which is worse than saying
 * nothing. Writing directly to the controlling terminal device (bypassing the suppressed stdio) is
 * the standard real-world workaround for this exact npm behavior, so that's what this does, with a
 * plain stderr write as the fallback for when there's no TTY to open (CI, non-interactive installs)
 * -- at that point this is genuinely best-effort, not guaranteed.
 *
 * Never fails the install over this: worst case is silence, never a non-zero exit or a thrown
 * error reaching npm's own install process.
 */

const fs = require("node:fs");
const path = require("node:path");

function pathImplFor(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function globalBinDir(prefix, platform) {
  if (!prefix) return null;
  return platform === "win32" ? prefix : pathImplFor(platform).join(prefix, "bin");
}

function normalize(p, platform) {
  let resolved = pathImplFor(platform).resolve(p).replace(/[\\/]+$/, "");
  if (platform === "win32" || platform === "darwin") resolved = resolved.toLowerCase();
  return resolved;
}

/** Pure, testable: is `dir` present among `pathEnv`'s entries, resolved and normalized? */
function isDirOnPath(dir, pathEnv, platform) {
  if (!dir) return true; // can't determine the target dir -- don't false-positive a warning
  const target = normalize(dir, platform);
  const delimiter = platform === "win32" ? ";" : ":";
  const entries = (pathEnv || "").split(delimiter).filter(Boolean);
  return entries.some((entry) => normalize(entry, platform) === target);
}

function printWarning(message) {
  // npm doesn't share stdio with lifecycle scripts by default -- a plain stderr write here is
  // silently swallowed for a normal `npm install -g`. Writing straight to the controlling terminal
  // bypasses that. Falls back to stderr (visible with --foreground-scripts, or if something else
  // in the chain does share stdio) when there's no TTY to open -- CI, piped/non-interactive installs.
  try {
    const ttyPath = process.platform === "win32" ? "\\\\.\\CON" : "/dev/tty";
    const fd = fs.openSync(ttyPath, "w");
    try {
      fs.writeSync(fd, message);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    try {
      process.stderr.write(message);
    } catch {
      // Truly nothing we can do -- advisory only, never throw from here.
    }
  }
}

function main() {
  try {
    if (process.env.npm_config_global !== "true") return; // local/dependency install, or npx -- not our concern

    const bin = globalBinDir(process.env.npm_config_prefix, process.platform);
    if (isDirOnPath(bin, process.env.PATH, process.platform)) return;

    printWarning(
      [
        "",
        '⚠ srclawyer installed, but the "srclawyer" command isn’t on your PATH yet.',
        "  This is often caused by tools like conda (auto_activate_base) rearranging PATH ahead of",
        "  npm's global bin directory. Try opening a new terminal window first.",
        "  If that doesn't fix it, see the Troubleshooting section in the README:",
        "  https://github.com/SrcLawyer/srclawyer#troubleshooting-command-not-found",
        "",
      ].join("\n")
    );
  } catch {
    // Advisory only -- never let this check itself break an install.
  }
}

main();

module.exports = { isDirOnPath, globalBinDir, normalize };

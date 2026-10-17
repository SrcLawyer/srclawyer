import { describe, expect, it, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], cwd?: string) {
  if (!cwd) {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-exit-"));
    cwd = dir;
  }
  return spawnSync("npx", ["tsx", join(ROOT, "src/cli.ts"), ...args], { cwd, encoding: "utf8", input: "" });
}

describe("exit codes: 0 clean, 1 completed with warnings, 2 crash or bad usage", () => {
  it("--version and --help exit 0", () => {
    expect(run(["--version"]).status).toBe(0);
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: srclawyer");
  });

  it("a scan with nothing to report exits 0", () => {
    const result = run(["scan"]);
    expect(result.status).toBe(0);
  });

  it("a scan that completes with a warning still exits 1 (unchanged)", () => {
    const result = run(["scan"], (() => {
      dir = mkdtempSync(join(tmpdir(), "srclawyer-exit-"));
      writeFileSync(join(dir, "manage.py"), "# django\n");
      return dir;
    })());
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Django");
  });

  it("an unknown option exits 2 and says why", () => {
    const result = run(["scan", "--no-such-flag"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown option");
  });

  it("an unknown command exits 2", () => {
    expect(run(["frobnicate"]).status).toBe(2);
  });

  it("a validation error raised by a command (invalid --minimum-age) exits 2", () => {
    const result = run(["init", "--minimum-age", "abc"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--minimum-age must be a whole, non-negative number");
  });

  it("a crash during a command (--out into a directory that doesn't exist) exits 2, not 1", () => {
    const result = run(["scan", "--out", "no/such/dir/POLICY.md"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/ENOENT/);
    expect(existsSync(join(dir, "no"))).toBe(false);
  });
});

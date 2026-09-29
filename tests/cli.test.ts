import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/**
 * Spawns the real CLI entry point rather than importing src/cli.ts directly -- it calls
 * program.parseAsync(process.argv) as a module-load side effect, so there's no way to exercise it
 * in-process without also running the whole command. Catches exactly the kind of drift a clean
 * `npm install` + run of the packed tarball would catch: --version had been hardcoded to "0.1.0"
 * and silently never matched package.json through several real version bumps, with nothing here to
 * notice until an actual install simulation was run by hand.
 */
describe("cli --version", () => {
  it("matches package.json's version, not a hardcoded literal", () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
    const output = execFileSync("npx", ["tsx", join(ROOT, "src/cli.ts"), "--version"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();

    expect(output).toBe(version);
  });
});

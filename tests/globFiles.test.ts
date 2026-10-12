import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globFiles } from "../src/engine/globFiles.js";

let dir: string;

function makeTree(files: string[]): string {
  dir = mkdtempSync(join(tmpdir(), "srclawyer-glob-"));
  for (const f of files) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), "");
  }
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("globFiles", () => {
  it("returns absolute paths, sorted, honoring ignore and dot:false", async () => {
    const root = makeTree(["b/x.ts", "a/y.ts", "a/node_modules/z.ts", ".hidden/h.ts", "a/y.test.ts"]);
    const found = await globFiles(["**/*.ts"], { cwd: root, absolute: true, ignore: ["**/node_modules/**", "**/*.test.*"], dot: false });
    expect(found).toEqual([join(root, "a/y.ts"), join(root, "b/x.ts")]);
  });

  it("matches only what a pattern names -- a matched directory is not expanded to its contents", async () => {
    const root = makeTree(["packages/ui/index.ts"]);
    expect(await globFiles(["packages/*"], { cwd: root, absolute: true })).toEqual([]);
  });

  it("handles brace alternation and negation", async () => {
    const root = makeTree(["apps/web/package.json", "packages/ui/package.json", "packages/ignored/package.json", "tools/cli/package.json"]);
    const found = await globFiles(["{apps,packages}/*/package.json", "!packages/ignored/package.json"], { cwd: root, absolute: true });
    expect(found).toEqual([join(root, "apps/web/package.json"), join(root, "packages/ui/package.json")]);
  });

  it("is not driven to a crash or a stall by a short cartesian brace pattern (defense in depth behind the validator)", async () => {
    const root = makeTree(["a/package.json"]);
    const started = Date.now();
    expect(await globFiles(["{1..300}{1..300}{1..300}/package.json"], { cwd: root, absolute: true })).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

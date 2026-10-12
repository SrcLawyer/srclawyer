import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { discoverProjects } from "../src/engine/discoverProjects.js";
import { RootBoundary } from "../src/engine/rootBoundary.js";

let dir: string;

function makeRepo(packageJson: string, packages: string[] = []): string {
  dir = mkdtempSync(join(tmpdir(), "srclawyer-discover-"));
  writeFileSync(join(dir, "package.json"), packageJson);
  for (const p of packages) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "package.json"), "{}");
  }
  return dir;
}

async function projectRoots(root: string): Promise<{ roots: string[]; warning: string | null }> {
  const { projects, workspaceWarning } = await discoverProjects(root, new RootBoundary(root));
  return { roots: projects.map((p) => relative(root, p.root)).sort(), warning: workspaceWarning };
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("discoverProjects: legitimate workspace configs", () => {
  const packages = ["apps/web", "apps/api", "packages/ui", "packages/core/nested", "tools/cli", "tools/cli/packages/inner", "packages/ignored"];

  it.each([
    [["packages/*"], ["packages/ignored", "packages/ui"]],
    [["apps/*"], ["apps/api", "apps/web"]],
    [["{apps,packages}/*"], ["apps/api", "apps/web", "packages/ignored", "packages/ui"]],
    [["packages/**", "!packages/ignored"], ["packages/core/nested", "packages/ui"]],
    [["tools/*/packages/*"], ["tools/cli/packages/inner"]],
  ])("%j", async (patterns, expected) => {
    const root = makeRepo(JSON.stringify({ workspaces: patterns }), packages);
    const { roots, warning } = await projectRoots(root);
    expect(roots).toEqual(expected);
    expect(warning).toBeNull();
  });

  it("reads the { packages: [...] } form", async () => {
    const root = makeRepo(JSON.stringify({ workspaces: { packages: ["apps/*"] } }), packages);
    expect((await projectRoots(root)).roots).toEqual(["apps/api", "apps/web"]);
  });

  it("accepts a BOM-prefixed package.json and still honors its workspaces", async () => {
    const root = makeRepo("\uFEFF" + JSON.stringify({ workspaces: ["apps/*"] }), packages);
    const { roots, warning } = await projectRoots(root);
    expect(roots).toEqual(["apps/api", "apps/web"]);
    expect(warning).toBeNull();
  });

  it("no workspaces key means the root project, with no warning", async () => {
    const root = makeRepo(JSON.stringify({ name: "x" }), packages);
    const { roots, warning } = await projectRoots(root);
    expect(roots).toEqual([""]);
    expect(warning).toBeNull();
  });
});

describe("discoverProjects: rejected workspace configs fall back to defaults with a warning", () => {
  const defaultsLayout = ["packages/ui", "apps/web", "elsewhere/secret"];

  async function expectFallback(packageJson: string): Promise<void> {
    const root = makeRepo(packageJson, defaultsLayout);
    const started = Date.now();
    const { roots, warning } = await projectRoots(root);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(roots).toEqual(["apps/web", "packages/ui"]);
    expect(warning).toContain("rejected");
    expect(warning).toContain("packages/*, apps/*");
    expect(warning).toContain("may be incomplete");
  }

  it("the 37-character cartesian range pattern", async () => {
    await expectFallback(JSON.stringify({ workspaces: ["{1..300}{1..300}{1..300}"] }));
  });

  it("deeply nested braces", async () => {
    await expectFallback(JSON.stringify({ workspaces: ["{".repeat(500) + "a" + "}".repeat(500)] }));
  });

  it("'..' escaping and absolute paths", async () => {
    await expectFallback(JSON.stringify({ workspaces: ["../*"] }));
    await expectFallback(JSON.stringify({ workspaces: ["/etc/*"] }));
  });

  it("non-array and non-string workspaces", async () => {
    await expectFallback(JSON.stringify({ workspaces: 5 }));
    await expectFallback(JSON.stringify({ workspaces: { packages: "x" } }));
    await expectFallback(JSON.stringify({ workspaces: [1] }));
    await expectFallback(JSON.stringify({ workspaces: [null, "apps/*"] }));
  });

  it("an unparseable package.json", async () => {
    await expectFallback("{oops");
  });

  it("falls back to the root project, still with the warning, when the defaults match nothing", async () => {
    const root = makeRepo(JSON.stringify({ workspaces: ["../*"] }), ["elsewhere/secret"]);
    const { roots, warning } = await projectRoots(root);
    expect(roots).toEqual([""]);
    expect(warning).toContain("rejected");
  });
});

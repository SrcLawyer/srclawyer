import { describe, expect, it, afterEach } from "vitest";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { selectDiscovery } from "../src/engine/gitDiscovery.js";
import { scan } from "../src/engine/scanEngine.js";
import { initRepo, tempDir, writeFiles } from "./support/gitFixture.js";

const dirs: string[] = [];
const fresh = () => {
  const d = tempDir();
  dirs.push(d);
  return d;
};

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("selectDiscovery", () => {
  it("in a git repo: tracked plus untracked-not-ignored, never ignored files", () => {
    const root = fresh();
    initRepo(root, { ".gitignore": "generated/\n", "src/tracked.js": "x", "generated/out.js": "x" });
    writeFiles(root, { "src/untracked.js": "x", "generated/more.js": "x" });

    const selection = selectDiscovery(root);

    expect(selection.mode).toBe("git");
    const names = [...selection.files!].map((f) => f.slice(root.length + 1)).sort();
    expect(names).toEqual([".gitignore", "src/tracked.js", "src/untracked.js"]);
  });

  it("outside a git repo: the ordinary walk, with the reason", () => {
    const root = fresh();
    writeFiles(root, { "a.js": "x" });

    const selection = selectDiscovery(root);

    expect(selection).toEqual({ mode: "glob", files: null, reason: "not a git repository" });
  });

  it("from a subdirectory of a repo, lists only what is under that directory", () => {
    const root = fresh();
    initRepo(root, { "app/a.js": "x", "other/b.js": "x" });

    const selection = selectDiscovery(join(root, "app"));

    expect(selection.mode).toBe("git");
    expect([...selection.files!].map((f) => f.slice(root.length + 1))).toEqual(["app/a.js"]);
  });
});

describe("scan() honors the discovery restriction, and its default is unchanged", () => {
  it("an ignored directory is invisible in git mode but still scanned by default", async () => {
    const root = fresh();
    initRepo(root, { ".gitignore": "generated/\n", "src/app.js": "const { email } = req.body;\n" });
    mkdirSync(join(root, "generated"));
    writeFiles(root, { "generated/leak.js": "const { ssn } = req.body;\n" });

    const defaultScan = await scan(root);
    const gitScan = await scan(root, { onlyFiles: selectDiscovery(root).files });

    expect(defaultScan.findings.some((f) => f.dataCategories.includes("government_id"))).toBe(true);
    expect(gitScan.findings.some((f) => f.dataCategories.includes("government_id"))).toBe(false);
    expect(gitScan.findings.some((f) => f.dataCategories.includes("email"))).toBe(true);
  });

  it("existing ignore patterns still apply on top of the restriction (node_modules stays out even if untracked)", async () => {
    const root = fresh();
    initRepo(root, { "src/app.js": "const { email } = req.body;\n" });
    writeFiles(root, { "node_modules/pkg/index.js": "const { ssn } = req.body;\n" });

    const gitScan = await scan(root, { onlyFiles: selectDiscovery(root).files });

    expect(gitScan.findings.some((f) => f.dataCategories.includes("government_id"))).toBe(false);
  });
});

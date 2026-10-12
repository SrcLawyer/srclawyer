import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan } from "../src/engine/scanEngine.js";
import { runScan } from "../src/commands/scan.js";
import { RootBoundary } from "../src/engine/rootBoundary.js";
import { buildTsProject } from "../src/engine/tsProject.js";

let base: string;
const originalExitCode = process.exitCode;

afterEach(() => {
  if (base) rmSync(base, { recursive: true, force: true });
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

// <base>/repo is the scanned root; <base>/outside is somewhere a hostile repo points symlinks at.
function makeWorld(): { repo: string; outside: string } {
  base = mkdtempSync(join(tmpdir(), "srclawyer-symlinks-"));
  const repo = join(base, "repo");
  const outside = join(base, "outside");
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(outside, "dir"), { recursive: true });
  writeFileSync(join(repo, "src/own.js"), "const { email } = req.body;\n");
  writeFileSync(join(outside, "dir/leak.js"), "const { outside_dir_marker } = req.body;\n");
  writeFileSync(join(outside, "secret.js"), "const { outside_file_marker } = req.body;\n");
  return { repo, outside };
}

describe("out-of-root symlinks are never read or followed", () => {
  it("a directory symlink pointing outside is not walked; nothing from it, and no outside path, reaches the result", async () => {
    const { repo } = makeWorld();
    symlinkSync(join(base, "outside/dir"), join(repo, "src/linkdir"));

    const result = await scan(repo);

    expect(result.findings.map((f) => f.location.file)).toEqual(["src/own.js"]);
    expect(result.skippedFiles).toEqual([{ file: "src/linkdir", reason: "symlink-outside-root" }]);
    const everything = JSON.stringify(result);
    expect(everything).not.toContain("outside_dir_marker");
    expect(everything).not.toContain(join(base, "outside"));
    expect(everything).not.toContain(join(realpathSync(base), "outside"));
  });

  it("a file symlink pointing outside is not read", async () => {
    const { repo } = makeWorld();
    symlinkSync(join(base, "outside/secret.js"), join(repo, "src/linkfile.js"));

    const result = await scan(repo);

    expect(result.findings.map((f) => f.location.file)).toEqual(["src/own.js"]);
    expect(result.skippedFiles).toEqual([{ file: "src/linkfile.js", reason: "symlink-outside-root" }]);
    expect(JSON.stringify(result)).not.toContain("outside_file_marker");
  });

  it("a symlink to the filesystem root is refused outright, not walked", async () => {
    const { repo } = makeWorld();
    symlinkSync("/", join(repo, "src/everything"));

    const started = Date.now();
    const result = await scan(repo);

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.skippedFiles).toEqual([{ file: "src/everything", reason: "symlink-outside-root" }]);
    expect(result.findings.map((f) => f.location.file)).toEqual(["src/own.js"]);
  });

  it("a symlink resolving outside via an intermediate in-root link is still caught", async () => {
    const { repo } = makeWorld();
    symlinkSync(join(base, "outside/dir"), join(repo, "hop"));
    symlinkSync(join(repo, "hop"), join(repo, "src/twohop"));

    const result = await scan(repo);

    expect(JSON.stringify(result.findings)).not.toContain("outside_dir_marker");
    expect(result.skippedFiles.every((s) => s.reason === "symlink-outside-root")).toBe(true);
    expect(result.skippedFiles.length).toBeGreaterThan(0);
  });

  it("the read-time check refuses an out-of-root file even if discovery had returned it", () => {
    const { repo } = makeWorld();
    symlinkSync(join(base, "outside/secret.js"), join(repo, "src/linkfile.js"));
    const boundary = new RootBoundary(repo);

    expect(boundary.allowsPath(join(repo, "src/linkfile.js"))).toBe(false);
    expect(boundary.allowsPath(join(repo, "src/own.js"))).toBe(true);
    expect(boundary.allowsPath(join(repo, "src/does-not-exist.js"))).toBe(false);
    expect(boundary.blockedLinks()).toEqual(["src/linkfile.js"]);
  });

  it("an import crossing an out-of-root symlink does not pull the outside file's type members into findings", async () => {
    const { repo, outside } = makeWorld();
    writeFileSync(join(outside, "types.ts"), "export interface SignupRequest { outside_ssn: string; outside_email: string }\n");
    symlinkSync(outside, join(repo, "src/linked"));
    writeFileSync(
      join(repo, "src/route.ts"),
      'import type { SignupRequest } from "./linked/types";\nexport async function POST(request: Request) {\n  const body: SignupRequest = await request.json();\n}\n'
    );
    writeFileSync(
      join(repo, "src/local.ts"),
      "export interface LocalReq { local_email: string }\nexport async function POST2(request: Request) {\n  const body: LocalReq = await request.json();\n}\n"
    );

    const result = await scan(repo);

    const typeFindings = result.findings.filter((f) => f.source === "type-rule");
    expect(typeFindings.map((f) => f.location.file)).toEqual(["src/local.ts"]);
    expect(JSON.stringify(result.findings)).not.toMatch(/outside_(ssn|email)/);
  });

  it("buildTsProject with a boundary resolves in-root types but not types behind an out-of-root link", () => {
    const { repo, outside } = makeWorld();
    writeFileSync(join(outside, "t.ts"), "export interface Out { a: string }\n");
    symlinkSync(outside, join(repo, "src/linked"));
    writeFileSync(join(repo, "src/in.ts"), "export interface In { b: string }\n");
    const file = join(repo, "src/use.ts");
    writeFileSync(file, 'import type { Out } from "./linked/t";\nimport type { In } from "./in";\nconst x: Out = null as any;\nconst y: In = null as any;\n');
    const project = buildTsProject([file, join(repo, "src/in.ts")], new RootBoundary(repo));

    expect(project.getObjectTypeMembersAt(file, 4, 6)).toEqual(["b"]);
    expect(project.getObjectTypeMembersAt(file, 3, 6)).toBeNull();
  });
});

describe("in-root symlinks and loops keep working", () => {
  it("scans files reachable only through an in-root directory symlink, with no warning", async () => {
    const { repo } = makeWorld();
    // build/ is ignored by discovery, so lib/x.js is only reachable through the link.
    mkdirSync(join(repo, "build/lib"), { recursive: true });
    writeFileSync(join(repo, "build/lib/x.js"), "const { phone } = req.body;\n");
    symlinkSync(join(repo, "build/lib"), join(repo, "src/lib"));

    const result = await scan(repo);

    expect(result.findings.map((f) => f.location.file).sort()).toEqual(["src/lib/x.js", "src/own.js"]);
    expect(result.skippedFiles).toEqual([]);
    expect(result.skippedFilesWarning).toBeNull();
  });

  it("an in-root file symlink to an already-scanned file is scanned once, not twice", async () => {
    const { repo } = makeWorld();
    symlinkSync(join(repo, "src/own.js"), join(repo, "src/alias.js"));

    const result = await scan(repo);

    expect(result.findings.filter((f) => f.description.includes("email"))).toHaveLength(1);
    expect(result.skippedFiles).toEqual([]);
  });

  it("a directory loop that stays inside the root terminates, scans each file once, and warns about nothing", async () => {
    const { repo } = makeWorld();
    symlinkSync("..", join(repo, "src/loop"));

    const started = Date.now();
    const result = await scan(repo);

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.findings.map((f) => f.location.file)).toEqual(["src/own.js"]);
    expect(result.skippedFiles).toEqual([]);
  });

  it("a loop alongside an out-of-root link reports that link once, not once per loop iteration", async () => {
    const { repo } = makeWorld();
    symlinkSync("..", join(repo, "src/loop"));
    symlinkSync(join(base, "outside/dir"), join(repo, "src/linkdir"));

    const result = await scan(repo);

    expect(result.skippedFiles).toEqual([{ file: "src/linkdir", reason: "symlink-outside-root" }]);
  });
});

describe("blocked symlinks are surfaced everywhere, by in-repo name only", () => {
  it("console warning, policy banner, --json list, and exit code; never the target", async () => {
    const { repo } = makeWorld();
    for (const name of ["a", "b", "c", "d", "e"]) symlinkSync(join(base, "outside/secret.js"), join(repo, `src/${name}.js`));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled in test"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runScan(repo, { json: true, out: "PRIVACY_POLICY.md", llm: false });

    const stderr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toContain("5 file(s) were skipped or only partially scanned (5 symlink(s) resolving outside the scanned root");
    expect(stderr).toContain("src/a.js, src/b.js, src/c.js, and 2 more (full list in --json output)");
    expect(stderr).not.toContain(join(base, "outside"));
    expect(stderr).not.toContain(join(realpathSync(base), "outside"));

    const policy = readFileSync(join(repo, "PRIVACY_POLICY.md"), "utf8");
    expect(policy).toContain("WARNING: FILES SKIPPED OR NOT ANALYZED");
    expect(policy).toContain("5 symlink(s) resolving outside the scanned root");
    expect(policy).not.toContain(join(base, "outside"));
    expect(policy).not.toContain(join(realpathSync(base), "outside"));
    expect(policy).not.toContain("secret.js");

    const json = JSON.parse(String(logSpy.mock.calls.find((c) => String(c[0]).trim().startsWith("{"))![0]));
    expect(json.skippedFiles).toHaveLength(5);
    expect(JSON.stringify(json)).not.toContain(join(base, "outside"));
    expect(JSON.stringify(json)).not.toContain(join(realpathSync(base), "outside"));
    expect(process.exitCode).toBe(1);
  });
});

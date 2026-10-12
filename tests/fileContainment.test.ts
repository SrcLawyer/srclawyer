import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan } from "../src/engine/scanEngine.js";
import { runScan } from "../src/commands/scan.js";
import { summarizeSkippedFiles } from "../src/engine/scanLimits.js";

let dir: string;
const originalExitCode = process.exitCode;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

function makeRepo(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "srclawyer-contain-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

const NORMAL = "const { email } = req.body;\n";

describe("per-file containment", () => {
  it("a 400KB a.b.b… file (parses, then overflows the stack in traversal) cannot abort the scan or cost the normal file its findings", async () => {
    const root = makeRepo({ "normal.js": NORMAL, "deep.js": "x = a" + ".b".repeat(200_000) + ";\n" });

    const result = await scan(root);

    expect(result.findings.map((f) => f.location.file)).toEqual(["normal.js"]);
    expect(result.skippedFiles).toEqual([{ file: "deep.js", reason: "analysis-failed" }]);
    expect(result.skippedFilesWarning).toContain("1 aborted during analysis");
    expect(result.skippedFilesWarning).toContain("deep.js");
  });

  it("an ordinary syntax-error file is recorded as parse-failed, not silently dropped, and its neighbours are unaffected", async () => {
    const root = makeRepo({ "normal.js": NORMAL, "broken.js": "const = ;\nfunction ( {{{\n" });

    const result = await scan(root);

    expect(result.findings.map((f) => f.location.file)).toEqual(["normal.js"]);
    expect(result.skippedFiles).toEqual([{ file: "broken.js", reason: "parse-failed" }]);
    expect(result.skippedFilesWarning).toContain("1 failed to parse");
  });

  it("a file whose syntax error comes after real findings still loses them, visibly", async () => {
    const root = makeRepo({ "half.js": NORMAL + "let x = ;\n" });

    const result = await scan(root);

    expect(result.skippedFiles).toEqual([{ file: "half.js", reason: "parse-failed" }]);
  });

  it("extremely deep nesting that fails at parse time is contained and recorded too", async () => {
    const root = makeRepo({ "normal.js": NORMAL, "parens.js": "x = " + "(".repeat(50_000) + "1" + ")".repeat(50_000) + ";\n" });

    const result = await scan(root);

    expect(result.findings.map((f) => f.location.file)).toEqual(["normal.js"]);
    expect(result.skippedFiles).toEqual([{ file: "parens.js", reason: "parse-failed" }]);
  });

  it("a malformed OpenAPI document is recorded instead of silently yielding nothing", async () => {
    const root = makeRepo({ "normal.js": NORMAL, "openapi.yaml": "openapi: 3.0.0\npaths: [unclosed\n  - : :\n" });

    const result = await scan(root);

    expect(result.findings.map((f) => f.location.file)).toEqual(["normal.js"]);
    expect(result.skippedFiles).toEqual([{ file: "openapi.yaml", reason: "parse-failed" }]);
  });

  it("an HTML file whose inline script can't be parsed keeps its input findings and is recorded", async () => {
    const root = makeRepo({ "page.html": '<input type="email" name="e">\n<script>\nvar a = {{ not_js }};\n</script>\n' });

    const result = await scan(root);

    expect(result.findings.some((f) => f.source === "html-input-rule")).toBe(true);
    expect(result.skippedFiles).toEqual([{ file: "page.html", reason: "parse-failed" }]);
  });

  it("a clean repo records nothing", async () => {
    const result = await scan(makeRepo({ "normal.js": NORMAL, "ok.html": '<input type="email">\n' }));

    expect(result.skippedFiles).toEqual([]);
    expect(result.skippedFilesWarning).toBeNull();
  });

  it("reaches the console, the policy file, --json and the exit code like every other skip", async () => {
    const root = makeRepo({ "normal.js": NORMAL, "broken.js": "const = ;\n", "deep.js": "x = a" + ".b".repeat(200_000) + ";\n" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled in test"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runScan(root, { json: true, out: "PRIVACY_POLICY.md", llm: false });

    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("1 failed to parse; 1 aborted during analysis");
    const policy = readFileSync(join(root, "PRIVACY_POLICY.md"), "utf8");
    expect(policy).toContain("WARNING: FILES SKIPPED OR NOT ANALYZED");
    expect(policy).toContain("broken.js");
    const json = JSON.parse(String(logSpy.mock.calls.find((c) => String(c[0]).trim().startsWith("{"))![0]));
    expect(json.skippedFiles).toEqual([
      { file: "broken.js", reason: "parse-failed" },
      { file: "deep.js", reason: "analysis-failed" },
    ]);
    expect(process.exitCode).toBe(1);
  });
});

describe("summarizeSkippedFiles breakdown", () => {
  it("counts each reason separately, in a fixed order, in one line", () => {
    const warning = summarizeSkippedFiles([
      { file: "a", reason: "oversized" },
      { file: "b", reason: "symlink-outside-root" },
      { file: "c", reason: "parse-failed" },
      { file: "d", reason: "parse-failed" },
      { file: "e", reason: "analysis-failed" },
    ])!;

    expect(warning).toContain("5 file(s) were skipped or only partially scanned");
    expect(warning).toContain("1 over the 2 MiB size cap; 1 symlink(s) resolving outside the scanned root, not followed; 2 failed to parse; 1 aborted during analysis");
    expect(warning.split("\n")).toHaveLength(1);
  });
});

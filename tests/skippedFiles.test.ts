import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan } from "../src/engine/scanEngine.js";
import { runScan } from "../src/commands/scan.js";
import { MAX_SCANNED_FILE_BYTES, summarizeSkippedFiles } from "../src/engine/scanLimits.js";

let dir: string;
const originalExitCode = process.exitCode;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

const OVER = MAX_SCANNED_FILE_BYTES + 1;
const padTo = (prefix: string, filler: string, size: number) => prefix + filler.repeat(Math.ceil((size - prefix.length) / filler.length));

function makeRepo(): string {
  dir = mkdtempSync(join(tmpdir(), "srclawyer-skipped-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/small.js"), "const { email } = req.body;\n");
  writeFileSync(join(dir, "src/huge.js"), padTo("// big\n", "const a = 1;\n", OVER));
  writeFileSync(join(dir, "src/huge.py"), padTo("# big\n", "x = 1\n", OVER));
  writeFileSync(join(dir, "src/huge.html"), padTo("<p>big</p>\n", "<p>filler</p>\n", OVER));
  writeFileSync(join(dir, "src/openapi.yaml"), padTo("openapi: 3.0.0\n", "# filler comment line\n", OVER));
  return dir;
}

describe("summarizeSkippedFiles", () => {
  it("is null when nothing was skipped", () => {
    expect(summarizeSkippedFiles([])).toBeNull();
  });

  it("names up to three files and counts the rest, pointing at --json for the full list", () => {
    const skipped = ["a", "b", "c", "d", "e"].map((file) => ({ file, reason: "oversized" as const }));
    const warning = summarizeSkippedFiles(skipped)!;
    expect(warning).toContain("5 file(s)");
    expect(warning).toContain("a, b, c, and 2 more (full list in --json output)");
    expect(warning).not.toContain(", d");
    expect(warning).toContain("scan is incomplete");
  });
});

describe("shared max-file-size cap", () => {
  it("skips an oversized file of EVERY scanned type, still scans the small one, and records each skip", async () => {
    const root = makeRepo();
    const result = await scan(root);

    expect(result.skippedFiles.map((s) => s.file).sort()).toEqual(["src/huge.html", "src/huge.js", "src/huge.py", "src/openapi.yaml"]);
    expect(result.skippedFiles.every((s) => s.reason === "oversized")).toBe(true);
    expect(result.findings.some((f) => f.location.file === "src/small.js")).toBe(true);
    // The skipped files are not counted as scanned.
    expect(result.filesScanned).toBeLessThan(5);
    expect(result.skippedFilesWarning).toContain("4 file(s) were skipped");
  });

  it("does not skip a file exactly at the cap", async () => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-skipped-"));
    writeFileSync(join(dir, "edge.js"), padTo("// edge\n", "//\n", MAX_SCANNED_FILE_BYTES).slice(0, MAX_SCANNED_FILE_BYTES));
    expect((await scan(dir)).skippedFiles).toEqual([]);
  });

  it("surfaces the skip on the console, in the policy file, in --json, and in the exit code", async () => {
    const root = makeRepo();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled in test"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runScan(root, { json: true, out: "PRIVACY_POLICY.md", llm: false });

    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("4 file(s) were skipped");
    const policy = readFileSync(join(root, "PRIVACY_POLICY.md"), "utf8");
    expect(policy).toContain("WARNING: FILES SKIPPED");
    expect(policy).toContain("scan is incomplete");
    expect(process.exitCode).toBe(1);

    const json = JSON.parse(String(logSpy.mock.calls.find((c) => String(c[0]).trim().startsWith("{"))![0]));
    expect(json.skippedFiles).toHaveLength(4);
    expect(json.skippedFiles[0]).toHaveProperty("reason", "oversized");
  });
});

describe("inline-script truncation is reported through the same warning", () => {
  it("records a partially scanned HTML file with its own reason", async () => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-skipped-"));
    // Few scripts are enough to exhaust the padding budget when each sits on a very late line.
    writeFileSync(join(dir, "many.html"), "\n".repeat(900_000) + Array.from({ length: 40 }, () => "<script>var a=1;</script>\n").join(""));
    const result = await scan(dir);

    expect(result.skippedFiles).toEqual([{ file: "many.html", reason: "inline-scripts-truncated" }]);
    expect(result.skippedFilesWarning).toContain("many.html");
  }, 60_000);
});

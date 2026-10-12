import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan } from "../src/engine/scanEngine.js";
import { runScan } from "../src/commands/scan.js";
import { formatText } from "../src/report/formatText.js";
import { containsTemplateSyntax } from "../src/engine/scanLimits.js";

let dir: string;
const originalExitCode = process.exitCode;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

function makeRepo(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "srclawyer-template-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

const JINJA_PAGE = '<input type="email" name="e">\n<script>\n  var user = {{ user|tojson }};\n</script>\n';

describe("inline scripts with template syntax", () => {
  it.each([["{{ x }}"], ["{% if x %}"], ["<% x %>"], ["{# note #}"]])("%s is classed template-syntax, not parse-failed", async (delimiter) => {
    const root = makeRepo({ "page.html": `<script>\nvar a = ${delimiter} ;\n</script>\n` });

    const result = await scan(root);

    expect(result.skippedFiles).toEqual([{ file: "page.html", reason: "template-syntax", scripts: 1 }]);
    expect(result.skippedFilesWarning).toBeNull();
    expect(result.templateSyntaxNote).toBe("1 inline scripts in template files were not analyzed (listed in --json output).");
  });

  it("counts scripts across files and keeps the HTML rules running on the rest of the file", async () => {
    const root = makeRepo({
      "a.html": JINJA_PAGE + "<script>\nvar b = {% raw %};\n</script>\n",
      "b.html": "<script>var c = <%= x %>;</script>\n",
    });

    const result = await scan(root);

    expect(result.skippedFiles).toEqual([
      { file: "a.html", reason: "template-syntax", scripts: 2 },
      { file: "b.html", reason: "template-syntax", scripts: 1 },
    ]);
    expect(result.templateSyntaxNote).toContain("3 inline scripts in template files were not analyzed");
    expect(result.findings.some((f) => f.source === "html-input-rule" && f.location.file === "a.html")).toBe(true);
  });

  it("a script that merely mentions delimiters but parses fine is analyzed normally, not skipped", async () => {
    const root = makeRepo({ "page.html": '<script>\nconst label = "{{ name }}";\nconst { email } = req.body;\n</script>\n' });

    const result = await scan(root);

    expect(result.skippedFiles).toEqual([]);
    expect(result.templateSyntaxNote).toBeNull();
    expect(result.findings.some((f) => f.description.includes("email"))).toBe(true);
  });

  it("a genuine syntax error in a script WITHOUT template syntax is still parse-failed", async () => {
    const root = makeRepo({ "page.html": "<script>\nvar a = ;\n</script>\n" });

    const result = await scan(root);

    expect(result.skippedFiles).toEqual([{ file: "page.html", reason: "parse-failed" }]);
    expect(result.skippedFilesWarning).toContain("1 failed to parse");
    expect(result.templateSyntaxNote).toBeNull();
  });

  it("a file with both kinds reports each under its own reason", async () => {
    const root = makeRepo({ "page.html": "<script>var a = {{ x }};</script>\n<script>var b = ;</script>\n" });

    const result = await scan(root);

    expect(result.skippedFiles).toEqual([
      { file: "page.html", reason: "parse-failed" },
      { file: "page.html", reason: "template-syntax", scripts: 1 },
    ]);
    expect(result.skippedFilesWarning).toContain("1 failed to parse");
    expect(result.skippedFilesWarning).not.toContain("template");
  });

  it("template syntax only excuses INLINE scripts: a .js file containing it is still a genuine parse failure", async () => {
    const root = makeRepo({ "view.js": "var a = {{ x }};\n" });

    const result = await scan(root);

    expect(result.skippedFiles).toEqual([{ file: "view.js", reason: "parse-failed" }]);
  });

  it("containsTemplateSyntax recognizes exactly the four delimiters", () => {
    for (const ok of ["{{", "{%", "<%", "{#"]) expect(containsTemplateSyntax(`x ${ok} y`)).toBe(true);
    for (const no of ["{ }", "{ { }", "% >", "<script>", "#{x}", "${x}"]) expect(containsTemplateSyntax(no)).toBe(false);
  });
});

describe("template-syntax is informational: no banner, no exit 1 on its own", () => {
  function silenceConsole() {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network must not be needed here"));
    return {
      err: vi.spyOn(console, "error").mockImplementation(() => {}),
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
    };
  }

  it("a Jinja script alone: one console line, a line in the text report, listed in --json, no policy banner, exit 0", async () => {
    const root = makeRepo({ "base.html": "<nav></nav>\n<script>\n  var user = {{ user|tojson }};\n</script>\n" });
    const { err, log } = silenceConsole();
    process.exitCode = undefined;

    await runScan(root, { json: false, out: "PRIVACY_POLICY.md", llm: false });

    const stderr = err.mock.calls.map((c) => String(c[0]));
    expect(stderr.filter((l) => l.includes("inline scripts in template files were not analyzed"))).toHaveLength(1);
    const stdout = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("Note: 1 inline scripts in template files were not analyzed");
    expect(stdout).not.toContain("WARNING");
    const policy = readFileSync(join(root, "PRIVACY_POLICY.md"), "utf8");
    expect(policy).not.toContain("FILES SKIPPED");
    expect(policy).not.toContain("template");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("--json lists the file with its reason and script count, and still exits 0", async () => {
    const root = makeRepo({ "base.html": JINJA_PAGE });
    const { log } = silenceConsole();
    process.exitCode = undefined;

    await runScan(root, { json: true, out: "PRIVACY_POLICY.md", llm: false });

    const json = JSON.parse(String(log.mock.calls.find((c) => String(c[0]).trim().startsWith("{"))![0]));
    expect(json.skippedFiles).toEqual([{ file: "base.html", reason: "template-syntax", scripts: 1 }]);
    expect(json.skippedFilesWarning).toBeNull();
    expect(json.templateSyntaxNote).toContain("1 inline scripts");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("the text report carries the note in formatText without a WARNING banner", async () => {
    const result = await scan(makeRepo({ "base.html": JINJA_PAGE }));
    const text = formatText(result);

    expect(text).toContain("Note: 1 inline scripts in template files were not analyzed");
    expect(text).not.toContain("WARNING");
  });

  it("a non-template syntax error still gives the banner and exit 1, even next to a template script", async () => {
    const root = makeRepo({ "base.html": JINJA_PAGE, "broken.js": "const = ;\n" });
    const { err } = silenceConsole();
    process.exitCode = undefined;

    await runScan(root, { json: false, out: "PRIVACY_POLICY.md", llm: false });

    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toContain("1 file(s) were skipped or only partially scanned (1 failed to parse)");
    expect(readFileSync(join(root, "PRIVACY_POLICY.md"), "utf8")).toContain("WARNING: FILES SKIPPED OR NOT ANALYZED");
    expect(process.exitCode).toBe(1);
  });

  it("a script-level syntax error with no template syntax gives the banner and exit 1", async () => {
    const root = makeRepo({ "page.html": "<script>var a = ;</script>\n" });
    silenceConsole();
    process.exitCode = undefined;

    await runScan(root, { json: false, out: "PRIVACY_POLICY.md", llm: false });

    expect(readFileSync(join(root, "PRIVACY_POLICY.md"), "utf8")).toContain("WARNING: FILES SKIPPED OR NOT ANALYZED");
    expect(process.exitCode).toBe(1);
  });
});

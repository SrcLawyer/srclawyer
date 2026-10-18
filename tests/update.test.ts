import { describe, expect, it, vi, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runScan } from "../src/commands/scan.js";
import { runUpdate, DRAFT_FILENAME, REVIEW_FILENAME } from "../src/commands/update.js";
import { DEFAULT_INVENTORY_PATH } from "../src/inventory/inventory.js";
import { classifyPolicyFile } from "../src/policy/policyGuard.js";
import { NO_DRIFT_STATEMENT } from "../src/assistant/wording.js";
import { initRepo, tempDir, workerStandIn, writeFiles } from "./support/gitFixture.js";

const dirs: string[] = [];
const fresh = () => {
  const d = tempDir();
  dirs.push(d);
  return d;
};
const originalExitCode = process.exitCode;

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

const BASE = { ".gitignore": "generated/\n", "src/app.js": 'const { email } = req.body;\n' };
// Only a processor import (no request-field reads) so nothing needs the Worker.
const SMS = { "src/sms-handler.js": 'import twilio from "twilio";\nconst { phone } = req.body;\n' };

function setup() {
  const worker = workerStandIn();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(worker.impl as typeof fetch);
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  return { worker, fetchSpy, clear: () => { log.mockClear(); err.mockClear(); }, stdout: () => log.mock.calls.map((c) => c.join(" ")).join("\n"), stderr: () => err.mock.calls.map((c) => String(c[0])).join("\n") };
}

async function baselineFor(root: string) {
  await runScan(root, { json: false, out: "BASELINE_POLICY.md", llm: false, writeInventory: DEFAULT_INVENTORY_PATH });
  process.exitCode = originalExitCode;
}

const update = (root: string, extra: Partial<Parameters<typeof runUpdate>[1]> = {}) =>
  runUpdate(root, { inventoryPath: DEFAULT_INVENTORY_PATH, outDir: ".", format: "text", ...extra });
const read = (root: string, name: string) => readFileSync(join(root, name), "utf8");

describe("srclawyer update (draft mode)", () => {
  it("with nothing new: exit 0, writes nothing, says 'no new items', not 'compliant'", async () => {
    const root = fresh();
    initRepo(root, BASE);
    const { stdout } = setup();
    await baselineFor(root);

    const code = await update(root);

    expect(code).toBe(0);
    expect(existsSync(join(root, DRAFT_FILENAME))).toBe(false);
    expect(existsSync(join(root, REVIEW_FILENAME))).toBe(false);
    expect(stdout()).toContain(NO_DRIFT_STATEMENT);
    expect(stdout()).toContain("Coverage: scanned");
  });

  it("on drift: exit 1, writes a marked draft and review file, and never touches the policy or the baseline", async () => {
    const root = fresh();
    initRepo(root, BASE);
    setup();
    await baselineFor(root);
    writeFileSync(join(root, "PRIVACY_POLICY.md"), "# My hand-written policy\n");
    const baselineBefore = read(root, DEFAULT_INVENTORY_PATH);
    writeFiles(root, SMS);

    const code = await update(root);

    expect(code).toBe(1);
    expect(read(root, "PRIVACY_POLICY.md")).toBe("# My hand-written policy\n");
    expect(read(root, DEFAULT_INVENTORY_PATH)).toBe(baselineBefore);
    expect(classifyPolicyFile(join(root, DRAFT_FILENAME))).toBe("unchanged");
    expect(classifyPolicyFile(join(root, REVIEW_FILENAME))).toBe("unchanged");
    expect(read(root, DRAFT_FILENAME)).toContain("Twilio");
  });

  it("the review file names categories, services, vendor wording and questions, with no paths, source or dates", async () => {
    const root = fresh();
    initRepo(root, BASE);
    setup();
    await baselineFor(root);
    writeFiles(root, SMS);

    await update(root);
    const review = read(root, REVIEW_FILENAME);

    expect(review).toContain("# Privacy policy review");
    expect(review).toContain("### New third-party services\n- Twilio");
    expect(review).toContain("### New kinds of personal data\n- Phone numbers");
    expect(review).toContain("- **Twilio** — SMS/voice communications provider. Processes phone numbers.");
    expect(review).toContain("- We collect phone numbers.");
    expect(review).toContain("Your code now appears to handle phone numbers or uses Twilio. Please check that your policy says how long that data is kept.");
    expect(review).toContain("Coverage: scanned");
    // Nothing from the repository leaks in.
    expect(review).not.toMatch(/sms-handler|\bsrc\/|app\.js|req\.body|import twilio/);
    expect(review).not.toMatch(/\b20\d\d\b/);
  });

  it("is idempotent: a second run overwrites its own unedited files cleanly", async () => {
    const root = fresh();
    initRepo(root, BASE);
    setup();
    await baselineFor(root);
    writeFiles(root, SMS);

    await update(root);
    const first = read(root, REVIEW_FILENAME);
    const code = await update(root);

    expect(code).toBe(1);
    expect(read(root, REVIEW_FILENAME)).toBe(first);
  });

  it("leaves an edited draft alone, says so, and still reports the drift (exit 1)", async () => {
    const root = fresh();
    initRepo(root, BASE);
    const { stdout } = setup();
    await baselineFor(root);
    writeFiles(root, SMS);
    await update(root);
    const edited = read(root, DRAFT_FILENAME) + "\nMy notes.\n";
    writeFileSync(join(root, DRAFT_FILENAME), edited);

    const code = await update(root);

    expect(code).toBe(1);
    expect(read(root, DRAFT_FILENAME)).toBe(edited);
    expect(stdout()).toContain(`Not updating ${DRAFT_FILENAME}: it has been edited since SrcLawyer generated it, or SrcLawyer didn't generate it.`);
  });

  it("writes into --out-dir", async () => {
    const root = fresh();
    initRepo(root, BASE);
    setup();
    await baselineFor(root);
    writeFiles(root, SMS);

    await update(root, { outDir: "out/review" });

    expect(existsSync(join(root, "out/review", DRAFT_FILENAME))).toBe(true);
    expect(existsSync(join(root, "out/review", REVIEW_FILENAME))).toBe(true);
    expect(existsSync(join(root, DRAFT_FILENAME))).toBe(false);
  });

  it("is inconclusive (exit 3) and writes nothing when the confidence service is down", async () => {
    const root = fresh();
    initRepo(root, BASE);
    setup();
    await baselineFor(root);
    writeFiles(root, SMS);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const code = await update(root);

    expect(code).toBe(3);
    expect(existsSync(join(root, DRAFT_FILENAME))).toBe(false);
    expect(existsSync(join(root, REVIEW_FILENAME))).toBe(false);
  });

  it("exits 2 with a clear message and writes nothing when there is no baseline", async () => {
    const root = fresh();
    initRepo(root, BASE);
    const { stderr } = setup();

    const code = await update(root);

    expect(code).toBe(2);
    expect(stderr()).toContain("no baseline found");
    expect(existsSync(join(root, DRAFT_FILENAME))).toBe(false);
  });

  it("only ever calls the confidence service (never an AI provider)", async () => {
    const root = fresh();
    initRepo(root, BASE);
    const { worker } = setup();
    await baselineFor(root);
    writeFiles(root, SMS);
    worker.calls.length = 0;

    await update(root);

    expect(worker.calls.length).toBeGreaterThan(0);
    expect(worker.calls.every((c) => /\/v1\/(score-fields|detect-zod-schema)$/.test(c.url))).toBe(true);
  });

  it("--format json carries the summary, questions, review hash and file outcomes", async () => {
    const root = fresh();
    initRepo(root, BASE);
    const { stdout, clear } = setup();
    await baselineFor(root);
    writeFiles(root, SMS);
    clear();

    await update(root, { format: "json" });
    const report = JSON.parse(stdout());

    expect(report.mode).toBe("draft");
    expect(report.result).toBe("drift");
    expect(report.exitCode).toBe(1);
    expect(report.diff.added.processors).toEqual(["Twilio"]);
    expect(report.summary).toContain("Your code now uses Twilio.");
    expect(report.summary).toContain("Nothing has been published or committed.");
    expect(report.reviewHash).toMatch(/^[0-9a-f]{8}$/);
    expect(report.draft).toMatchObject({ path: DRAFT_FILENAME, written: true, skippedReason: null });
    expect(report.review).toMatchObject({ path: REVIEW_FILENAME, written: true });
    expect(report.questions.map((q: { id: string }) => q.id)).toContain("dataRetentionPolicy");
    expect(report.coverage).toMatch(/^Coverage: scanned \d+ files/);
    expect(JSON.stringify(report)).not.toMatch(/sms-handler|src\//);
  });
});

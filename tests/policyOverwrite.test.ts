import { describe, expect, it, vi, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runScan } from "../src/commands/scan.js";
import { DEFAULT_INVENTORY_PATH } from "../src/inventory/inventory.js";
import { editedMessage, unmarkedMessage } from "../src/policy/policyGuard.js";
import { initRepo, tempDir, workerStandIn } from "./support/gitFixture.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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

// A request-field read, so an unguarded scan would call the confidence service.
const FILES = { "src/app.js": 'import Stripe from "stripe";\nconst { email } = req.body;\n' };

function setup() {
  const worker = workerStandIn();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(worker.impl as typeof fetch);
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  return { fetchSpy, stderr: () => err.mock.calls.map((c) => String(c[0])).join("\n"), stdout: () => log.mock.calls.map((c) => String(c[0])).join("\n") };
}

const scanWith = (root: string, extra: Record<string, unknown> = {}) =>
  runScan(root, { json: false, out: "PRIVACY_POLICY.md", llm: false, ...extra } as Parameters<typeof runScan>[1]);

const read = (root: string, name = "PRIVACY_POLICY.md") => readFileSync(join(root, name), "utf8");

describe("scan policy overwrite protection", () => {
  it("writes the marker on the first scan and regenerates an unedited policy without --force", async () => {
    const root = fresh();
    initRepo(root, FILES);
    setup();

    await scanWith(root);
    const first = read(root);
    expect(first).toMatch(/\n<!-- srclawyer:policy-sha256=[0-9a-f]{64} -->\n$/);

    writeFileSync(join(root, "src/more.js"), 'const { phone } = req.body;\n');
    await scanWith(root);
    expect(read(root)).not.toBe(first); // regenerated, not refused
    expect(process.exitCode ?? 0).not.toBe(2);
  });

  it("refuses an edited policy: exit 2, file byte-identical, edited message, no network call", async () => {
    const root = fresh();
    initRepo(root, FILES);
    const { fetchSpy, stderr } = setup();
    await scanWith(root);
    const edited = read(root).replace("# Privacy Policy", "# Privacy Policy (reviewed by counsel)");
    writeFileSync(join(root, "PRIVACY_POLICY.md"), edited);
    fetchSpy.mockClear();

    await scanWith(root);

    expect(process.exitCode).toBe(2);
    expect(read(root)).toBe(edited);
    expect(stderr()).toContain(editedMessage("PRIVACY_POLICY.md"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a file with no marker (hand-written or from 0.7.0) with the other message, and makes no network call", async () => {
    const root = fresh();
    initRepo(root, FILES);
    const { fetchSpy, stderr } = setup();
    writeFileSync(join(root, "PRIVACY_POLICY.md"), "# Our policy\n\nWritten by hand.\n");

    await scanWith(root);

    expect(process.exitCode).toBe(2);
    expect(read(root)).toBe("# Our policy\n\nWritten by hand.\n");
    expect(stderr()).toContain(unmarkedMessage("PRIVACY_POLICY.md"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a deleted marker protects the file", async () => {
    const root = fresh();
    initRepo(root, FILES);
    setup();
    await scanWith(root);
    const stripped = read(root).replace(/<!-- srclawyer:policy-sha256=[0-9a-f]{64} -->\n/, "");
    writeFileSync(join(root, "PRIVACY_POLICY.md"), stripped);

    await scanWith(root);

    expect(process.exitCode).toBe(2);
    expect(read(root)).toBe(stripped);
  });

  it("an edit that is exactly reverted no longer blocks the next scan", async () => {
    const root = fresh();
    initRepo(root, FILES);
    setup();
    await scanWith(root);
    const original = read(root);
    writeFileSync(join(root, "PRIVACY_POLICY.md"), original.replace("# Privacy Policy", "# Policy"));
    writeFileSync(join(root, "PRIVACY_POLICY.md"), original);

    await scanWith(root);

    expect(process.exitCode ?? 0).not.toBe(2);
  });

  it("a CRLF checkout of an unedited policy is regenerated, not refused", async () => {
    const root = fresh();
    initRepo(root, FILES);
    setup();
    await scanWith(root);
    writeFileSync(join(root, "PRIVACY_POLICY.md"), read(root).replace(/\n/g, "\r\n"));

    await scanWith(root);

    expect(process.exitCode ?? 0).not.toBe(2);
    expect(read(root)).not.toContain("\r\n");
  });

  it("--force overwrites an edited and an unmarked policy", async () => {
    const root = fresh();
    initRepo(root, FILES);
    setup();
    writeFileSync(join(root, "PRIVACY_POLICY.md"), "hand written\n");

    await scanWith(root, { force: true });

    expect(read(root)).toMatch(/srclawyer:policy-sha256=/);
    expect(process.exitCode ?? 0).not.toBe(2);

    writeFileSync(join(root, "PRIVACY_POLICY.md"), read(root) + "\nmy addition\n");
    await scanWith(root, { force: true });
    expect(read(root)).not.toContain("my addition");
  });

  it("guards whatever --out points at: an edited custom path is refused, a matching draft is overwritten", async () => {
    const root = fresh();
    initRepo(root, FILES);
    const { stderr } = setup();

    await scanWith(root, { out: "PRIVACY_POLICY.generated.md" });
    const draft = read(root, "PRIVACY_POLICY.generated.md");
    await scanWith(root, { out: "PRIVACY_POLICY.generated.md" }); // marker still matches
    expect(process.exitCode ?? 0).not.toBe(2);

    writeFileSync(join(root, "PRIVACY_POLICY.generated.md"), draft + "\nedited\n");
    await scanWith(root, { out: "PRIVACY_POLICY.generated.md" });
    expect(process.exitCode).toBe(2);
    expect(stderr()).toContain(editedMessage("PRIVACY_POLICY.generated.md"));
    expect(read(root, "PRIVACY_POLICY.generated.md")).toBe(draft + "\nedited\n");
  });

  it("guarding --out leaves the default policy alone", async () => {
    const root = fresh();
    initRepo(root, FILES);
    setup();
    writeFileSync(join(root, "PRIVACY_POLICY.md"), "hand written\n");

    await scanWith(root, { out: "PRIVACY_POLICY.generated.md" });

    expect(process.exitCode ?? 0).not.toBe(2);
    expect(read(root)).toBe("hand written\n");
    expect(existsSync(join(root, "PRIVACY_POLICY.generated.md"))).toBe(true);
  });
});

describe("scan --write-inventory with a protected policy", () => {
  it("writes the baseline, leaves the policy byte-identical, shows a note and exits 0", async () => {
    const root = fresh();
    initRepo(root, FILES);
    const { stderr, stdout } = setup();
    writeFileSync(join(root, "PRIVACY_POLICY.md"), "# Hand edited\n");

    await scanWith(root, { writeInventory: DEFAULT_INVENTORY_PATH });

    expect(read(root)).toBe("# Hand edited\n");
    expect(existsSync(join(root, DEFAULT_INVENTORY_PATH))).toBe(true);
    expect(process.exitCode ?? 0).toBe(0);
    expect(stderr()).toContain(`Privacy policy not written. ${unmarkedMessage("PRIVACY_POLICY.md")}`);
    expect(stdout()).toContain("Privacy policy not written (see above).");
    expect(stdout()).not.toContain("Privacy policy written to");
  });

  it("reports the skip in --json output", async () => {
    const root = fresh();
    initRepo(root, FILES);
    const { stdout } = setup();
    writeFileSync(join(root, "PRIVACY_POLICY.md"), "# Hand edited\n");

    await scanWith(root, { writeInventory: DEFAULT_INVENTORY_PATH, json: true });

    const report = JSON.parse(stdout());
    expect(report.policyWritten).toBe(false);
    expect(report.policySkippedReason).toContain("Not overwriting PRIVACY_POLICY.md");
  });

  it("reports policyWritten: true when it writes", async () => {
    const root = fresh();
    initRepo(root, FILES);
    const { stdout } = setup();

    await scanWith(root, { json: true });

    const report = JSON.parse(stdout());
    expect(report.policyWritten).toBe(true);
    expect(report.policySkippedReason).toBeNull();
  });
});

describe("the real CLI", () => {
  const cli = (cwd: string, args: string[]) => spawnSync("npx", ["tsx", join(ROOT, "src/cli.ts"), ...args], { cwd, encoding: "utf8", input: "" });
  const OFFLINE = { "src/pay.js": 'import Stripe from "stripe";\n' };

  it("exits 2 with the message on stderr for a protected policy, and 0 again with --force", () => {
    const root = fresh();
    initRepo(root, OFFLINE);
    writeFileSync(join(root, "PRIVACY_POLICY.md"), "hand written\n");

    const refused = cli(root, ["scan"]);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain(unmarkedMessage("PRIVACY_POLICY.md"));
    expect(read(root)).toBe("hand written\n");

    const forced = cli(root, ["scan", "--force"]);
    expect(forced.status).not.toBe(2);
    expect(read(root)).toMatch(/srclawyer:policy-sha256=/);
  });
});

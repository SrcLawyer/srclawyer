import { describe, expect, it, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initRepo, tempDir, writeFiles } from "./support/gitFixture.js";
import { NO_DRIFT_STATEMENT } from "../src/assistant/wording.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const cli = (cwd: string, args: string[]) => spawnSync("npx", ["tsx", join(ROOT, "src/cli.ts"), ...args], { cwd, encoding: "utf8", input: "" });

// Only a processor import (no request-field reads), so nothing needs the Worker and the test is offline.
const OFFLINE = { "src/pay.js": 'import Stripe from "stripe";\n' };

describe("the real CLI: update", () => {
  it("exits 2 without a baseline, 0 when nothing is new, 1 with a draft and review file when something is", () => {
    const root = tempDir();
    dirs.push(root);
    initRepo(root, OFFLINE);

    expect(cli(root, ["update"]).status).toBe(2);

    expect(cli(root, ["scan", "--write-inventory", "--out", "POLICY.md"]).status).toBe(0);
    // A baseline written by scan has no approval record, so the first update is a first review: exit 0,
    // everything found listed, no draft policy.
    const first = cli(root, ["update"]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("This is the first review of this project. Nothing has been approved yet.");
    expect(first.stdout).not.toContain(NO_DRIFT_STATEMENT);
    expect(existsSync(join(root, "PRIVACY_POLICY.generated.md"))).toBe(false);
    expect(existsSync(join(root, "PRIVACY_POLICY.review.md"))).toBe(true);

    writeFiles(root, { "src/sms.js": 'import twilio from "twilio";\n' });
    const drift = cli(root, ["update"]);
    expect(drift.status).toBe(1);
    expect(drift.stdout).toContain("Wrote the draft policy to PRIVACY_POLICY.generated.md.");
    expect(drift.stdout).toContain("Your policy and your approved review state were not changed.");
    expect(readFileSync(join(root, "PRIVACY_POLICY.review.md"), "utf8")).toContain("- Twilio");

    const json = cli(root, ["update", "--format", "json"]);
    expect(json.status).toBe(1);
    expect(JSON.parse(json.stdout).result).toBe("drift");
  }, 90_000);

  it("rejects an unknown --format as a usage error (exit 2)", () => {
    const root = tempDir();
    dirs.push(root);
    initRepo(root, OFFLINE);
    expect(cli(root, ["update", "--format", "xml"]).status).toBe(2);
  }, 30_000);
});

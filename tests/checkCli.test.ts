import { describe, expect, it, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initRepo, tempDir, writeFiles } from "./support/gitFixture.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function cli(cwd: string, args: string[]) {
  return spawnSync("npx", ["tsx", join(ROOT, "src/cli.ts"), ...args], { cwd, encoding: "utf8", input: "" });
}

// Only a processor import (no request-field reads), so nothing needs the Worker and the test is offline.
const OFFLINE = { "src/pay.js": 'import Stripe from "stripe";\n' };

describe("the real CLI: scan --write-inventory, then check", () => {
  it("exits 0, then 1 on drift, then 2 without a baseline, with a usage error as 2", () => {
    const root = tempDir();
    dirs.push(root);
    initRepo(root, OFFLINE);

    expect(cli(root, ["check"]).status).toBe(2);

    const written = cli(root, ["scan", "--write-inventory", "--out", "POLICY.md"]);
    expect(written.status).toBe(0);
    expect(written.stderr).toContain("Wrote the drift baseline");

    const clean = cli(root, ["check"]);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain("no drift");

    writeFiles(root, { "src/sms.js": 'import twilio from "twilio";\n' });
    const drifted = cli(root, ["check"]);
    expect(drifted.status).toBe(1);
    expect(drifted.stdout).toContain("Added processors:   Twilio");

    const json = cli(root, ["check", "--format", "json"]);
    expect(json.status).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({ result: "drift", exitCode: 1, diff: { added: { processors: ["Twilio"] } } });

    expect(cli(root, ["check", "--format", "xml"]).status).toBe(2);
  }, 90_000);
});

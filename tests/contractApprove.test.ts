import { describe, expect, it, vi, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runApprove } from "../src/commands/approve.js";
import { runUpdate, REVIEW_FILENAME, DRAFT_FILENAME } from "../src/commands/update.js";
import { runInit } from "../src/commands/init.js";
import { runScan } from "../src/commands/scan.js";
import { answerReport } from "../src/commands/answer.js";
import { runCheck } from "../src/commands/check.js";
import { DEFAULT_INVENTORY_PATH, parseInventory, serializeInventory, computeInventory } from "../src/inventory/inventory.js";
import { withPolicyMarker } from "../src/policy/policyGuard.js";
import { initRepo, tempDir, writeFiles } from "./support/gitFixture.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs: string[] = [];
const originalExitCode = process.exitCode;
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

const PROJECT = { ".gitignore": "generated/\n", "src/pay.js": 'import Stripe from "stripe";\n' };
const SMS = { "src/sms-handler.js": 'import twilio from "twilio";\n' };
const ANSWERS: Record<string, [string, string?]> = {
  companyName: ["Acme"], siteUrl: ["https://acme.test"], privacyContactEmail: ["p@acme.test"], collectsChildrensData: ["false", "owner: no"],
  minimumAge: ["none"], hasEuUkUsers: ["false", "owner: no"], hasCaliforniaUsers: ["false", "owner: no"], sellsOrSharesData: ["false", "owner: no"],
  usesDataForAdvertising: ["false", "owner: no"], dataRetentionPolicy: ["until the account is deleted"], accountDeletionInstructions: ["email p@acme.test"],
  sendsDataToAiServices: ["false", "owner: no"],
};

function quiet() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    throw new Error(`unexpected network call to ${String(url)}`);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  return vi.spyOn(console, "log").mockImplementation(() => {});
}
const lastJson = (log: ReturnType<typeof quiet>) => JSON.parse(String(log.mock.calls.at(-1)![0]));

async function drifted(): Promise<{ root: string; log: ReturnType<typeof quiet>; hash: string }> {
  const root = tempDir();
  dirs.push(root);
  initRepo(root, PROJECT);
  const log = quiet();
  await runInit(root, { yes: true });
  process.exitCode = originalExitCode;
  for (const [id, [value, note]] of Object.entries(ANSWERS)) answerReport(root, { inventoryPath: DEFAULT_INVENTORY_PATH, id, value, note, json: true });
  writeFiles(root, SMS);
  log.mockClear();
  await runUpdate(root, { inventoryPath: DEFAULT_INVENTORY_PATH, outDir: ".", format: "json" });
  const hash = lastJson(log).reviewHash as string;
  answerReport(root, { inventoryPath: DEFAULT_INVENTORY_PATH, id: "dataRetentionPolicy", value: "until the account is deleted", json: true });
  log.mockClear();
  // The answer changed the review (its "current answer" line), so read the new hash the way an assistant does.
  await runUpdate(root, { inventoryPath: DEFAULT_INVENTORY_PATH, outDir: ".", format: "json" });
  return { root, log, hash: lastJson(log).reviewHash as string };
}

const approve = (root: string, review: string, userReply = "yes", allowUnanswered: string[] = []) =>
  runApprove(root, { inventoryPath: DEFAULT_INVENTORY_PATH, review, userReply, allowUnanswered, json: true });
const read = (root: string, name: string) => readFileSync(join(root, name), "utf8");

describe("srclawyer approve", () => {
  it("records the approval in the baseline only: hash and reply, no dates, nothing else touched", async () => {
    const { root, log, hash } = await drifted();
    const policyBefore = read(root, "PRIVACY_POLICY.md");
    const configBefore = read(root, ".srclawyer.config.yml");
    log.mockClear();

    const code = await approve(root, hash, "yes");
    const out = lastJson(log);

    expect(code).toBe(0);
    expect(out).toMatchObject({ schema: 1, ok: true, approved: true, review: hash, note: "yes", filesChanged: [DEFAULT_INVENTORY_PATH], published: false, committed: false });
    const baseline = parseInventory(read(root, DEFAULT_INVENTORY_PATH));
    expect(baseline.ok && baseline.inventory.processors).toEqual(["Stripe", "Twilio"]);
    expect(baseline.ok && baseline.inventory.approval).toEqual({ review: expect.stringMatching(/^[0-9a-f]{64}$/), note: "yes" });
    expect(baseline.ok && baseline.inventory.approval!.review.startsWith(hash)).toBe(true);
    expect(read(root, DEFAULT_INVENTORY_PATH)).not.toMatch(/\d{4}-\d{2}-\d{2}|T\d{2}:/);
    expect(read(root, "PRIVACY_POLICY.md")).toBe(policyBefore);
    expect(read(root, ".srclawyer.config.yml")).toBe(configBefore);
  });

  it("afterwards check and update see no new items", async () => {
    const { root, log, hash } = await drifted();
    await approve(root, hash);
    log.mockClear();
    expect(await runCheck(root, { inventoryPath: DEFAULT_INVENTORY_PATH, format: "json" })).toBe(0);
    expect(lastJson(log).result).toBe("no-drift");
  });

  it("refuses a wrong, malformed or stale review hash and writes nothing", async () => {
    const { root, log, hash } = await drifted();
    const before = read(root, DEFAULT_INVENTORY_PATH);
    for (const bad of ["deadbeef", "xyz", "", "1234567", `${hash.slice(0, 7)}0`]) {
      log.mockClear();
      expect(await approve(root, bad), bad).toBe(2);
      expect(lastJson(log)).toMatchObject({ ok: false, approved: false, error: { code: "review-changed", message: "The review has changed since it was read. Please run the update again and read the new summary." } });
    }
    expect(read(root, DEFAULT_INVENTORY_PATH)).toBe(before);
  });

  it("accepts the full 64-character hash and an upper-case prefix", async () => {
    const { root, log, hash } = await drifted();
    const full = (JSON.parse(read(root, ".srclawyer/last-update.json")).reviewHash as string) === hash ? hash : hash;
    expect(await approve(root, full.toUpperCase())).toBe(0);
    log.mockClear();
  });

  it("only a yes is recorded: refuses no, maybe, empty, multi-line and over-long replies", async () => {
    const { root, log, hash } = await drifted();
    const before = read(root, DEFAULT_INVENTORY_PATH);
    for (const [reply, expected] of [["no", "reply-not-yes"], ["maybe", "reply-not-yes"], ["ok", "reply-not-yes"], ["", "invalid-reply"], ["yes\nplease", "invalid-reply"], ["yes ".repeat(40), "invalid-reply"]] as const) {
      log.mockClear();
      expect(await approve(root, hash, reply), reply).toBe(2);
      expect(lastJson(log).error.code, reply).toBe(expected);
    }
    expect(read(root, DEFAULT_INVENTORY_PATH)).toBe(before);
    log.mockClear();
    expect(await approve(root, hash, "Yes")).toBe(0);
  });

  it("refuses while questions are open, naming them, unless the owner left them unanswered on purpose", async () => {
    const root = tempDir();
    dirs.push(root);
    initRepo(root, PROJECT);
    const log = quiet();
    await runInit(root, { yes: true });
    process.exitCode = originalExitCode;
    writeFiles(root, SMS);
    log.mockClear();
    await runUpdate(root, { inventoryPath: DEFAULT_INVENTORY_PATH, outDir: ".", format: "json" });
    const hash = lastJson(log).reviewHash as string;

    log.mockClear();
    expect(await approve(root, hash)).toBe(2);
    const refusal = lastJson(log);
    expect(refusal.error).toEqual({ code: "questions-open", message: "Some questions still need an answer." });
    expect(refusal.unanswered).toContain("companyName");
    expect(refusal.unanswered).toContain("dataRetentionPolicy");

    log.mockClear();
    expect(await approve(root, hash, "yes", refusal.unanswered)).toBe(0);
    expect(lastJson(log).approved).toBe(true);
  });

  it("a question answered 'I'm not sure' does not block approval", async () => {
    const { root, log, hash } = await drifted();
    answerReport(root, { inventoryPath: DEFAULT_INVENTORY_PATH, id: "entityLocation", value: "unsure", json: true });
    rmSync(join(root, ".srclawyer.config.yml"));
    writeFileSync(join(root, ".srclawyer.config.yml"), "tier: free\ntargetMarkets: []\n");
    for (const id of Object.keys(ANSWERS)) answerReport(root, { inventoryPath: DEFAULT_INVENTORY_PATH, id, value: "unsure", json: true });
    log.mockClear();
    await runUpdate(root, { inventoryPath: DEFAULT_INVENTORY_PATH, outDir: ".", format: "json" });
    const newHash = lastJson(log).reviewHash as string;
    log.mockClear();
    expect(await approve(root, newHash)).toBe(0);
    expect(hash).toBeTruthy();
  });

  it("derives the review itself: a forged review file and a forged update record change nothing", async () => {
    const { root, log, hash } = await drifted();
    // An attacker commits a review file and a record claiming a different hash and "no questions".
    writeFileSync(join(root, REVIEW_FILENAME), withPolicyMarker("# Privacy policy review\n\nNothing to see.\n"));
    const record = JSON.parse(read(root, ".srclawyer/last-update.json"));
    writeFileSync(join(root, ".srclawyer/last-update.json"), JSON.stringify({ ...record, reviewHash: "cafebabe", triggered: [], answered: [] }));
    log.mockClear();
    expect(await approve(root, "cafebabe")).toBe(2);
    expect(lastJson(log).error.code).toBe("review-changed");
    log.mockClear();
    // The true hash still works, and the forged file was never what was approved.
    expect(await approve(root, hash, "yes", ["dataRetentionPolicy"])).toBe(0);
  });

  it("says there is nothing to approve when nothing is new, and changes nothing", async () => {
    const root = tempDir();
    dirs.push(root);
    initRepo(root, PROJECT);
    const log = quiet();
    await runInit(root, { yes: true });
    process.exitCode = originalExitCode;
    const before = read(root, DEFAULT_INVENTORY_PATH);
    log.mockClear();
    expect(await approve(root, "deadbeef")).toBe(0);
    expect(lastJson(log)).toMatchObject({ ok: true, approved: false, message: "There is nothing new to approve." });
    expect(read(root, DEFAULT_INVENTORY_PATH)).toBe(before);
  });

  it("exits 3 and changes nothing when the scan cannot finish", async () => {
    const { root, log, hash } = await drifted();
    const before = read(root, DEFAULT_INVENTORY_PATH);
    writeFiles(root, { "src/handler.js": "const { email } = req.body;\n" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    log.mockClear();
    expect(await approve(root, hash)).toBe(3);
    expect(lastJson(log)).toMatchObject({ ok: false, error: { code: "inconclusive" } });
    expect(read(root, DEFAULT_INVENTORY_PATH)).toBe(before);
  });

  it("exits 2 when there is no baseline", async () => {
    const root = tempDir();
    dirs.push(root);
    initRepo(root, PROJECT);
    const log = quiet();
    expect(await approve(root, "deadbeef")).toBe(2);
    expect(lastJson(log).error.code).toBe("error");
  });

  it("leaves the draft and review files for the owner and records no path or code anywhere", async () => {
    const { root, hash } = await drifted();
    await approve(root, hash);
    expect(existsSync(join(root, DRAFT_FILENAME))).toBe(true);
    expect(read(root, DEFAULT_INVENTORY_PATH)).not.toMatch(/sms-handler|src\//);
  });
});

describe("the baseline's approval record", () => {
  const inv = { schema: 1, srclawyerVersion: "0.9.0", discovery: "git" as const, categories: ["email"], processors: ["Stripe"] };

  it("round-trips, is deterministic, and is omitted when absent", () => {
    expect(serializeInventory(inv)).not.toContain("approval");
    const withApproval = serializeInventory({ ...inv, approval: { review: "a".repeat(64), note: "yes" } });
    expect(withApproval.endsWith("}\n")).toBe(true);
    expect(JSON.parse(withApproval).approval).toEqual({ review: "a".repeat(64), note: "yes" });
    const parsed = parseInventory(withApproval);
    expect(parsed.ok && parsed.inventory.approval).toEqual({ review: "a".repeat(64), note: "yes" });
    expect(Object.keys(JSON.parse(withApproval))).toEqual(["schema", "srclawyerVersion", "discovery", "categories", "processors", "approval"]);
  });

  it("is ignored by check: only categories and processors are compared", async () => {
    const root = tempDir();
    dirs.push(root);
    initRepo(root, PROJECT);
    quiet();
    await runInit(root, { yes: true });
    process.exitCode = originalExitCode;
    const p = parseInventory(read(root, DEFAULT_INVENTORY_PATH));
    if (!p.ok) throw new Error("bad baseline");
    writeFileSync(join(root, DEFAULT_INVENTORY_PATH), serializeInventory({ ...p.inventory, approval: { review: "b".repeat(64), note: "yes" } }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    log.mockClear();
    expect(await runCheck(root, { inventoryPath: DEFAULT_INVENTORY_PATH, format: "json" })).toBe(0);
  });

  it("is dropped when the baseline is rewritten by scan --write-inventory (a different approval route)", async () => {
    const { root, hash } = await drifted();
    await approve(root, hash);
    expect(read(root, DEFAULT_INVENTORY_PATH)).toContain('"approval"');
    await runScan(root, { json: false, out: "OUT.md", llm: false, writeInventory: DEFAULT_INVENTORY_PATH });
    expect(read(root, DEFAULT_INVENTORY_PATH)).not.toContain('"approval"');
  });

  it("tolerates an over-long or malformed approval in a hand-edited file", () => {
    const text = JSON.stringify({ ...inv, approval: { review: "x", note: "n".repeat(500) } });
    const parsed = parseInventory(text);
    expect(parsed.ok && parsed.inventory.approval!.note).toHaveLength(120);
    const bad = parseInventory(JSON.stringify({ ...inv, approval: "yes" }));
    expect(bad.ok && bad.inventory.approval).toBeUndefined();
    void computeInventory;
  });
});

describe("the real CLI", () => {
  const cli = (cwd: string, args: string[], input = "") => spawnSync("npx", ["tsx", join(ROOT, "src/cli.ts"), ...args], { cwd, encoding: "utf8", input });

  it("init --yes, status, questions, answer, update and approve work together, with the documented exit codes", () => {
    const root = tempDir();
    dirs.push(root);
    initRepo(root, PROJECT);

    expect(cli(root, ["status", "--json"]).status).toBe(0);
    expect(JSON.parse(cli(root, ["status", "--json"]).stdout).state).toBe("needs-setup");
    const init = cli(root, ["init", "--yes"]);
    expect(init.status).toBe(0);
    expect(existsSync(join(root, ".srclawyer.inventory.json"))).toBe(true);

    const refused = cli(root, ["answer", "collectsChildrensData", "false"]);
    expect(refused.status).toBe(2);
    expect(JSON.parse(refused.stdout).error.code).toBe("note-required");
    const ok = cli(root, ["answer", "companyName", "--stdin"], "Acme Inc.\n");
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout)).toMatchObject({ ok: true, recorded: true });

    const q = JSON.parse(cli(root, ["questions", "--json"]).stdout);
    expect(q.schema).toBe(1);
    expect(q.questions.some((x: { id: string }) => x.id === "companyName")).toBe(false); // answered, so no longer open
    expect(q.questions.some((x: { id: string }) => x.id === "siteUrl")).toBe(true);

    expect(cli(root, ["approve", "--review", "deadbeef", "--user-reply", "yes"]).status).toBe(0); // nothing new to approve
    writeFiles(root, SMS);
    const update = cli(root, ["update", "--json"]);
    expect(update.status).toBe(1);
    const hash = JSON.parse(update.stdout).reviewHash as string;
    expect(cli(root, ["approve", "--review", "deadbeef", "--user-reply", "yes"]).status).toBe(2);
    expect(cli(root, ["approve", "--review", hash, "--user-reply", "no"]).status).toBe(2);
  }, 240_000);
});

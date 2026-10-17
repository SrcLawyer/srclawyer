import { describe, expect, it, vi, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCheck, type CheckReport } from "../src/commands/check.js";
import { runScan } from "../src/commands/scan.js";
import { DEFAULT_INVENTORY_PATH } from "../src/inventory/inventory.js";
import { cloneRepo, git, initRepo, tempDir, workerStandIn, writeFiles } from "./support/gitFixture.js";

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

const BASE = {
  ".gitignore": "generated/\n",
  "src/app.js": 'import Stripe from "stripe";\nconst { email } = req.body;\n',
};
const ZOD_ONLY = {
  "src/actions.ts": 'import { z } from "zod";\nconst schema = z.object({ ssn: z.string() });\nexport function POST(req) {\n  return schema.parse(req.body);\n}\n',
};

function useWorker(options?: Parameters<typeof workerStandIn>[0]) {
  const worker = workerStandIn(options);
  vi.spyOn(globalThis, "fetch").mockImplementation(worker.impl as typeof fetch);
  return worker;
}

function quiet() {
  vi.spyOn(console, "error").mockImplementation(() => {});
  return vi.spyOn(console, "log").mockImplementation(() => {});
}

async function writeBaseline(root: string, extra: { allowIncomplete?: boolean } = {}) {
  await runScan(root, { json: false, out: "PRIVACY_POLICY.md", llm: false, writeInventory: DEFAULT_INVENTORY_PATH, allowIncompleteInventory: extra.allowIncomplete });
  process.exitCode = originalExitCode;
}

async function check(root: string): Promise<{ code: number; report: CheckReport; text: string }> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const code = await runCheck(root, { inventoryPath: DEFAULT_INVENTORY_PATH, format: "json" });
  const report = JSON.parse(String(log.mock.calls.at(-1)![0])) as CheckReport;
  log.mockClear();
  const textCode = await runCheck(root, { inventoryPath: DEFAULT_INVENTORY_PATH, format: "text" });
  expect(textCode).toBe(code);
  return { code, report, text: log.mock.calls.map((c) => String(c[0])).join("\n") };
}

describe("check: conclusive results", () => {
  it("exits 0 with no drift when nothing changed, and never writes a policy or calls any other host", async () => {
    const root = fresh();
    initRepo(root, BASE);
    quiet();
    const worker = useWorker();
    await writeBaseline(root);
    rmSync(join(root, "PRIVACY_POLICY.md"));
    worker.calls.length = 0;

    const { code, report } = await check(root);

    expect(code).toBe(0);
    expect(report.result).toBe("no-drift");
    expect(report.diff).toEqual({ added: { categories: [], processors: [] }, removed: { categories: [], processors: [] } });
    expect(existsSync(join(root, "PRIVACY_POLICY.md"))).toBe(false);
    expect(worker.calls.every((c) => c.url.includes("/v1/"))).toBe(true);
  });

  it("exits 1 and names exactly what was added when a new processor and category appear", async () => {
    const root = fresh();
    initRepo(root, BASE);
    quiet();
    useWorker();
    await writeBaseline(root);
    writeFiles(root, { "src/sms.js": 'import twilio from "twilio";\nconst { phone } = req.body;\n' });

    const { code, report, text } = await check(root);

    expect(code).toBe(1);
    expect(report.result).toBe("drift");
    expect(report.diff!.added).toEqual({ categories: ["phone"], processors: ["Twilio"] });
    expect(report.diff!.removed).toEqual({ categories: [], processors: [] });
    expect(text).toContain("DRIFT DETECTED");
    expect(text).toContain("Added processors:   Twilio");
    expect(text).toContain('"srclawyer scan --write-inventory"');
  });

  it("exits 1 when a processor is removed", async () => {
    const root = fresh();
    initRepo(root, BASE);
    quiet();
    useWorker();
    await writeBaseline(root);
    writeFiles(root, { "src/app.js": "const { email } = req.body;\n" });

    const { code, report } = await check(root);

    expect(code).toBe(1);
    expect(report.diff!.removed.processors).toEqual(["Stripe"]);
  });

  it("a finding moving between confident and needs-review is not drift", async () => {
    const root = fresh();
    initRepo(root, BASE);
    quiet();
    useWorker({ reviewRequired: false });
    await writeBaseline(root);
    vi.restoreAllMocks();
    quiet();
    useWorker({ reviewRequired: true });

    const { code, report } = await check(root);

    expect(code).toBe(0);
    expect(report.result).toBe("no-drift");
  });

  it("an informational template-syntax skip is not inconclusive", async () => {
    const root = fresh();
    initRepo(root, { ...BASE, "views/base.html": "<nav></nav>\n<script>\n var u = {{ user|tojson }};\n</script>\n" });
    quiet();
    useWorker();
    await writeBaseline(root);

    const { code, report } = await check(root);

    expect(code).toBe(0);
    expect(report.inconclusiveReasons).toEqual([]);
  });

  it("does not call Anthropic even when AI review is configured and a key is set", async () => {
    const root = fresh();
    initRepo(root, { ...BASE, ".srclawyer.config.yml": "entityLocation: US\ntargetMarkets: []\nindustry: null\ncollectsChildrensData: false\ntier: byok\nllm:\n  provider: anthropic\n  apiKeyEnvVar: SRCLAWYER_TEST_CHECK_KEY\n" });
    process.env.SRCLAWYER_TEST_CHECK_KEY = "sk-ant-fake";
    quiet();
    const worker = useWorker({ reviewRequired: true });
    try {
      await writeBaseline(root);
      worker.calls.length = 0;
      await check(root);
    } finally {
      delete process.env.SRCLAWYER_TEST_CHECK_KEY;
    }

    expect(worker.calls.length).toBeGreaterThan(0);
    expect(worker.calls.some((c) => c.url.includes("anthropic"))).toBe(false);
  });
});

describe("check: inconclusive results are never reported as drift", () => {
  it("Worker unreachable: exit 3, no diff, even though a Zod-derived category vanished", async () => {
    const root = fresh();
    initRepo(root, { ...BASE, ...ZOD_ONLY });
    quiet();
    useWorker({ zodFields: ["ssn"] });
    await writeBaseline(root);
    expect(readFileSync(join(root, DEFAULT_INVENTORY_PATH), "utf8")).toContain("government_id");
    vi.restoreAllMocks();
    quiet();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connect ECONNREFUSED"));

    const { code, report, text } = await check(root);

    expect(code).toBe(3);
    expect(report.result).toBe("inconclusive");
    expect(report.diff).toBeNull();
    expect(report.inconclusiveReasons.join(" ")).toMatch(/Zod-schema detection unavailable/);
    expect(text).toContain("INCONCLUSIVE");
    expect(text).not.toContain("DRIFT DETECTED");
  });

  it("an unsupported stack is inconclusive", async () => {
    const root = fresh();
    initRepo(root, { ...BASE, "manage.py": "# django\n" });
    quiet();
    useWorker();
    await writeBaseline(root, { allowIncomplete: true });

    const { code, report } = await check(root);

    expect(code).toBe(3);
    expect(report.inconclusiveReasons.join(" ")).toMatch(/Django/);
  });

  it("a skipped file (over the size cap) is inconclusive", async () => {
    const root = fresh();
    initRepo(root, { ...BASE, "src/big.js": "// " + "x".repeat(2 * 1024 * 1024 + 10) + "\n" });
    quiet();
    useWorker();
    await writeBaseline(root, { allowIncomplete: true });

    const { code, report } = await check(root);

    expect(code).toBe(3);
    expect(report.inconclusiveReasons.join(" ")).toMatch(/skipped or only partially scanned/);
  });

  it("a discovery-mode mismatch (baseline from git, run without git) is inconclusive, with the reason", async () => {
    const root = fresh();
    initRepo(root, BASE);
    quiet();
    useWorker();
    await writeBaseline(root);
    rmSync(join(root, ".git"), { recursive: true, force: true });

    const { code, report } = await check(root);

    expect(code).toBe(3);
    expect(report.diff).toBeNull();
    expect(report.currentDiscovery).toBe("glob");
    expect(report.inconclusiveReasons.join(" ")).toMatch(/baseline was written with git discovery, but this run used glob discovery \(not a git repository\)/);
  });

  it("the mismatch in the other direction (baseline from a plain folder, run inside git) is inconclusive too", async () => {
    const root = fresh();
    writeFiles(root, BASE);
    quiet();
    useWorker();
    await writeBaseline(root);
    git(root, "init", "-q", "-b", "main");

    const { code, report } = await check(root);

    expect(code).toBe(3);
    expect(report.inconclusiveReasons.join(" ")).toMatch(/written with glob discovery, but this run used git discovery/);
  });
});

describe("check: an ignored build directory that exists locally but not in CI", () => {
  it("gives the same answer locally and on a clean clone -- no phantom drift", async () => {
    const origin = fresh();
    initRepo(origin, BASE);
    quiet();
    useWorker();

    // Local checkout: has a gitignored build directory full of generated code.
    const local = fresh();
    cloneRepo(origin, local);
    writeFiles(local, { "generated/bundle.js": "const { ssn } = req.body;\n", "generated/api/deep.js": "const { passport } = req.body;\n" });
    await writeBaseline(local);
    const baseline = readFileSync(join(local, DEFAULT_INVENTORY_PATH), "utf8");
    expect(baseline).not.toContain("government_id");
    expect(JSON.parse(baseline).discovery).toBe("git");
    expect(await check(local)).toMatchObject({ code: 0 });

    // CI: a clean clone of the same commit, plus the committed baseline -- no generated/ directory at all.
    writeFileSync(join(origin, DEFAULT_INVENTORY_PATH), baseline);
    git(origin, "add", "-A");
    git(origin, "commit", "-q", "-m", "baseline");
    const ci = fresh();
    cloneRepo(origin, ci);
    expect(existsSync(join(ci, "generated"))).toBe(false);

    const { code, report } = await check(ci);
    expect(code).toBe(0);
    expect(report.result).toBe("no-drift");
  });

  it("the ordinary walk WOULD have produced drift here -- which is why check and --write-inventory don't use it", async () => {
    const origin = fresh();
    initRepo(origin, BASE);
    const local = fresh();
    cloneRepo(origin, local);
    writeFiles(local, { "generated/bundle.js": "const { ssn } = req.body;\n" });
    const { scan } = await import("../src/engine/scanEngine.js");

    const walked = await scan(local);

    expect(walked.findings.some((f) => f.dataCategories.includes("government_id"))).toBe(true);
  });
});

describe("check: bad input exits 2", () => {
  async function checkRaw(root: string) {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runCheck(root, { inventoryPath: DEFAULT_INVENTORY_PATH, format: "text" });
    return { code, message: err.mock.calls.map((c) => String(c[0])).join("\n") };
  }

  it("a missing baseline says how to create one", async () => {
    const root = fresh();
    initRepo(root, BASE);

    const { code, message } = await checkRaw(root);

    expect(code).toBe(2);
    expect(message).toContain('no baseline found at .srclawyer.inventory.json. Create one with "srclawyer scan --write-inventory"');
  });

  it("an invalid or future-schema baseline says why", async () => {
    const root = fresh();
    initRepo(root, BASE);
    writeFileSync(join(root, DEFAULT_INVENTORY_PATH), JSON.stringify({ schema: 2, discovery: "git", categories: [], processors: [] }));

    const { code, message } = await checkRaw(root);

    expect(code).toBe(2);
    expect(message).toContain("invalid: unsupported schema 2");
  });
});

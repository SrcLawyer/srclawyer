import { describe, expect, it, vi, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runScan } from "../src/commands/scan.js";
import { DEFAULT_INVENTORY_PATH } from "../src/inventory/inventory.js";
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

const BASE = { ".gitignore": "generated/\n", "src/app.js": 'import Stripe from "stripe";\nconst { email } = req.body;\n' };

function setup() {
  const worker = workerStandIn();
  vi.spyOn(globalThis, "fetch").mockImplementation(worker.impl as typeof fetch);
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  return { err, log, stderr: () => err.mock.calls.map((c) => String(c[0])).join("\n") };
}

const scanWith = (root: string, extra: Record<string, unknown> = {}) =>
  runScan(root, { json: false, out: "PRIVACY_POLICY.md", llm: false, ...extra } as Parameters<typeof runScan>[1]);

describe("scan --write-inventory", () => {
  it("writes only categories and processors, sorted, with the discovery mode and version", async () => {
    const root = fresh();
    initRepo(root, BASE);
    const { stderr } = setup();

    await scanWith(root, { writeInventory: DEFAULT_INVENTORY_PATH });

    const written = JSON.parse(readFileSync(join(root, DEFAULT_INVENTORY_PATH), "utf8"));
    expect(Object.keys(written)).toEqual(["schema", "srclawyerVersion", "discovery", "categories", "processors"]);
    expect(written).toMatchObject({ schema: 1, discovery: "git", processors: ["Stripe"] });
    expect(written.categories).toEqual([...written.categories].sort());
    expect(written.categories).toContain("email");
    expect(written.categories).toContain("payment_info"); // from the Stripe processor profile
    expect(stderr()).toContain(`Wrote the drift baseline to .srclawyer.inventory.json (${written.categories.length} categories, 1 processors; git discovery)`);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("two writes are byte-identical", async () => {
    const root = fresh();
    initRepo(root, BASE);
    setup();

    await scanWith(root, { writeInventory: "a.json" });
    await scanWith(root, { writeInventory: "b.json" });

    expect(readFileSync(join(root, "a.json"), "utf8")).toBe(readFileSync(join(root, "b.json"), "utf8"));
  });

  it("refuses to write when the scan completed with a warning that would make the baseline incomplete", async () => {
    const root = fresh();
    initRepo(root, { ...BASE, "manage.py": "# django\n" });
    const { stderr } = setup();

    await scanWith(root, { writeInventory: DEFAULT_INVENTORY_PATH });

    expect(existsSync(join(root, DEFAULT_INVENTORY_PATH))).toBe(false);
    expect(stderr()).toContain("Inventory not written");
    expect(stderr()).toContain("--allow-incomplete-inventory");
    expect(process.exitCode).toBe(1);
  });

  it("--allow-incomplete-inventory writes it anyway", async () => {
    const root = fresh();
    initRepo(root, { ...BASE, "manage.py": "# django\n" });
    setup();

    await scanWith(root, { writeInventory: DEFAULT_INVENTORY_PATH, allowIncompleteInventory: true });

    expect(existsSync(join(root, DEFAULT_INVENTORY_PATH))).toBe(true);
  });

  it("an AI-review misconfiguration does not block it -- that can't change Layer 1 categories", async () => {
    const root = fresh();
    initRepo(root, { ...BASE, ".srclawyer.config.yml": "entityLocation: US\ntargetMarkets: []\nindustry: null\ncollectsChildrensData: false\ntier: managed\n" });
    setup();

    await scanWith(root, { writeInventory: DEFAULT_INVENTORY_PATH, llm: true });

    expect(existsSync(join(root, DEFAULT_INVENTORY_PATH))).toBe(true);
    expect(process.exitCode).toBe(1); // scan still reports its own warning
  });

  it("uses ONE git-aware scan for the policy too, while plain scan keeps the ordinary walk", async () => {
    const root = fresh();
    initRepo(root, BASE);
    writeFiles(root, { "generated/bundle.js": "const { ssn } = req.body;\n" });
    setup();

    await scanWith(root, { out: "plain.md" });
    await scanWith(root, { out: "with-inventory.md", writeInventory: DEFAULT_INVENTORY_PATH });

    expect(readFileSync(join(root, "plain.md"), "utf8")).toContain("Government-issued identifiers");
    expect(readFileSync(join(root, "with-inventory.md"), "utf8")).not.toContain("Government-issued identifiers");
    expect(readFileSync(join(root, DEFAULT_INVENTORY_PATH), "utf8")).not.toContain("government_id");
  });

  it("outside a git repository it records glob discovery and says why", async () => {
    const root = fresh();
    writeFiles(root, BASE);
    const { stderr } = setup();

    await scanWith(root, { writeInventory: DEFAULT_INVENTORY_PATH });

    expect(JSON.parse(readFileSync(join(root, DEFAULT_INVENTORY_PATH), "utf8")).discovery).toBe("glob");
    expect(stderr()).toContain("not a git repository");
  });

  it("--json output reports what happened to the inventory", async () => {
    const root = fresh();
    initRepo(root, BASE);
    const { log } = setup();

    await scanWith(root, { json: true, writeInventory: DEFAULT_INVENTORY_PATH });

    const json = JSON.parse(String(log.mock.calls.find((c) => String(c[0]).trim().startsWith("{"))![0]));
    expect(json.inventoryNote).toContain("Wrote the drift baseline");
  });
});

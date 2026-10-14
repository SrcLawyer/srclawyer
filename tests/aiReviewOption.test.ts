import { describe, expect, it, vi, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { runInit, type InitFlags } from "../src/commands/init.js";
import { runScan } from "../src/commands/scan.js";
import { loadConfig, CONFIG_FILENAME } from "../src/config/config.js";
import { formatText } from "../src/report/formatText.js";
import type { ScanResult } from "../src/engine/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let dir: string;
const originalExitCode = process.exitCode;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), "srclawyer-ai-review-"));
  return dir;
}

/** Runs init with the given stdin lines; returns everything it printed (prompts and console output). */
async function initWith(root: string, answers: string[], flags: InitFlags = {}, isTTY = false): Promise<string> {
  const stdin = Readable.from([answers.join("\n") + "\n"]) as Readable & { isTTY?: boolean };
  stdin.isTTY = isTTY;
  const realStdin = process.stdin;
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  const printed: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => (printed.push(String(chunk)), true)) as never);
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void printed.push(args.map(String).join(" ")));
  try {
    await runInit(root, flags);
  } finally {
    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
  }
  return printed.join("\n");
}

// location, markets, industry, gate -> yes, then the twelve gated questions, all skipped with Enter.
const FULL_DEFAULT_FLOW = ["US", "", "", "y", ...Array(12).fill("")];

describe("default init: no AI-review question", () => {
  it("never mentions Anthropic, an API key, byok or a tier, and writes tier: free with no llm block", async () => {
    const root = tempDir();
    const printed = await initWith(root, FULL_DEFAULT_FLOW);

    expect(printed).not.toMatch(/anthropic/i);
    expect(printed).not.toMatch(/api key/i);
    expect(printed).not.toMatch(/byok|bring your own|AI-assisted|AI review|\btier\b|managed/i);

    const config = loadConfig(root);
    expect(config?.tier).toBe("free");
    expect(config?.llm).toBeUndefined();
  });

  it("holds on the shortest path too (policy details declined) and with empty stdin", async () => {
    const root = tempDir();
    const printed = await initWith(root, ["US", "", "", "n"]);
    expect(printed).not.toMatch(/anthropic|api key|byok|AI-assisted/i);
    expect(loadConfig(root)?.tier).toBe("free");

    rmSync(join(root, CONFIG_FILENAME));
    const empty = await initWith(root, []);
    expect(empty).not.toMatch(/anthropic|api key|byok|AI-assisted/i);
  });

  it("still offers 'Run a scan now?' at the end of an interactive run, and runs it on yes", async () => {
    const root = tempDir();
    writeFileSync(join(root, "server.js"), "const { email } = req.body;\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));

    const printed = await initWith(root, ["US", "", "", "n", "y"], {}, true);

    expect(printed).toContain("Run a scan now and generate your policy?");
    expect(existsSync(join(root, "PRIVACY_POLICY.md"))).toBe(true);
  });
});

describe("--enable-ai-review", () => {
  it("interactive: asks for the env var name (default ANTHROPIC_API_KEY) and writes tier: byok", async () => {
    const root = tempDir();
    const printed = await initWith(root, ["US", "", "", "MY_ANTHROPIC_KEY"], { enableAiReview: true, policyDetails: false });

    expect(printed).toContain("Which environment variable holds your Anthropic API key? [ANTHROPIC_API_KEY]");
    const config = loadConfig(root);
    expect(config?.tier).toBe("byok");
    expect(config?.llm).toEqual({ provider: "anthropic", apiKeyEnvVar: "MY_ANTHROPIC_KEY" });
    expect(printed).toContain('only the name "MY_ANTHROPIC_KEY" is written');
    expect(printed).toContain("BYOK is configured");
  });

  it("a blank answer takes the default ANTHROPIC_API_KEY", async () => {
    const root = tempDir();
    await initWith(root, ["US", "", "", ""], { enableAiReview: true, policyDetails: false });

    expect(loadConfig(root)?.llm?.apiKeyEnvVar).toBe("ANTHROPIC_API_KEY");
  });

  it("with --api-key-env-var: no prompt at all, the value is written", async () => {
    const root = tempDir();
    const printed = await initWith(root, [], { enableAiReview: true, apiKeyEnvVar: "FLAG_KEY_VAR", policyDetails: false });

    expect(printed).not.toContain("Which environment variable");
    const config = loadConfig(root);
    expect(config?.tier).toBe("byok");
    expect(config?.llm).toEqual({ provider: "anthropic", apiKeyEnvVar: "FLAG_KEY_VAR" });
  });

  it("never writes a key, only the variable's name", async () => {
    const root = tempDir();
    process.env.SRCLAWYER_TEST_SECRET_VALUE = "sk-ant-api03-SHOULD-NEVER-BE-WRITTEN-0000000000";
    try {
      await initWith(root, [], { enableAiReview: true, apiKeyEnvVar: "SRCLAWYER_TEST_SECRET_VALUE", policyDetails: false });
      expect(readFileSync(join(root, CONFIG_FILENAME), "utf8")).not.toContain("SHOULD-NEVER-BE-WRITTEN");
    } finally {
      delete process.env.SRCLAWYER_TEST_SECRET_VALUE;
    }
  });

  it("an invalid environment variable name falls back to the default, loudly", async () => {
    const root = tempDir();
    const printed = await initWith(root, ["US", "", "", "not a valid name!"], { enableAiReview: true, policyDetails: false });

    expect(printed).toContain("is not a valid environment variable name");
    expect(loadConfig(root)?.llm?.apiKeyEnvVar).toBe("ANTHROPIC_API_KEY");
  });

  it("is flag-driven, so the end-of-init 'Run a scan now?' prompt is not offered", async () => {
    const root = tempDir();
    const printed = await initWith(root, ["US", "", "", "n"], { enableAiReview: true, apiKeyEnvVar: "K", policyDetails: false }, true);

    expect(printed).not.toContain("Run a scan now");
  });
});

describe("the real CLI", () => {
  const run = (cwd: string, args: string[]) =>
    spawnSync("npx", ["tsx", join(ROOT, "src/cli.ts"), ...args], { cwd, encoding: "utf8", input: "" });

  it("init --enable-ai-review --api-key-env-var writes a byok config non-interactively", () => {
    const root = tempDir();
    const result = run(root, ["init", "--no-policy-details", "--enable-ai-review", "--api-key-env-var", "CLI_KEY_VAR"]);

    expect(result.status).toBe(0);
    expect(loadConfig(root)?.llm?.apiKeyEnvVar).toBe("CLI_KEY_VAR");
    expect(loadConfig(root)?.tier).toBe("byok");
  });

  it("--api-key-env-var without --enable-ai-review is an error, not silently ignored", () => {
    const root = tempDir();
    const result = run(root, ["init", "--no-policy-details", "--api-key-env-var", "CLI_KEY_VAR"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--api-key-env-var requires --enable-ai-review");
    expect(existsSync(join(root, CONFIG_FILENAME))).toBe(false);
  });

  it("rejects an invalid --api-key-env-var name", () => {
    const root = tempDir();
    const result = run(root, ["init", "--enable-ai-review", "--api-key-env-var", "bad name"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("valid environment variable name");
  });

  it("the default init --help documents the flags as advanced", () => {
    const help = execFileSync("npx", ["tsx", join(ROOT, "src/cli.ts"), "init", "--help"], { cwd: ROOT, encoding: "utf8" });
    expect(help).toContain("--enable-ai-review");
    expect(help).toContain("--api-key-env-var <name>");
    expect(help).toMatch(/advanced/i);
  });
});

describe("existing hand-edited configs behave as before", () => {
  const QUIET = () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("/v1/")) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      throw new Error(`unexpected fetch to ${href}`);
    });
    return { err: vi.spyOn(console, "error").mockImplementation(() => {}), log: vi.spyOn(console, "log").mockImplementation(() => {}) };
  };

  const base = ["entityLocation: US", "targetMarkets: []", "industry: null", "collectsChildrensData: false"];

  it("tier: managed still gives the clear 'not available yet' error, in the console and the policy, and exit 1", async () => {
    const root = tempDir();
    writeFileSync(join(root, CONFIG_FILENAME), [...base, "tier: managed"].join("\n"));
    writeFileSync(join(root, "server.js"), "const { notes } = req.body;\n");
    const { err } = QUIET();
    process.exitCode = undefined;

    await runScan(root, { json: false, out: "PRIVACY_POLICY.md", llm: true });

    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toContain("managed backend is not available yet");
    expect(readFileSync(join(root, "PRIVACY_POLICY.md"), "utf8")).toContain("AI-ASSISTED RESOLUTION DID NOT RUN");
    expect(process.exitCode).toBe(1);
  });

  it("tier: byok with the key set still sends ambiguous items to Anthropic, after printing the BYOK network notice", async () => {
    const root = tempDir();
    process.env.SRCLAWYER_TEST_BYOK_KEY = "fake-key";
    writeFileSync(join(root, CONFIG_FILENAME), [...base, "tier: byok", "llm:", "  provider: anthropic", "  apiKeyEnvVar: SRCLAWYER_TEST_BYOK_KEY"].join("\n"));
    writeFileSync(join(root, "server.js"), "const { notes } = req.body;\n");
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const href = String(url);
      calls.push(href);
      if (href.includes("/v1/")) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      return new Response("{}", { status: 500 });
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await runScan(root, { json: false, out: "PRIVACY_POLICY.md", llm: true });
    } finally {
      delete process.env.SRCLAWYER_TEST_BYOK_KEY;
    }

    expect(calls.some((c) => c.includes("api.anthropic.com"))).toBe(true);
    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toContain("BYOK is configured");
  });

  it("tier: free never prints the BYOK notice", async () => {
    const root = tempDir();
    writeFileSync(join(root, CONFIG_FILENAME), [...base, "tier: free"].join("\n"));
    writeFileSync(join(root, "server.js"), "const { notes } = req.body;\n");
    const { log } = QUIET();

    await runScan(root, { json: false, out: "PRIVACY_POLICY.md", llm: true });

    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("BYOK");
  });
});

describe("scan output wording", () => {
  const withAmbiguous = {
    projects: [],
    findings: [],
    ambiguousCount: 3,
    filesScanned: 1,
    unsupportedStackWarning: null,
    workspaceWarning: null,
    skippedFiles: [],
    skippedFilesWarning: null,
    templateSyntaxNote: null,
    pendingZodCandidates: [],
    oversizedZodFiles: [],
    maxZodFragmentBytes: 0,
  } as unknown as ScanResult;

  it("points to the advanced option only when AI review isn't already on, and never recommends 'byok' or 'managed' by name", () => {
    const off = formatText(withAmbiguous);
    expect(off).toContain("3 item(s) require deeper analysis");
    expect(off).toContain("Optional, advanced");
    expect(off).toContain('"AI-assisted review" in the README');
    expect(off).not.toMatch(/byok|managed|tier/i);

    const on = formatText(withAmbiguous, { aiReviewEnabled: true });
    expect(on).toContain("3 item(s) require deeper analysis");
    expect(on).not.toContain("Optional, advanced");
    expect(on).not.toMatch(/byok|managed|tier/i);
  });

  it("says nothing about AI review when there is nothing ambiguous", () => {
    expect(formatText({ ...withAmbiguous, ambiguousCount: 0 })).not.toMatch(/anthropic|AI-assisted/i);
  });
});

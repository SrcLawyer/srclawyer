import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { runInit, type InitFlags } from "../src/commands/init.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "srclawyer-init-runscan-"));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function runWithStdin(root: string, answers: string[], flags: InitFlags = {}, isTTY = false): Promise<void> {
  const stdin = Readable.from([answers.join("\n") + "\n"]) as Readable & { isTTY?: boolean };
  stdin.isTTY = isTTY;
  const realStdin = process.stdin;
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  try {
    await runInit(root, flags);
  } finally {
    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
  }
}

// entityLocation, targetMarkets, industry, gate (declined, so none of the twelve gated sub-questions
// are asked at all), enableByok -- the shortest real path to the final "run a scan now?" question.
const BASE_ANSWERS = ["US", "", "", "n", "n"];

describe("init: offer to run a scan at the end", () => {
  let dir: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeSampleProject(): void {
    writeFileSync(join(dir, "server.js"), "const express = require('express');\nconst app = express();\napp.post('/signup', (req, res) => { const { email } = req.body; res.send('ok'); });\n");
  }

  function mockScoreFieldsEndpoint(): void {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("/v1/score-fields")) return jsonResponse({ results: [] });
      if (href.includes("/v1/detect-zod-schema")) return jsonResponse({ results: [] });
      throw new Error(`unexpected fetch to ${href}`);
    });
  }

  it("asks the final question and runs a scan on yes, when interactive with no flags", async () => {
    dir = tempDir();
    vi.spyOn(console, "log").mockImplementation(() => {});
    writeSampleProject();
    mockScoreFieldsEndpoint();

    await runWithStdin(dir, [...BASE_ANSWERS, "y"], {}, true);

    expect(existsSync(join(dir, "PRIVACY_POLICY.md"))).toBe(true);
  });

  it("does not run a scan when the final question is answered no", async () => {
    dir = tempDir();
    vi.spyOn(console, "log").mockImplementation(() => {});
    writeSampleProject();
    mockScoreFieldsEndpoint();

    await runWithStdin(dir, [...BASE_ANSWERS, "n"], {}, true);

    expect(existsSync(join(dir, "PRIVACY_POLICY.md"))).toBe(false);
    // No scan ran, so no fetch to the protected-logic endpoint either.
    expect(fetchSpy.mock.calls.length).toBe(0);
  });

  it("never asks the final question, and never scans, when stdin is not a TTY", async () => {
    dir = tempDir();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeSampleProject();
    mockScoreFieldsEndpoint();

    await runWithStdin(dir, BASE_ANSWERS, {}, false);

    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("Run a scan now");
    expect(existsSync(join(dir, "PRIVACY_POLICY.md"))).toBe(false);
  });

  it("never asks the final question when the run is flag-driven, even on a real TTY", async () => {
    dir = tempDir();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeSampleProject();
    mockScoreFieldsEndpoint();

    // Only one flag passed -- still counts as flag-driven.
    await runWithStdin(dir, BASE_ANSWERS, { companyName: "Acme" }, true);

    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("Run a scan now");
    expect(existsSync(join(dir, "PRIVACY_POLICY.md"))).toBe(false);
  });

  it("does not ask or scan when a .srclawyer.config.yml already exists, and says so plainly", async () => {
    dir = tempDir();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFileSync(join(dir, ".srclawyer.config.yml"), "entityLocation: US\ntargetMarkets: []\nindustry: null\ncollectsChildrensData: false\n");

    await runWithStdin(dir, [], {}, true);

    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("already exists -- left unchanged");
    expect(logged).toContain("rm .srclawyer.config.yml");
    expect(logged).toContain("srclawyer init");
    expect(existsSync(join(dir, "PRIVACY_POLICY.md"))).toBe(false);
  });
});

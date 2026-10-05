import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { runInit } from "../src/commands/init.js";
import { runScan } from "../src/commands/scan.js";
import { NETWORK_CALLS_NOTICE, SCAN_DISCLAIMER_REMINDER, byokNetworkNotice } from "../src/policy/legalNotices.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("legal-notice touchpoints", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("init prints the network-calls notice once, non-interactively, before the setup prompts", async () => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-init-notice-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Simulate stdin closing immediately (e.g. piped from /dev/null, or Ctrl-D) -- every prompt then
    // falls back to its default, so this exercises the full non-interactive path end to end, the way
    // a scripted install would actually run it.
    const emptyStdin = Readable.from([]);
    const realStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: emptyStdin, configurable: true });

    try {
      await runInit(dir);
    } finally {
      Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
    }

    const loggedText = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(loggedText).toContain(NETWORK_CALLS_NOTICE);
    // The notice must print before the setup prompts start, not after.
    expect(loggedText.indexOf(NETWORK_CALLS_NOTICE)).toBeLessThan(loggedText.indexOf("SrcLawyer setup"));
  });

  it("scan prints the not-legal-advice reminder once at the end of text output", async () => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-scan-notice-"));
    writeFileSync(join(dir, "server.js"), "export function add(a, b) { return a + b; }\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ results: [] }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runScan(dir, { json: false, out: "PRIVACY_POLICY.md", llm: false });

    const loggedText = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(loggedText).toContain(SCAN_DISCLAIMER_REMINDER);
    // Comes after the "written to" line, i.e. it's the last thing printed, not buried mid-output.
    expect(loggedText.indexOf(SCAN_DISCLAIMER_REMINDER)).toBeGreaterThan(loggedText.indexOf("Privacy policy written to"));
  });

  it("scan does NOT print the BYOK network notice when the free tier is configured", async () => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-scan-notice-"));
    writeFileSync(join(dir, "server.js"), "export function add(a, b) { return a + b; }\n");
    writeFileSync(join(dir, ".srclawyer.config.yml"), "entityLocation: US\ntargetMarkets: []\nindustry: null\ncollectsChildrensData: false\ntier: free\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ results: [] }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runScan(dir, { json: false, out: "PRIVACY_POLICY.md", llm: false });

    const loggedText = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(loggedText).not.toContain("BYOK is configured");
  });

  it("byokNetworkNotice names the configured env var", () => {
    expect(byokNetworkNotice("ANTHROPIC_API_KEY")).toContain("ANTHROPIC_API_KEY");
    expect(byokNetworkNotice("ANTHROPIC_API_KEY")).toContain("Anthropic");
  });
});

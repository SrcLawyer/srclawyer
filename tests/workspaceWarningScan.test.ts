import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScan } from "../src/commands/scan.js";

describe("runScan: rejected workspace config", () => {
  let dir: string;
  const originalExitCode = process.exitCode;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("warns on the console, puts a banner in the policy file, and flags the run as incomplete", async () => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-ws-warning-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "evil", workspaces: ["{1..300}{1..300}{1..300}"] }));
    writeFileSync(join(dir, "a.js"), "const x = 1;\n");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled in test"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runScan(dir, { json: false, out: "PRIVACY_POLICY.md", llm: false });

    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("Workspace configuration in package.json was rejected");
    const policy = readFileSync(join(dir, "PRIVACY_POLICY.md"), "utf8");
    expect(policy).toContain("WARNING: WORKSPACE CONFIGURATION REJECTED");
    expect(policy).toContain("default package locations");
    expect(process.exitCode).toBe(1);
  });
});

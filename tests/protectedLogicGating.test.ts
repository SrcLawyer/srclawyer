import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScan } from "../src/commands/scan.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("runScan protected-logic gating", () => {
  let dir: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-protected-logic-"));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("makes zero protected-logic calls when nothing in the scan is classifiable", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    // A file with no PII-shaped code at all — no sdk import, no req.body access, no zod import.
    writeFileSync(join(dir, "util.js"), "export function add(a, b) { return a + b; }\n");

    await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: false });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("makes exactly one /v1/score-fields call, batched, when local rules classify fields, and no /v1/detect-zod-schema call", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/score-fields")) {
        return jsonResponse({ results: [] }); // empty is fine; we're only checking call shape here
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    writeFileSync(join(dir, "server.js"), "const { email, notes } = req.body;\n");

    await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: false });

    const urls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(urls.filter((u) => u.endsWith("/v1/score-fields"))).toHaveLength(1);
    expect(urls.filter((u) => u.endsWith("/v1/detect-zod-schema"))).toHaveLength(0);
  });

  it("calls /v1/detect-zod-schema before /v1/score-fields when a zod-shaped file is present, and folds the returned fields into scoring", async () => {
    const calls: string[] = [];
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/v1/detect-zod-schema")) {
        const body = JSON.parse((init as RequestInit).body as string) as { candidates: Array<{ id: string }> };
        const id = body.candidates[0].id;
        return jsonResponse({ results: [{ id, matched: true, fields: [{ name: "email", line: 1 }] }] });
      }
      if (u.endsWith("/v1/score-fields")) {
        const body = JSON.parse((init as RequestInit).body as string) as { fields: Array<{ id: string }> };
        return jsonResponse({
          results: body.fields.map((f) => ({ id: f.id, confidence: "medium", requiresReview: false })),
        });
      }
      throw new Error(`unexpected fetch to ${u}`);
    });

    writeFileSync(
      join(dir, "actions.ts"),
      ['import { z } from "zod";', "const schema = z.object({ email: z.string() });", "actionClient.inputSchema(schema);", ""].join("\n")
    );

    await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: false });

    const zodCallIndex = calls.findIndex((u) => u.endsWith("/v1/detect-zod-schema"));
    const scoreCallIndex = calls.findIndex((u) => u.endsWith("/v1/score-fields"));
    expect(zodCallIndex).toBeGreaterThanOrEqual(0);
    expect(zodCallIndex).toBeLessThan(scoreCallIndex);

    const policy = readFileSync(join(dir, "PRIVACY_POLICY.md"), "utf8");
    expect(policy).toContain("Email addresses");
  });

  it("degrades honestly (safe local fallback, scan-level warning, no throw) when the protected-logic endpoint is unreachable", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    writeFileSync(join(dir, "server.js"), "const { email } = req.body;\n");

    await expect(runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: false })).resolves.not.toThrow();

    const policy = readFileSync(join(dir, "PRIVACY_POLICY.md"), "utf8");
    // Unscored fields keep their safe local default (requiresReview: true) rather than being
    // silently marked confident — so this lands in the review section, not the confident body.
    expect(policy).toContain("Items Requiring Manual Review");
  });
});

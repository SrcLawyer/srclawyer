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

  it("suppresses a zod-matched field that's on the safe-field-name allowlist, exactly like formbricks' real page case", async () => {
    // Real golden-corpus false positive: formbricks' ZGetImagesFromUnsplashAction schema has a `page`
    // field (already on the safe list for direct request-field rules), but the zod-finding
    // construction path never called isSafeFieldName() at all -- "page" still produced a finding
    // because it arrived via the server's detect-zod-schema response, not a local rule.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/v1/detect-zod-schema")) {
        const body = JSON.parse((init as RequestInit).body as string) as { candidates: Array<{ id: string }> };
        const id = body.candidates[0].id;
        return jsonResponse({
          results: [{ id, matched: true, fields: [{ name: "page", line: 1 }, { name: "searchQuery", line: 1 }] }],
        });
      }
      if (u.endsWith("/v1/score-fields")) {
        const body = JSON.parse((init as RequestInit).body as string) as { fields: Array<{ id: string }> };
        return jsonResponse({ results: body.fields.map((f) => ({ id: f.id, confidence: "medium", requiresReview: false })) });
      }
      throw new Error(`unexpected fetch to ${u}`);
    });

    writeFileSync(
      join(dir, "actions.ts"),
      ['import { z } from "zod";', "const schema = z.object({ page: z.number(), searchQuery: z.string() });", "schema.parse(input);", ""].join("\n")
    );

    await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: false });

    const policy = readFileSync(join(dir, "PRIVACY_POLICY.md"), "utf8");
    expect(policy).not.toContain("page");
    expect(policy).toContain("searchQuery");
  });

  it("surfaces a scan-level warning naming the file when a Zod fragment is too large to send, instead of silently skipping it", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/score-fields")) return jsonResponse({ results: [] });
      throw new Error(`unexpected fetch to ${url}`);
    });

    // The schema itself, not a handler body, has to be what's huge here -- trimmed extraction elides
    // an oversized handler body down to {}, so only an oversized schema can still trip the cap.
    const schemaFields = Array.from({ length: 2000 }, (_, i) => `  fieldWithAVeryLongNameIndeed${i}: z.string(),`);
    writeFileSync(
      join(dir, "huge-actions.ts"),
      ['import { z } from "zod";', "const bodySchema = z.object({", ...schemaFields, "});", "bodySchema.parse(req.body);"].join("\n")
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let output: { protectedLogicWarning: string | null };
    try {
      await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: false });
      const jsonCall = logSpy.mock.calls.find(([arg]) => typeof arg === "string" && arg.trim().startsWith("{"));
      output = JSON.parse(jsonCall?.[0] as string);
    } finally {
      logSpy.mockRestore();
    }

    const urls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(urls.filter((u) => u.endsWith("/v1/detect-zod-schema"))).toHaveLength(0);
    expect(output.protectedLogicWarning).toContain("huge-actions.ts");
    expect(output.protectedLogicWarning).toContain("too large to send safely");
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

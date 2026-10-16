import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScan } from "../src/commands/scan.js";
import { CONFIG_FILENAME } from "../src/config/config.js";

/**
 * End to end: a fixture with nested paths goes through a real scan with AI-assisted review enabled,
 * and every request body that would reach the protected-logic Worker or Anthropic is captured. The
 * README and init notice promise no file path or line number is sent, so none may appear -- not in an
 * id, not in any key or value. (The Worker only echoes ids, so opaque ids lose nothing; the mapping
 * back to real findings happens client-side, which the last test checks.)
 */
const ENV_VAR = "SRCLAWYER_TEST_NO_PATHS_KEY";
const ZOD_FILE = "src/lib/deep/er/profile-actions.ts";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  raw: string;
}

let dir: string;
const originalExitCode = process.exitCode;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  delete process.env[ENV_VAR];
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, into));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

async function scanFixture(): Promise<{ captured: Captured[]; json: any; root: string }> {
  dir = mkdtempSync(join(tmpdir(), "srclawyer-nopaths-"));
  process.env[ENV_VAR] = "sk-ant-fake-key-for-test";
  for (const sub of ["src/api/users", "src/api/orders", "src/lib/deep/er"]) mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, "src/api/users/signup.ts"), "export function handler(req, res) {\n  const { email, notes } = req.body;\n  res.send('ok');\n}\n");
  writeFileSync(join(dir, "src/api/orders/checkout.ts"), "\n\n\nexport function checkout(req) {\n  const { payload } = req.body;\n}\n");
  writeFileSync(
    join(dir, ZOD_FILE),
    'import { z } from "zod";\nconst profileSchema = z.object({ email: z.string(), phoneNumber: z.string() });\nexport function POST(req) {\n  const data = profileSchema.parse(req.body);\n  return data;\n}\n'
  );
  writeFileSync(
    join(dir, CONFIG_FILENAME),
    ["entityLocation: US", "targetMarkets: []", "industry: null", "collectsChildrensData: false", "tier: byok", "llm:", "  provider: anthropic", `  apiKeyEnvVar: ${ENV_VAR}`].join("\n")
  );

  const captured: Captured[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const href = String(url);
    const raw = String((init as RequestInit).body);
    const body = JSON.parse(raw);
    captured.push({ url: href, headers: (init as RequestInit).headers as Record<string, string>, body, raw });
    const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });

    if (href.endsWith("/v1/detect-zod-schema")) {
      return reply({ results: body.candidates.map((c: { id: string }) => ({ id: c.id, matched: true, fields: [{ name: "email", line: 2 }, { name: "phoneNumber", line: 2 }] })) });
    }
    if (href.endsWith("/v1/score-fields")) {
      return reply({ results: body.fields.map((f: { id: string }) => ({ id: f.id, confidence: "low", requiresReview: true })) });
    }
    if (href.includes("api.anthropic.com")) {
      const items = JSON.parse(body.messages[0].content) as Array<{ findingId: string; evidence: string }>;
      return reply({
        content: [
          {
            type: "tool_use",
            name: "report_resolutions",
            input: {
              resolutions: items.map((item) => ({
                findingId: item.findingId,
                outcome: "resolved",
                reason: null,
                resolvedDataCategories: ["generic_pii"],
                resolvedDescription: "Free text.",
              })),
            },
          },
        ],
      });
    }
    throw new Error(`unexpected fetch to ${href}`);
  });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  await runScan(dir, { json: true, out: "PRIVACY_POLICY.md", llm: true });
  const printed = log.mock.calls.map((c) => String(c[0])).find((l) => l.trim().startsWith("{"))!;
  return { captured, json: JSON.parse(printed), root: dir };
}

describe("request bodies carry no file paths or line numbers", () => {
  it("hits all three endpoints (so the assertions below are not vacuous)", async () => {
    const { captured } = await scanFixture();
    const urls = captured.map((c) => c.url.replace("https://srclawyer-rules.anishjha352.workers.dev", "").replace("https://api.anthropic.com", "anthropic"));
    expect(urls).toEqual(expect.arrayContaining(["/v1/detect-zod-schema", "/v1/score-fields", "anthropic/v1/messages"]));
  });

  it("no body contains a file path, a fixture file name, any source file extension, or the scan root", async () => {
    const { captured, root } = await scanFixture();

    for (const c of captured) {
      expect(c.raw, c.url).not.toMatch(/src\//);
      expect(c.raw, c.url).not.toMatch(/signup|checkout|profile-actions|\bdeep\b|\borders\b|\busers\b/);
      expect(c.raw, c.url).not.toMatch(/\.(ts|tsx|js|jsx|mjs|cjs|py|html)\b/);
      expect(c.raw, c.url).not.toContain(root);
      expect(c.raw, c.url).not.toContain("field:");
    }
  });

  it("no body has a line-number, location, file or path field, at any depth", async () => {
    const { captured } = await scanFixture();

    for (const c of captured) {
      const keys = allKeys(c.body);
      // Anthropic's user message is a JSON string inside the body; inspect it too.
      const inner = (c.body as { messages?: Array<{ content: string }> }).messages?.[0]?.content;
      if (inner) allKeys(JSON.parse(inner), keys);
      for (const forbidden of ["line", "lineNumber", "column", "location", "file", "filename", "path", "relPath", "loc"]) {
        expect(keys.has(forbidden), `${c.url} has a "${forbidden}" key`).toBe(false);
      }
    }
  });

  it("every id on the wire is opaque: f<N> for fields and findings, c<N> for Zod candidates", async () => {
    const { captured } = await scanFixture();

    const zod = captured.filter((c) => c.url.endsWith("/v1/detect-zod-schema"));
    const score = captured.filter((c) => c.url.endsWith("/v1/score-fields"));
    const anthropic = captured.filter((c) => c.url.includes("api.anthropic.com"));

    for (const c of zod) for (const cand of (c.body as any).candidates) expect(cand.id).toMatch(/^c\d+$/);
    for (const c of score) for (const f of (c.body as any).fields) expect(f.id).toMatch(/^f\d+$/);
    for (const c of anthropic) for (const item of JSON.parse((c.body as any).messages[0].content)) expect(item.findingId).toMatch(/^f\d+$/);
  });

  it("each request body contains only the documented keys", async () => {
    const { captured } = await scanFixture();

    for (const c of captured) {
      if (c.url.endsWith("/v1/detect-zod-schema")) {
        expect(Object.keys(c.body as object)).toEqual(["candidates"]);
        for (const cand of (c.body as any).candidates) expect(Object.keys(cand).sort()).toEqual(["codeFragment", "id"]);
      } else if (c.url.endsWith("/v1/score-fields")) {
        expect(Object.keys(c.body as object)).toEqual(["fields"]);
        for (const f of (c.body as any).fields) expect(Object.keys(f).sort()).toEqual(["ambiguousName", "id", "lexiconCategory", "runtimeVerified", "siblingConfidentCount"]);
      } else {
        expect(Object.keys(c.body as object).sort()).toEqual(["max_tokens", "messages", "model", "system", "tool_choice", "tools"]);
        for (const item of JSON.parse((c.body as any).messages[0].content)) {
          expect(Object.keys(item).sort()).toEqual(["dataCategories", "description", "evidence", "findingId", "isHighStakes"]);
        }
      }
    }
  });

  it("request headers are only the documented ones", async () => {
    const { captured } = await scanFixture();

    for (const c of captured) {
      const names = Object.keys(c.headers).map((h) => h.toLowerCase()).sort();
      expect(names).toEqual(c.url.includes("api.anthropic.com") ? ["anthropic-version", "content-type", "x-api-key"] : ["content-type", "x-api-key"]);
    }
  });

  it("the mapping back is intact: results carry the real file and line, and Anthropic's answer lands on the right finding", async () => {
    const { json } = await scanFixture();

    const zodFindings = json.findings.filter((f: any) => f.source === "zod-rule");
    expect(zodFindings.length).toBeGreaterThan(0);
    for (const f of zodFindings) {
      expect(f.location.file).toBe(ZOD_FILE);
      expect(f.id).toContain(ZOD_FILE);
    }

    const notes = json.findings.find((f: any) => f.id === "field:src/api/users/signup.ts:2:notes");
    expect(notes).toBeDefined();
    expect(notes.location).toMatchObject({ file: "src/api/users/signup.ts", line: 2 });
    expect(notes.llmResolution?.outcome).toBe("resolved");
    const checkout = json.findings.find((f: any) => f.location.file === "src/api/orders/checkout.ts");
    expect(checkout.location.line).toBe(5);
    expect(checkout.llmResolution?.outcome).toBe("resolved");
  });
});

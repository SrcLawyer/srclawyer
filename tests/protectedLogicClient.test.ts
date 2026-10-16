import { describe, expect, it, vi, afterEach } from "vitest";
import { scoreFields, detectZodSchemas, type ScoreFieldsItem, type DetectZodSchemaItem } from "../src/cloud/protectedLogicClient.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const OPTIONS = { baseUrl: "https://example.test", apiKey: "test-key" };

describe("protectedLogicClient batching", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("splits into multiple batches once the total byte cap is exceeded, even under the item-count cap", async () => {
    // A single large codeFragment, well under the 25-item default batch size, still has to split once
    // the byte cap kicks in -- this is the synthetic "large fragment" case item 1 asked to test.
    const bigFragment = "x".repeat(40_000);
    const items: DetectZodSchemaItem[] = [
      { id: "a", codeFragment: bigFragment },
      { id: "b", codeFragment: bigFragment },
      { id: "c", codeFragment: "small" },
    ];

    const batchSizes: number[] = [];
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { candidates: unknown[] };
      batchSizes.push(body.candidates.length);
      return jsonResponse({ results: body.candidates.map((c: unknown) => ({ id: (c as { id: string }).id, matched: false, fields: [] })) });
    });

    const { results, error } = await detectZodSchemas(items, { ...OPTIONS, batchMaxBytes: 50_000 });

    expect(error).toBeNull();
    expect(results.size).toBe(3);
    // Each of the two big fragments alone is already close to the 50,000-byte cap, so each must land
    // in its own batch rather than being combined -- proves the byte cap, not just the item-count cap,
    // is actually doing the splitting here.
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
    expect(Math.max(...batchSizes)).toBeLessThan(3);
  });

  it("still batches by item count alone when items are small", async () => {
    const items: ScoreFieldsItem[] = Array.from({ length: 30 }, (_, i) => ({
      id: `field-${i}`,
      lexiconCategory: null,
      ambiguousName: false,
      runtimeVerified: true,
      siblingConfidentCount: 0,
    }));

    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { fields: unknown[] };
      return jsonResponse({ results: body.fields.map((f: unknown) => ({ id: (f as { id: string }).id, confidence: "low", requiresReview: true })) });
    });

    const { results } = await scoreFields(items, { ...OPTIONS, batchSize: 25 });

    expect(results.size).toBe(30);
    expect(fetchSpy.mock.calls.length).toBe(2); // 25 + 5, the original count-only behavior preserved
  });

  it("retries once on a 5xx and succeeds on the second attempt, with no error surfaced", async () => {
    let callCount = 0;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return jsonResponse({ error: "overloaded" }, 503);
      return jsonResponse({ results: [{ id: "f0", confidence: "low", requiresReview: true }] });
    });

    const { results, error } = await scoreFields(
      [{ id: "a", lexiconCategory: null, ambiguousName: false, runtimeVerified: true, siblingConfidentCount: 0 }],
      OPTIONS
    );

    expect(callCount).toBe(2);
    expect(error).toBeNull();
    expect(results.get("a")?.confidence).toBe("low");
  });

  it("degrades with a warning after a 5xx fails twice (one retry, then give up)", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "overloaded" }, 503));

    const { results, error } = await scoreFields(
      [{ id: "a", lexiconCategory: null, ambiguousName: false, runtimeVerified: true, siblingConfidentCount: 0 }],
      OPTIONS
    );

    expect(fetchSpy.mock.calls.length).toBe(2); // the original attempt + exactly one retry, not more
    expect(error).toContain("503");
    expect(results.size).toBe(0);
  });

  it("does not retry a 4xx -- it fails immediately, since a retry can't fix a bad request or auth error", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));

    const { error } = await scoreFields(
      [{ id: "a", lexiconCategory: null, ambiguousName: false, runtimeVerified: true, siblingConfidentCount: 0 }],
      OPTIONS
    );

    expect(fetchSpy.mock.calls.length).toBe(1);
    expect(error).toContain("401");
  });
});

describe("protectedLogicClient opaque ids", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const scoreItem = (id: string): ScoreFieldsItem => ({ id, lexiconCategory: "email", ambiguousName: false, runtimeVerified: true, siblingConfidentCount: 1 });

  it("score-fields: sends f0, f1, ... instead of the caller's ids, numbered across batches, and maps results back", async () => {
    const callerIds = ["field:src/api/users/signup.ts:2:email", "field:src/api/users/signup.ts:2:notes", "field:src/lib/deep/er/file.ts:40:phone"];
    const sentBodies: string[] = [];
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const raw = (init as RequestInit).body as string;
      sentBodies.push(raw);
      const body = JSON.parse(raw) as { fields: Array<{ id: string }> };
      return jsonResponse({ results: body.fields.map((f) => ({ id: f.id, confidence: "high", requiresReview: false })) });
    });

    const { results, error } = await scoreFields(callerIds.map(scoreItem), { ...OPTIONS, batchSize: 2 });

    expect(error).toBeNull();
    expect(sentBodies).toHaveLength(2);
    const sentIds = sentBodies.flatMap((raw) => (JSON.parse(raw) as { fields: Array<{ id: string }> }).fields.map((f) => f.id));
    expect(sentIds).toEqual(["f0", "f1", "f2"]);
    expect(sentBodies.join("")).not.toMatch(/src\/|\.ts|signup|field:/);
    expect([...results.keys()]).toEqual(callerIds);
    expect(results.get(callerIds[2])).toEqual({ id: callerIds[2], confidence: "high", requiresReview: false });
  });

  it("detect-zod-schema: sends c0, c1, ... instead of the file path, and maps results back to it", async () => {
    const paths = ["src/actions/profile-actions.ts", "src/other/deep/schema.ts"];
    let sent = "";
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sent += (init as RequestInit).body as string;
      const body = JSON.parse((init as RequestInit).body as string) as { candidates: Array<{ id: string }> };
      return jsonResponse({ results: body.candidates.map((c) => ({ id: c.id, matched: true, fields: [{ name: "email", line: 2 }] })) });
    });

    const { results } = await detectZodSchemas(
      paths.map((id) => ({ id, codeFragment: 'const s = z.object({ email: z.string() });' })),
      OPTIONS
    );

    expect((JSON.parse(sent) as { candidates: Array<{ id: string }> }).candidates.map((c) => c.id)).toEqual(["c0", "c1"]);
    expect(sent).not.toMatch(/src\/|profile-actions|\.ts"/);
    expect(results.get(paths[0])?.matched).toBe(true);
    expect(results.get(paths[1])?.id).toBe(paths[1]);
  });

  it("ignores a response id it never sent, rather than inventing a result for it", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ results: [{ id: "f0", confidence: "low", requiresReview: true }, { id: "f99", confidence: "high", requiresReview: false }, { id: "src/x.ts", confidence: "high", requiresReview: false }] })
    );

    const { results } = await scoreFields([scoreItem("field:a.ts:1:x")], OPTIONS);

    expect([...results.keys()]).toEqual(["field:a.ts:1:x"]);
  });
});

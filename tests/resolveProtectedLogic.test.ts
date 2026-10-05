import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveProtectedLogic } from "../src/cloud/resolveProtectedLogic.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const OPTIONS = { baseUrl: "https://example.test", apiKey: "test-key" };

describe("resolveProtectedLogic oversized-files warning", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("summarizes a long oversized-files list to a few names plus a count, not every name inline", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ results: [] }));

    const oversizedZodFiles = Array.from({ length: 30 }, (_, i) => `file-${i}.ts`);
    const { warning } = await resolveProtectedLogic([], [], OPTIONS, oversizedZodFiles);

    expect(warning).toContain("30 file(s)");
    expect(warning).toContain("file-0.ts, file-1.ts, file-2.ts");
    expect(warning).toContain("and 27 more");
    expect(warning).not.toContain("file-29.ts"); // the full list is in ScanResult.oversizedZodFiles, not this string
  });

  it("names every file inline, with no truncation suffix, when there are only a few", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ results: [] }));

    const { warning } = await resolveProtectedLogic([], [], OPTIONS, ["a.ts", "b.ts"]);

    expect(warning).toContain("a.ts, b.ts");
    expect(warning).not.toContain("more");
  });
});

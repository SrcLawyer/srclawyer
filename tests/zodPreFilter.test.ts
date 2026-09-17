import { describe, expect, it } from "vitest";
import { findZodCandidates } from "../src/rules/zodPreFilter.js";

describe("findZodCandidates", () => {
  it("finds nothing when there's no zod import at all", () => {
    const source = `actionClient.inputSchema(schema).parse(req.body);\n`;
    expect(findZodCandidates(source, "/root/a.ts", "/root")).toHaveLength(0);
  });

  it("finds nothing when zod is imported but no anchor-shaped call is present", () => {
    const source = `import { z } from "zod";\nconst schema = z.object({ email: z.string() });\n`;
    expect(findZodCandidates(source, "/root/a.ts", "/root")).toHaveLength(0);
  });

  it("produces exactly one candidate, deliberately without confirming an actual match, when both signals are present", () => {
    const source = `import { z } from "zod";\nconst schema = z.object({ email: z.string() });\nactionClient.inputSchema(schema);\n`;
    const candidates = findZodCandidates(source, "/root/actions.ts", "/root");

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("actions.ts");
    expect(candidates[0].codeFragment).toContain("z.object");
    expect(candidates[0].codeFragment).toContain("inputSchema");
  });

  it("redacts secret-shaped values before they leave this function", () => {
    const source = [
      `import { z } from "zod";`,
      `const key = "sk_test_FAKEFAKEFAKEFAKEFAKEFAKE";`,
      `const schema = z.object({ email: z.string() });`,
      `schema.parse(req.body);`,
      "",
    ].join("\n");
    const candidates = findZodCandidates(source, "/root/a.ts", "/root");

    expect(candidates[0].codeFragment).not.toContain("sk_test_FAKEFAKEFAKEFAKEFAKEFAKE");
  });

  it("maps fragment line numbers back to real source line numbers", () => {
    // 200 filler lines before the anchor — comfortably more than the +/-40 line window plus the
    // 20-line import block, so the fragment is provably NOT a contiguous slice starting at line 1,
    // and a real gap exists between the import block and the window around the anchor.
    const filler = Array.from({ length: 200 }, (_, i) => `// filler ${i}`);
    const source = [`import { z } from "zod";`, ...filler, `schema.parse(req.body);`].join("\n");
    const candidates = findZodCandidates(source, "/root/a.ts", "/root");

    const anchorLineInSource = 202; // 1-based: line 1 is the import, then 200 filler lines, then the anchor
    const fragmentIndexOfAnchor = candidates[0].fragmentLineToSourceLine.indexOf(anchorLineInSource);
    expect(fragmentIndexOfAnchor).toBeGreaterThanOrEqual(0);
    expect(candidates[0].fragmentLineToSourceLine.length).toBeLessThan(source.split("\n").length);
  });
});

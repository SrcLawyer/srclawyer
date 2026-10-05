import { describe, expect, it } from "vitest";
import { findZodCandidates } from "../src/rules/zodPreFilter.js";
import { parseSource } from "../src/engine/astUtils.js";

describe("findZodCandidates", () => {
  it("finds nothing when there's no zod import at all", () => {
    const source = `actionClient.inputSchema(schema).parse(req.body);\n`;
    expect(findZodCandidates(source, "/root/a.ts", "/root").candidates).toHaveLength(0);
  });

  it("finds nothing when zod is imported but no anchor-shaped call is present", () => {
    const source = `import { z } from "zod";\nconst schema = z.object({ email: z.string() });\n`;
    expect(findZodCandidates(source, "/root/a.ts", "/root").candidates).toHaveLength(0);
  });

  it("produces exactly one candidate, deliberately without confirming an actual match, when both signals are present", () => {
    const source = `import { z } from "zod";\nconst schema = z.object({ email: z.string() });\nactionClient.inputSchema(schema);\n`;
    const { candidates } = findZodCandidates(source, "/root/actions.ts", "/root");

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("actions.ts");
    expect(candidates[0].codeFragment).toContain("z.object");
    expect(candidates[0].codeFragment).toContain("inputSchema");
  });

  it("redacts secret-shaped values before they leave this function", () => {
    // The secret has to live inside a statement that's actually included in the fragment (the schema
    // declaration itself, since that's what gets sent) — not an unrelated line the extraction would
    // exclude anyway, which would make this assertion pass for the wrong reason.
    const source = [
      `import { z } from "zod";`,
      `const schema = z.object({ email: z.string(), apiKey: z.string().default("sk_test_FAKEFAKEFAKEFAKEFAKEFAKE") });`,
      `schema.parse(req.body);`,
      "",
    ].join("\n");
    const { candidates } = findZodCandidates(source, "/root/a.ts", "/root");

    expect(candidates[0].codeFragment).toContain("z.object");
    expect(candidates[0].codeFragment).not.toContain("sk_test_FAKEFAKEFAKEFAKEFAKEFAKE");
  });

  it("maps fragment line numbers back to real source line numbers", () => {
    // 200 filler comment lines between the import and the anchor statement — comments aren't part of
    // any top-level statement, so they're excluded, proving the fragment is a genuine non-contiguous
    // excerpt (just the import + the one-line anchor statement), not a contiguous slice from line 1.
    const filler = Array.from({ length: 200 }, (_, i) => `// filler ${i}`);
    const source = [`import { z } from "zod";`, ...filler, `schema.parse(req.body);`].join("\n");
    const { candidates } = findZodCandidates(source, "/root/a.ts", "/root");

    const anchorLineInSource = 202; // 1-based: line 1 is the import, then 200 filler lines, then the anchor
    const fragmentIndexOfAnchor = candidates[0].fragmentLineToSourceLine.indexOf(anchorLineInSource);
    expect(fragmentIndexOfAnchor).toBeGreaterThanOrEqual(0);
    expect(candidates[0].fragmentLineToSourceLine.length).toBeLessThan(source.split("\n").length);
  });

  it("includes a named schema's declaration even when it's declared far from its anchor call", () => {
    // Mirrors a real golden-corpus miss: formbricks defines ZCreateUserAction near the top of a file
    // and anchors it 300+ lines later via actionClient.inputSchema(ZCreateUserAction) — extraction has
    // to resolve the reference back to its own top-level declaration statement, wherever it is.
    const filler = Array.from({ length: 300 }, (_, i) => `// filler ${i}`);
    const source = [
      `import { z } from "zod";`,
      `const ZCreateUserAction = z.object({ email: z.string(), password: z.string() });`,
      ...filler,
      `export const createUserAction = actionClient.inputSchema(ZCreateUserAction).action(async () => {});`,
    ].join("\n");
    const { candidates } = findZodCandidates(source, "/root/actions.ts", "/root");

    expect(candidates).toHaveLength(1);
    expect(candidates[0].codeFragment).toContain("ZCreateUserAction = z.object");
    expect(candidates[0].codeFragment).toContain("inputSchema(ZCreateUserAction)");
  });

  it("includes a schema referenced via a bare .parse() receiver, declared far away", () => {
    const filler = Array.from({ length: 300 }, (_, i) => `// filler ${i}`);
    const source = [
      `import { z } from "zod";`,
      `const bodySchema = z.object({ email: z.string() });`,
      ...filler,
      `bodySchema.parse(req.body);`,
    ].join("\n");
    const { candidates } = findZodCandidates(source, "/root/a.ts", "/root");

    expect(candidates).toHaveLength(1);
    expect(candidates[0].codeFragment).toContain("bodySchema = z.object");
  });

  it("elides an unrelated handler body down to an empty block, but keeps the statement syntactically valid and the schema/anchor intact", () => {
    // Real golden-corpus shape: formbricks' signup action wraps ~130 unrelated lines of business
    // logic around the anchor. None of that logic affects whether ZCreateUserAction validates
    // incoming request data -- the Worker's judgment only needs the schema and the anchor's shape.
    const bodyLines = Array.from({ length: 120 }, (_, i) => `  doSomething(${i});`);
    const source = [
      `import { z } from "zod";`,
      `const bodySchema = z.object({ email: z.string() });`,
      `export const createUserAction = actionClient.inputSchema(bodySchema).action(async () => {`,
      ...bodyLines,
      `});`,
    ].join("\n");
    const { candidates } = findZodCandidates(source, "/root/actions.ts", "/root");

    expect(candidates).toHaveLength(1);
    const fragment = candidates[0].codeFragment;
    expect(fragment).toContain("bodySchema = z.object");
    expect(fragment).toContain("inputSchema(bodySchema)");
    expect(fragment).not.toContain("doSomething");
    // Still a real Program on its own -- an empty-bodied async arrow is valid syntax, not a guess.
    expect(parseSource(fragment, "/root/fragment.ts")).not.toBeNull();
  });

  it("does NOT elide a handler body that itself contains the anchor -- that content is the whole point of sending the fragment", () => {
    const source = [
      `import { z } from "zod";`,
      `const schema = z.object({ email: z.string() });`,
      `app.post("/signup", async (req, res) => {`,
      `  const parsed = schema.parse(req.body);`,
      `  doSomethingUnrelated();`,
      `});`,
    ].join("\n");
    const { candidates } = findZodCandidates(source, "/root/server.ts", "/root");

    expect(candidates).toHaveLength(1);
    expect(candidates[0].codeFragment).toContain("schema.parse(req.body)");
  });

  it("includes only imports actually referenced by the sent fragment, not every import in the file", () => {
    const source = [
      `import { z } from "zod";`,
      `import { unusedHelper } from "./unused-helper";`,
      `import { ZId } from "./zod-helpers";`,
      `const schema = z.object({ id: ZId, email: z.string() });`,
      `schema.parse(req.body);`,
    ].join("\n");
    const { candidates } = findZodCandidates(source, "/root/actions.ts", "/root");

    expect(candidates).toHaveLength(1);
    expect(candidates[0].codeFragment).toContain(`import { ZId } from "./zod-helpers"`);
    expect(candidates[0].codeFragment).not.toContain("unusedHelper");
  });

  describe("oversized fragments", () => {
    it("drops a fragment exceeding MAX_FRAGMENT_BYTES and reports the file as oversized instead of sending it", () => {
      // The schema itself, not a handler body, has to be what's huge here -- an oversized handler
      // body would just get elided down to {} like the test above, no longer tripping the cap at all.
      const schemaFields = Array.from({ length: 2000 }, (_, i) => `  fieldWithAVeryLongNameIndeed${i}: z.string(),`);
      const source = [
        `import { z } from "zod";`,
        `const bodySchema = z.object({`,
        ...schemaFields,
        `});`,
        `bodySchema.parse(req.body);`,
      ].join("\n");

      const { candidates, oversizedFiles } = findZodCandidates(source, "/root/huge-actions.ts", "/root");

      expect(candidates).toHaveLength(0);
      expect(oversizedFiles).toEqual(["huge-actions.ts"]);
    });

    it("still sends a normal-sized fragment from a different file in the same scan, unaffected by another file's oversized one", () => {
      const source = `import { z } from "zod";\nconst schema = z.object({ email: z.string() });\nschema.parse(req.body);\n`;
      const { candidates, oversizedFiles } = findZodCandidates(source, "/root/normal.ts", "/root");

      expect(candidates).toHaveLength(1);
      expect(oversizedFiles).toHaveLength(0);
    });
  });
});

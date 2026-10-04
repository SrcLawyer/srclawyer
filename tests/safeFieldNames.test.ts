import { describe, expect, it } from "vitest";
import { parseSource } from "../src/engine/astUtils.js";
import { runFrameworkRules } from "../src/rules/frameworkRules.js";
import { runHtmlInputRules } from "../src/rules/htmlRules.js";
import { parseOpenApiSpec } from "../src/schemaParsers/openapi.js";
import { isSafeFieldName } from "../src/rules/safeFieldNames.js";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("isSafeFieldName", () => {
  it("treats the new pagination/sort names as safe, in any common separator style", () => {
    for (const name of ["per_page", "perPage", "page_size", "pageSize", "cursor", "next_cursor", "prev_cursor", "sort_by", "order_by", "sort_order"]) {
      expect(isSafeFieldName(name)).toBe(true);
    }
  });

  it("does NOT treat next/prev/since/until/before/after/dir as safe -- the safe list is the only silent-drop path, and these are all plausible non-pagination PII elsewhere (e.g. a post-login redirect target)", () => {
    for (const name of ["next", "prev", "since", "until", "before", "after", "dir", "direction"]) {
      expect(isSafeFieldName(name)).toBe(false);
    }
  });
});

describe("safe field name allowlist", () => {
  it("suppresses structural fields like id/createdAt/status entirely instead of flagging them for review", () => {
    const source = `const { id, createdAt, status, diagnosis } = req.body;\n`;
    const ast = parseSource(source, "server.js")!;
    const findings = runFrameworkRules(ast, "/root/server.js", source, "/root");

    const flaggedNames = findings.map((f) => f.description);
    expect(findings).toHaveLength(1);
    expect(flaggedNames[0]).toContain("diagnosis");
    expect(findings[0].requiresReview).toBe(true);
  });

  it("suppresses safe-named HTML inputs but still flags an unrecognized one", () => {
    const html = `<input type="text" id="id"><input type="text" id="createdAt"><input type="text" id="internalRef">`;
    const findings = runHtmlInputRules(html, "/root/index.html", "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toContain("internalRef");
    expect(findings[0].requiresReview).toBe(true);
  });

  it("suppresses safe OpenAPI schema properties but still flags an unrecognized one", () => {
    const dir = mkdtempSync(join(tmpdir(), "srclawyer-openapi-safe-"));
    const specPath = join(dir, "openapi.yaml");
    writeFileSync(
      specPath,
      [
        "openapi: 3.0.0",
        "components:",
        "  schemas:",
        "    User:",
        "      type: object",
        "      properties:",
        "        id:",
        "          type: string",
        "        createdAt:",
        "          type: string",
        "        diagnosis:",
        "          type: string",
      ].join("\n")
    );

    const findings = parseOpenApiSpec(specPath, dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toBe("diagnosis");
    expect(findings[0].requiresReview).toBe(true);
  });
});

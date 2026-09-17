import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Finding } from "../engine/types.js";
import { classifyFieldName, isAmbiguousFieldName } from "../rules/dataCategoryLexicon.js";
import { isSafeFieldName } from "../rules/safeFieldNames.js";

const TYPE_BLOCK_START = /^\s*(type|input)\s+(\w+)/;
const FIELD_LINE = /^\s*(\w+)\s*(\([^)]*\))?\s*:\s*[\[\]!\w]+/;
const GRAPHQL_CONNECTION_FIELDS = new Set(["edges", "node", "pageInfo", "cursor", "hasNextPage", "hasPreviousPage", "totalCount"]);

export function parseGraphQLSchema(filePath: string, root: string): Finding[] {
  const raw = readFileSync(filePath, "utf8");
  const relPath = relative(root, filePath);
  const lines = raw.split("\n");
  const findings: Finding[] = [];

  let depth = 0;
  let inTypeBlock = false;

  lines.forEach((rawLine, idx) => {
    const line = rawLine.split("#")[0];
    if (TYPE_BLOCK_START.test(line)) {
      inTypeBlock = true;
      depth = 0;
    }
    if (inTypeBlock) {
      depth += (line.match(/{/g) ?? []).length;
      depth -= (line.match(/}/g) ?? []).length;
      if (depth <= 0 && line.includes("}")) {
        inTypeBlock = false;
        return;
      }

      const fieldMatch = FIELD_LINE.exec(line);
      if (fieldMatch && !TYPE_BLOCK_START.test(line)) {
        const fieldName = fieldMatch[1];
        if (GRAPHQL_CONNECTION_FIELDS.has(fieldName) || isSafeFieldName(fieldName)) return;

        const category = classifyFieldName(fieldName);
        const ambiguous = isAmbiguousFieldName(fieldName);
        findings.push({
          id: `graphql:${relPath}:${idx + 1}:${fieldName}`,
          dataCategories: category ? [category] : ["generic_pii"],
          processor: null,
          description: category
            ? `GraphQL field "${fieldName}" classified as ${category}.`
            : `GraphQL field "${fieldName}" could not be confidently classified — needs review.`,
          confidence: category ? "medium" : "low",
          source: "graphql",
          location: { file: relPath, line: idx + 1, column: 0 },
          evidence: line.trim(),
          requiresReview: ambiguous || !category,
        });
      }
    }
  });

  return findings;
}

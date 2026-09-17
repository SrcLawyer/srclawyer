import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { parseDocument, LineCounter, isMap, isPair, isScalar } from "yaml";
import type { Finding } from "../engine/types.js";
import { classifyFieldName, isAmbiguousFieldName } from "../rules/dataCategoryLexicon.js";
import { isSafeFieldName } from "../rules/safeFieldNames.js";

export function parseOpenApiSpec(filePath: string, root: string): Finding[] {
  const raw = readFileSync(filePath, "utf8");

  const lineCounter = new LineCounter();
  const doc = parseDocument(raw, { lineCounter, keepSourceTokens: true });
  if (!doc.contents) return [];

  const relPath = relative(root, filePath);
  const findings: Finding[] = [];
  const seen = new Set<string>();

  const schemasNode = doc.getIn(["components", "schemas"], true);
  if (isMap(schemasNode)) {
    for (const schemaPair of schemasNode.items) {
      if (!isPair(schemaPair)) continue;
      const schemaBody = schemaPair.value;
      if (!isMap(schemaBody)) continue;
      const properties = schemaBody.get("properties", true);
      if (!isMap(properties)) continue;

      for (const propPair of properties.items) {
        if (!isPair(propPair) || !isScalar(propPair.key)) continue;
        const fieldName = String(propPair.key.value);
        const range = propPair.key.range;
        const line = lineCounter.linePos(range ? range[0] : 0).line;
        pushFinding(fieldName, line, relPath, findings, seen);
      }
    }
  }

  return findings;
}

function pushFinding(fieldName: string, line: number, relPath: string, findings: Finding[], seen: Set<string>) {
  if (isSafeFieldName(fieldName)) return;

  const key = `${relPath}:${fieldName}`;
  if (seen.has(key)) return;
  seen.add(key);

  const category = classifyFieldName(fieldName);
  const ambiguous = isAmbiguousFieldName(fieldName);

  findings.push({
    id: `openapi:${relPath}:${line}:${fieldName}`,
    dataCategories: category ? [category] : ["generic_pii"],
    processor: null,
    description: category
      ? `OpenAPI schema field "${fieldName}" classified as ${category}.`
      : `OpenAPI schema field "${fieldName}" could not be confidently classified — needs review.`,
    confidence: category ? "medium" : "low",
    source: "openapi",
    location: { file: relPath, line, column: 0 },
    evidence: fieldName,
    requiresReview: ambiguous || !category,
  });
}

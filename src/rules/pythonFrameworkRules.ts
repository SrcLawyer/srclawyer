import { relative } from "node:path";
import type { Node, Tree } from "web-tree-sitter";
import type { Finding } from "../engine/types.js";
import { classifyFieldName, isAmbiguousFieldName } from "./dataCategoryLexicon.js";
import { isSafeFieldName } from "./safeFieldNames.js";
import { redactSecrets } from "../engine/secretRedaction.js";
import { countConfidentSiblings } from "./confidenceFactors.js";

/**
 * Flask's incoming-request accessors: request.form / request.json / request.args. Anchored to the
 * literal name "request" rather than a configurable-name regex (unlike Express's req/request, which
 * is a per-handler parameter that can be named anything) -- Flask's `request` is always the direct,
 * module-level import from `flask`, used by that exact name in effectively all real code.
 */
const REQUEST_ATTR = /^request\.(form|json|args)$/;
const REQUEST_GET_CALL = /^request\.(form|json|args)\.get$/;

function stringLiteralContent(node: Node | null): string | null {
  if (!node || node.type !== "string") return null;
  return node.descendantsOfType("string_content")[0]?.text ?? null;
}

interface FieldAccess {
  fieldName: string;
  line: number;
}

function collectFieldAccesses(tree: Tree): FieldAccess[] {
  const accesses: FieldAccess[] = [];

  for (const node of tree.rootNode.descendantsOfType("subscript")) {
    const value = node.childForFieldName("value");
    if (!value || !REQUEST_ATTR.test(value.text)) continue;
    const key = stringLiteralContent(node.childForFieldName("subscript"));
    if (key) accesses.push({ fieldName: key, line: node.startPosition.row + 1 });
  }

  for (const node of tree.rootNode.descendantsOfType("call")) {
    const fn = node.childForFieldName("function");
    if (!fn || !REQUEST_GET_CALL.test(fn.text)) continue;
    const args = node.childForFieldName("arguments")?.namedChildren ?? [];
    const key = stringLiteralContent(args[0] ?? null);
    if (key) accesses.push({ fieldName: key, line: node.startPosition.row + 1 });
  }

  return accesses;
}

export function runPythonFrameworkRules(tree: Tree, filePath: string, source: string, root: string): Finding[] {
  const lines = source.split("\n");
  const relPath = relative(root, filePath);
  const accesses = collectFieldAccesses(tree);
  const allFieldNames = accesses.map((a) => a.fieldName);

  const findings: Finding[] = [];
  const emitted = new Set<string>();

  for (const { fieldName, line } of accesses) {
    if (isSafeFieldName(fieldName)) continue;

    const dedupeKey = `${fieldName}:${line}`;
    if (emitted.has(dedupeKey)) continue;
    emitted.add(dedupeKey);

    const lexiconCategory = classifyFieldName(fieldName);
    const ambiguousName = isAmbiguousFieldName(fieldName);
    const siblingConfidentCount = countConfidentSiblings(allFieldNames, fieldName);
    const evidenceLine = lines[line - 1] ?? "";

    // Provisional confidence, patched by the batched protected-logic scoring call -- same pattern as
    // frameworkRules.ts's JS equivalent; the scoring endpoint doesn't care which language a
    // confidenceFactors-bearing finding came from.
    findings.push({
      id: `field:${relPath}:${line}:${fieldName}`,
      dataCategories: lexiconCategory ? [lexiconCategory] : ["generic_pii"],
      processor: null,
      description: lexiconCategory
        ? `Request field "${fieldName}" collected, classified as ${lexiconCategory}.`
        : `Request field "${fieldName}" collected; could not confidently classify — needs review.`,
      confidence: "low",
      source: "framework-rule",
      location: { file: relPath, line, column: 0 },
      evidence: redactSecrets(evidenceLine.trim()).slice(0, 200),
      requiresReview: true,
      confidenceFactors: { lexiconCategory, ambiguousName, runtimeVerified: true, siblingConfidentCount },
    });
  }

  return findings;
}

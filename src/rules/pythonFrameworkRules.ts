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
const REQUEST_GET_JSON_CALL = /^request\.get_json$/;

function stringLiteralContent(node: Node | null): string | null {
  if (!node || node.type !== "string") return null;
  return node.descendantsOfType("string_content")[0]?.text ?? null;
}

interface FieldAccess {
  fieldName: string;
  line: number;
}

/** True for the RHS of `x = <this>`: request.form / .json / .args, or a request.get_json() call. */
function isRequestDataSource(node: Node): boolean {
  if (node.type === "attribute") return REQUEST_ATTR.test(node.text);
  if (node.type === "call") {
    const fn = node.childForFieldName("function");
    return !!fn && REQUEST_GET_JSON_CALL.test(fn.text);
  }
  return false;
}

/**
 * The nearest enclosing function_definition's node id, or -1 for module-level code. Scoped by `.id`
 * rather than the Node object itself -- web-tree-sitter doesn't guarantee the same underlying syntax
 * node comes back as the same JS object identity across separate traversal calls (same `.id`, new
 * wrapper), so using Node references as Map keys silently never matches.
 */
function enclosingScopeId(node: Node): number {
  let current = node.parent;
  while (current) {
    if (current.type === "function_definition") return current.id;
    current = current.parent;
  }
  return -1;
}

/**
 * Same-function alias tracking: `data = request.get_json()` (or `= request.form` / `.json` / `.args`)
 * followed by `data['x']` / `data.get('x')` in the same function body. Deliberately one mechanical hop,
 * scoped to the nearest enclosing function (or module level), not general dataflow -- no cross-function
 * tracking, no chained reassignment, no branch/conditional awareness, no closures capturing an outer
 * function's alias. This is exactly the gap the microblog golden-corpus entry documented: real signup
 * PII read via request.get_json() into a local variable rather than a direct request.json[...] subscript.
 */
function collectRequestAliases(tree: Tree): Map<number, Set<string>> {
  const aliasesByScope = new Map<number, Set<string>>();

  for (const node of tree.rootNode.descendantsOfType("assignment")) {
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    if (!left || left.type !== "identifier" || !right || !isRequestDataSource(right)) continue;

    const scope = enclosingScopeId(node);
    const aliases = aliasesByScope.get(scope) ?? new Set<string>();
    aliases.add(left.text);
    aliasesByScope.set(scope, aliases);
  }

  return aliasesByScope;
}

function collectFieldAccesses(tree: Tree): FieldAccess[] {
  const accesses: FieldAccess[] = [];
  const aliasesByScope = collectRequestAliases(tree);

  const isAliasReference = (node: Node | null): boolean =>
    !!node && node.type === "identifier" && !!aliasesByScope.get(enclosingScopeId(node))?.has(node.text);

  for (const node of tree.rootNode.descendantsOfType("subscript")) {
    const value = node.childForFieldName("value");
    if (!value) continue;
    const isDirect = REQUEST_ATTR.test(value.text) || (value.type === "call" && isRequestDataSource(value));
    if (!isDirect && !isAliasReference(value)) continue;
    const key = stringLiteralContent(node.childForFieldName("subscript"));
    if (key) accesses.push({ fieldName: key, line: node.startPosition.row + 1 });
  }

  for (const node of tree.rootNode.descendantsOfType("call")) {
    const fn = node.childForFieldName("function");
    if (!fn) continue;
    const isDirectGet = REQUEST_GET_CALL.test(fn.text);
    const isAliasGet =
      fn.type === "attribute" &&
      fn.childForFieldName("attribute")?.text === "get" &&
      isAliasReference(fn.childForFieldName("object"));
    if (!isDirectGet && !isAliasGet) continue;
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

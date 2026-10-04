import _traverse from "@babel/traverse";
import type { File, ObjectPattern, Node } from "@babel/types";
import type { NodePath, TraverseOptions } from "@babel/traverse";
import { relative } from "node:path";
import type { Finding } from "../engine/types.js";
import { classifyFieldName, isAmbiguousFieldName } from "./dataCategoryLexicon.js";
import { isSafeFieldName } from "./safeFieldNames.js";
import { redactSecrets } from "../engine/secretRedaction.js";
import { countConfidentSiblings } from "./confidenceFactors.js";

type TraverseFn = (ast: Node, visitor: TraverseOptions) => void;
const traverse: TraverseFn = ((_traverse as unknown as { default?: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

// Exported so other rule modules anchoring detection to "this value came from an incoming request"
// (e.g. zodPreFilter.ts) can match the exact same shapes, rather than redefining them independently.
export const REQUEST_OBJECT_NAMES = /^(req|request)$/;
export const REQUEST_BODY_PROPS = /^(body|query|params)$/;

function fieldsFromObjectPattern(pattern: ObjectPattern): string[] {
  const names: string[] = [];
  for (const prop of pattern.properties) {
    if (prop.type === "ObjectProperty" && prop.key.type === "Identifier") {
      names.push(prop.key.name);
    }
  }
  return names;
}

function isRequestBodyMemberExpression(node: Node): boolean {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "Identifier" &&
    REQUEST_OBJECT_NAMES.test(node.object.name) &&
    node.property.type === "Identifier" &&
    REQUEST_BODY_PROPS.test(node.property.name)
  );
}

function isAwaitedRequestJsonCall(node: Node): boolean {
  return (
    node.type === "AwaitExpression" &&
    node.argument.type === "CallExpression" &&
    node.argument.callee.type === "MemberExpression" &&
    node.argument.callee.object.type === "Identifier" &&
    REQUEST_OBJECT_NAMES.test(node.argument.callee.object.name) &&
    node.argument.callee.property.type === "Identifier" &&
    node.argument.callee.property.name === "json"
  );
}

/**
 * Same-function alias tracking: `const body = req.body` (or `req.query`/`req.params`, or
 * `await req.json()`) followed by `body.email` / `body['email']` / `const { email } = body` in the
 * same function body. Deliberately one mechanical hop, scoped to the nearest enclosing function (or
 * module/program scope for top-level code) via Babel's own `getFunctionParent()` -- not general
 * dataflow: no cross-function tracking, no chained reassignment, no closures capturing an outer
 * function's alias. Mirrors pythonFrameworkRules.ts's same-function alias tracking exactly, for the
 * same reason: `const body = req.body; body.email` was structurally invisible before this, just like
 * `data = request.get_json(); data['email']` was on the Python side.
 */
function collectRequestAliases(ast: File): Map<Node, Set<string>> {
  const aliasesByScope = new Map<Node, Set<string>>();

  traverse(ast, {
    VariableDeclarator(path) {
      const id = path.node.id;
      const init = path.node.init;
      if (!init || id.type !== "Identifier") return;
      if (!isRequestBodyMemberExpression(init) && !isAwaitedRequestJsonCall(init)) return;

      const scope = path.getFunctionParent()?.node ?? ast.program;
      const aliases = aliasesByScope.get(scope) ?? new Set<string>();
      aliases.add(id.name);
      aliasesByScope.set(scope, aliases);
    },
  });

  return aliasesByScope;
}

function enclosingScope(path: NodePath, ast: File): Node {
  return path.getFunctionParent()?.node ?? ast.program;
}

export function runFrameworkRules(ast: File, filePath: string, source: string, root: string): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split("\n");
  const relPath = relative(root, filePath);
  const emitted = new Set<string>();

  function emit(fieldName: string, line: number, node: Node, siblingFieldNames: string[] = []) {
    if (isSafeFieldName(fieldName)) return;

    const dedupeKey = `${fieldName}:${line}`;
    if (emitted.has(dedupeKey)) return;
    emitted.add(dedupeKey);

    const lexiconCategory = classifyFieldName(fieldName);
    const ambiguousName = isAmbiguousFieldName(fieldName);
    const siblingConfidentCount = countConfidentSiblings(siblingFieldNames, fieldName);
    const evidenceLine = lines[line - 1] ?? "";

    // Confidence/requiresReview are provisional here — the safe fallback until the batched
    // protected-logic scoring call (src/cloud/protectedLogicClient.ts) patches them in scanEngine.ts.
    // dataCategories uses the local lexicon result directly since categorization itself is local,
    // generic, and unprotected; only the CONFIDENCE verdict is cloud-scored.
    findings.push({
      id: `field:${relPath}:${line}:${fieldName}`,
      dataCategories: lexiconCategory ? [lexiconCategory] : ["generic_pii"],
      processor: null,
      description: lexiconCategory
        ? `Request field "${fieldName}" collected, classified as ${lexiconCategory}.`
        : `Request field "${fieldName}" collected; could not confidently classify — needs review.`,
      confidence: "low",
      source: "framework-rule",
      location: { file: relPath, line, column: node.loc?.start.column ?? 0 },
      evidence: redactSecrets(evidenceLine.trim()).slice(0, 200),
      requiresReview: true,
      confidenceFactors: { lexiconCategory, ambiguousName, runtimeVerified: true, siblingConfidentCount },
    });
  }

  const aliasesByScope = collectRequestAliases(ast);
  const isAliasReference = (path: NodePath, name: string): boolean => !!aliasesByScope.get(enclosingScope(path, ast))?.has(name);

  traverse(ast, {
    MemberExpression(path) {
      const { object, property, computed } = path.node;
      if (object.type !== "Identifier") return;

      if (REQUEST_OBJECT_NAMES.test(object.name) && !computed && property.type === "Identifier" && REQUEST_BODY_PROPS.test(property.name)) {
        const parent = path.parent;
        if (parent.type === "MemberExpression" && parent.property.type === "Identifier") {
          emit(parent.property.name, parent.loc?.start.line ?? path.node.loc?.start.line ?? 1, parent);
          return;
        }

        if (parent.type === "VariableDeclarator" && parent.id.type === "ObjectPattern") {
          const line = parent.loc?.start.line ?? 1;
          const siblingFieldNames = fieldsFromObjectPattern(parent.id);
          for (const fieldName of siblingFieldNames) {
            emit(fieldName, line, parent, siblingFieldNames);
          }
        }
        return;
      }

      // Alias reference: `body.email` or `body['email']`, where `body` was assigned from
      // req.body/.query/.params or await req.json() earlier in the same function.
      if (!isAliasReference(path, object.name)) return;
      const line = path.node.loc?.start.line ?? 1;
      if (!computed && property.type === "Identifier") {
        emit(property.name, line, path.node);
      } else if (computed && property.type === "StringLiteral") {
        emit(property.value, line, path.node);
      }
    },
    AwaitExpression(path) {
      const argument = path.node.argument;
      if (argument.type !== "CallExpression") return;
      const callee = argument.callee;
      if (callee.type !== "MemberExpression") return;
      if (callee.object.type !== "Identifier" || !REQUEST_OBJECT_NAMES.test(callee.object.name)) return;
      if (callee.property.type !== "Identifier" || callee.property.name !== "json") return;

      const parent = path.parent;
      if (parent.type === "VariableDeclarator" && parent.id.type === "ObjectPattern") {
        const line = parent.loc?.start.line ?? 1;
        const siblingFieldNames = fieldsFromObjectPattern(parent.id);
        for (const fieldName of siblingFieldNames) {
          emit(fieldName, line, parent, siblingFieldNames);
        }
      }
    },
    VariableDeclarator(path) {
      // Alias destructure: `const { email } = body`, where `body` was assigned from
      // req.body/.query/.params or await req.json() earlier in the same function.
      const init = path.node.init;
      const id = path.node.id;
      if (!init || init.type !== "Identifier" || id.type !== "ObjectPattern") return;
      if (!isAliasReference(path, init.name)) return;

      const line = path.node.loc?.start.line ?? 1;
      const siblingFieldNames = fieldsFromObjectPattern(id);
      for (const fieldName of siblingFieldNames) {
        emit(fieldName, line, path.node, siblingFieldNames);
      }
    },
  });

  return findings;
}

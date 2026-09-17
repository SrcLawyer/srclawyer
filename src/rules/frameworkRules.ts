import _traverse from "@babel/traverse";
import type { File, ObjectPattern, Node } from "@babel/types";
import type { TraverseOptions } from "@babel/traverse";
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

  traverse(ast, {
    MemberExpression(path) {
      const { object, property } = path.node;
      if (object.type !== "Identifier" || !REQUEST_OBJECT_NAMES.test(object.name)) return;
      if (property.type !== "Identifier" || !REQUEST_BODY_PROPS.test(property.name)) return;

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
  });

  return findings;
}

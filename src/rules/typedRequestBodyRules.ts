import _traverse from "@babel/traverse";
import type { File, Node } from "@babel/types";
import type { TraverseOptions } from "@babel/traverse";
import { relative } from "node:path";
import type { Finding } from "../engine/types.js";
import { classifyFieldName, isAmbiguousFieldName } from "./dataCategoryLexicon.js";
import { isSafeFieldName } from "./safeFieldNames.js";
import { redactSecrets } from "../engine/secretRedaction.js";
import { REQUEST_BODY_PROPS, REQUEST_OBJECT_NAMES } from "./frameworkRules.js";
import { countConfidentSiblings } from "./confidenceFactors.js";
import type { TsProjectHandle } from "../engine/tsProject.js";

/**
 * Anchored to the SAME request-entry-point shapes frameworkRules.ts already recognizes
 * (req.body/req.query/req.params, await request.json()) — this module only extends detection to the
 * ONE case Babel's syntax-only parse structurally cannot see: a request body bound to a plain
 * Identifier with an explicit TS type annotation, rather than destructured into an ObjectPattern.
 *
 * `const { email } = await request.json();` is fully handled by frameworkRules.ts already (the field
 * names are literal AST nodes) and is deliberately NOT re-handled here — re-emitting from the type
 * checker for that case would either double-count or require cross-module dedupe for no benefit.
 * Only `const body: SignupRequest = await request.json();` — where `body` is a bare Identifier and
 * there is no ObjectPattern for frameworkRules.ts's destructuring branch to match at all — needs the
 * type checker to find out what fields `SignupRequest` actually has.
 *
 * The type-checking itself (buildTsProject/getObjectTypeMembersAt) runs entirely locally — it needs
 * the whole project's file tree to resolve cross-file types, which is exactly the kind of broad
 * access that must never leave this machine. Only the resulting field NAMES are ever queued for the
 * protected-logic scoring call, same as every other rule module here.
 */

type TraverseFn = (ast: Node, visitor: TraverseOptions) => void;
const traverse: TraverseFn = ((_traverse as unknown as { default?: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

function isRequestJsonOrBodyEntryPoint(node: Node): boolean {
  if (node.type === "MemberExpression") {
    return (
      node.object.type === "Identifier" &&
      REQUEST_OBJECT_NAMES.test(node.object.name) &&
      node.property.type === "Identifier" &&
      REQUEST_BODY_PROPS.test(node.property.name)
    );
  }
  if (node.type === "AwaitExpression" && node.argument.type === "CallExpression") {
    const callee = node.argument.callee;
    return (
      callee.type === "MemberExpression" &&
      callee.object.type === "Identifier" &&
      REQUEST_OBJECT_NAMES.test(callee.object.name) &&
      callee.property.type === "Identifier" &&
      callee.property.name === "json"
    );
  }
  return false;
}

export function runTypedRequestBodyRules(
  ast: File,
  filePath: string,
  source: string,
  root: string,
  getTsProject: () => TsProjectHandle | null
): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split("\n");
  const relPath = relative(root, filePath);
  const emitted = new Set<string>();

  function emit(fieldName: string, line: number, siblingFieldNames: string[]) {
    if (isSafeFieldName(fieldName)) return;

    const dedupeKey = `${fieldName}:${line}`;
    if (emitted.has(dedupeKey)) return;
    emitted.add(dedupeKey);

    const lexiconCategory = classifyFieldName(fieldName);
    const ambiguousName = isAmbiguousFieldName(fieldName);
    const siblingConfidentCount = countConfidentSiblings(siblingFieldNames, fieldName);
    const evidenceLine = lines[line - 1] ?? "";

    // runtimeVerified: false, always — a type annotation is compile-time-only and can silently lie
    // relative to runtime reality (an `as X` cast, a stale interface). The scoring call's hard gate
    // means requiresReview will come back true regardless of category/ambiguousName; confidence/
    // requiresReview here are the provisional safe fallback until that call patches them in.
    findings.push({
      id: `type:${relPath}:${line}:${fieldName}`,
      dataCategories: lexiconCategory ? [lexiconCategory] : ["generic_pii"],
      processor: null,
      description: lexiconCategory
        ? `Request field "${fieldName}" inferred from a TypeScript type annotation (not runtime-verified); classified as ${lexiconCategory}.`
        : `Request field "${fieldName}" inferred from a TypeScript type annotation (not runtime-verified); could not confidently classify — needs review.`,
      confidence: "low",
      source: "type-rule",
      location: { file: relPath, line, column: 0 },
      evidence: redactSecrets(evidenceLine.trim()).slice(0, 200),
      requiresReview: true,
      confidenceFactors: { lexiconCategory, ambiguousName, runtimeVerified: false, siblingConfidentCount },
    });
  }

  traverse(ast, {
    VariableDeclarator(path) {
      const { id, init } = path.node;
      if (!init || !isRequestJsonOrBodyEntryPoint(init)) return;
      if (id.type !== "Identifier" || !id.typeAnnotation || id.typeAnnotation.type !== "TSTypeAnnotation") return;

      const pos = id.loc?.start;
      if (!pos) return;

      const tsProject = getTsProject();
      if (!tsProject) return;

      const members = tsProject.getObjectTypeMembersAt(filePath, pos.line, pos.column);
      if (!members) return;

      const line = path.node.loc?.start.line ?? pos.line;
      for (const fieldName of members) emit(fieldName, line, members);
    },
  });

  return findings;
}

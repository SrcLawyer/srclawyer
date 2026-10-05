import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { parseDocument, LineCounter, isMap, isSeq, isPair, isScalar, type Document, type YAMLMap } from "yaml";
import type { Finding } from "../engine/types.js";
import { classifyFieldName, isAmbiguousFieldName } from "../rules/dataCategoryLexicon.js";
import { isSafeFieldName } from "../rules/safeFieldNames.js";

const SCHEMA_REF_RE = /^#\/components\/schemas\/([^/]+)$/;
const REQUEST_BODY_REF_RE = /^#\/components\/requestBodies\/([^/]+)$/;
const PARAMETER_REF_RE = /^#\/components\/parameters\/([^/]+)$/;

/**
 * Only schemas reachable from an operation's requestBody or parameters describe data a client SENDS
 * (what this tool is for) -- a schema that's only ever a response shape describes data the server
 * SENDS BACK, which isn't "data we collect" even though it's identical AST-wise. The old behavior
 * walked every components.schemas entry unconditionally, so response-only schemas (and any other
 * schema that just happens to exist in the file, unreferenced from any operation) were
 * indistinguishable from real request-input schemas.
 *
 * Reachability is resolved by $ref, recursively, through the schema-composition keywords that can
 * nest another $ref: allOf/oneOf/anyOf (each item), items (array schemas), additionalProperties (when
 * itself a schema object, not a bare true/false), and properties (object schemas can nest $ref'd
 * sub-schemas). A requestBody or parameter that is itself a $ref (to components.requestBodies /
 * components.parameters) is resolved one level before walking its schema.
 */
function refTarget(node: unknown, re: RegExp): string | null {
  if (!isMap(node)) return null;
  const ref = node.get("$ref", true);
  if (!isScalar(ref) || typeof ref.value !== "string") return null;
  return re.exec(ref.value)?.[1] ?? null;
}

function walkSchemaForRefs(node: unknown, schemasMap: YAMLMap, found: Set<string>, visited: Set<string>): void {
  if (!isMap(node)) return;

  const refName = refTarget(node, SCHEMA_REF_RE);
  if (refName) {
    if (visited.has(refName)) return;
    visited.add(refName);
    found.add(refName);
    const target = schemasMap.get(refName, true);
    walkSchemaForRefs(target, schemasMap, found, visited);
    return; // a $ref node's only meaningful content is the reference itself (OpenAPI/JSON Schema convention)
  }

  for (const key of ["allOf", "oneOf", "anyOf"]) {
    const arr = node.get(key, true);
    if (isSeq(arr)) {
      for (const item of arr.items) walkSchemaForRefs(item, schemasMap, found, visited);
    }
  }

  const items = node.get("items", true);
  if (items) walkSchemaForRefs(items, schemasMap, found, visited);

  const additionalProperties = node.get("additionalProperties", true);
  if (isMap(additionalProperties)) walkSchemaForRefs(additionalProperties, schemasMap, found, visited);

  const properties = node.get("properties", true);
  if (isMap(properties)) {
    for (const propPair of properties.items) {
      if (isPair(propPair)) walkSchemaForRefs(propPair.value, schemasMap, found, visited);
    }
  }
}

function resolvedRequestBody(requestBody: unknown, doc: Document): unknown {
  const refName = refTarget(requestBody, REQUEST_BODY_REF_RE);
  if (!refName) return requestBody;
  return doc.getIn(["components", "requestBodies", refName], true);
}

function resolvedParameter(parameter: unknown, doc: Document): unknown {
  const refName = refTarget(parameter, PARAMETER_REF_RE);
  if (!refName) return parameter;
  return doc.getIn(["components", "parameters", refName], true);
}

function collectSchemasFromContent(content: unknown, schemasMap: YAMLMap, found: Set<string>, visited: Set<string>): void {
  if (!isMap(content)) return;
  for (const mediaTypePair of content.items) {
    if (!isPair(mediaTypePair) || !isMap(mediaTypePair.value)) continue;
    const schema = mediaTypePair.value.get("schema", true);
    if (schema) walkSchemaForRefs(schema, schemasMap, found, visited);
  }
}

function collectReachableFromParameters(parameters: unknown, doc: Document, schemasMap: YAMLMap, found: Set<string>, visited: Set<string>): void {
  if (!isSeq(parameters)) return;
  for (const param of parameters.items) {
    const resolved = resolvedParameter(param, doc);
    if (!isMap(resolved)) continue;
    const schema = resolved.get("schema", true);
    if (schema) walkSchemaForRefs(schema, schemasMap, found, visited);
    collectSchemasFromContent(resolved.get("content", true), schemasMap, found, visited);
  }
}

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/**
 * Returns the set of components.schemas names reachable from any operation's requestBody or
 * parameters, or null if the spec has no `paths` at all -- a spec with no paths gives no entry point
 * to resolve reachability from, and filtering down to nothing in that case would silently drop
 * everything rather than reflect "nothing is reachable" accurately. null means "don't filter."
 */
function collectReachableSchemaNames(doc: Document, schemasMap: YAMLMap): Set<string> | null {
  const pathsNode = doc.getIn(["paths"], true);
  if (!isMap(pathsNode) || pathsNode.items.length === 0) return null;

  const found = new Set<string>();
  const visited = new Set<string>();

  for (const pathPair of pathsNode.items) {
    if (!isPair(pathPair) || !isMap(pathPair.value)) continue;
    const pathItem = pathPair.value;

    // Path-level parameters apply to every operation under this path.
    collectReachableFromParameters(pathItem.get("parameters", true), doc, schemasMap, found, visited);

    for (const method of HTTP_METHODS) {
      const operation = pathItem.get(method, true);
      if (!isMap(operation)) continue;

      const requestBody = resolvedRequestBody(operation.get("requestBody", true), doc);
      if (isMap(requestBody)) collectSchemasFromContent(requestBody.get("content", true), schemasMap, found, visited);

      collectReachableFromParameters(operation.get("parameters", true), doc, schemasMap, found, visited);
    }
  }

  return found;
}

export function parseOpenApiSpec(filePath: string, root: string): Finding[] {
  const raw = readFileSync(filePath, "utf8");

  const lineCounter = new LineCounter();
  const doc = parseDocument(raw, { lineCounter, keepSourceTokens: true });
  if (!doc.contents) return [];

  const relPath = relative(root, filePath);
  const findings: Finding[] = [];
  const seen = new Set<string>();

  const schemasNode = doc.getIn(["components", "schemas"], true);
  if (!isMap(schemasNode)) return [];

  const reachable = collectReachableSchemaNames(doc, schemasNode);

  for (const schemaPair of schemasNode.items) {
    if (!isPair(schemaPair) || !isScalar(schemaPair.key)) continue;
    const schemaName = String(schemaPair.key.value);
    // null (no paths in this spec) means "can't determine reachability, don't filter" -- never
    // silently drop everything just because there was nothing to resolve reachability from.
    if (reachable !== null && !reachable.has(schemaName)) continue;

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

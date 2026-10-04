import { relative } from "node:path";
import type { Statement } from "@babel/types";
import { redactSecrets } from "../engine/secretRedaction.js";
import { parseSource } from "../engine/astUtils.js";

/**
 * The real Zod schema/anchor detection (which call sites count as "this validates incoming request
 * data" vs. a third-party API response or an env-var schema — the actual scope-boundary reasoning)
 * runs server-side now (protected-logic cloud service). This module's only job is deciding WHETHER a
 * file is worth sending, and extracting a syntactically complete, minimal fragment to send — not the
 * tuned "is this genuinely a request-input validator" logic itself.
 *
 * Extraction is AST-boundary-based, not a raw line-count window: earlier drafts joined arbitrary
 * +/-N-line windows around each anchor/declaration, which silently produced invalid syntax whenever a
 * window boundary landed inside a multi-line import, or inside a long enclosing function — a real
 * golden-corpus file (formbricks' signup action) hit both, and the whole fragment failed to parse
 * server-side with zero error surfaced (a schema simply went undetected). Extracting whole top-level
 * statements instead guarantees every included chunk is independently valid, so concatenating a subset
 * of them is always a valid Program — no re-implementation of the protected scope-boundary reasoning
 * is needed to get that guarantee, just "which top-level statement is this line part of."
 */
const ZOD_IMPORT_RE = /from\s+["']zod(?:\/v[34](?:-mini)?)?["']/;
const ANCHOR_CALL_RE = /\.(?:parse|safeParse|parseAsync|safeParseAsync|inputSchema)\s*\(/;

/**
 * An individual fragment this large is unlikely on real request-validation schemas and risky to send
 * at all: the protected-logic Worker has a hard CPU time limit, confirmed (via wrangler tail) to be
 * exceeded intermittently by large detect-zod-schema batches. A single over-cap fragment is dropped
 * entirely rather than sent and risking it alone blowing the whole batch's CPU budget -- the caller
 * surfaces which file was skipped (see oversizedFiles below) so the gap is never silent.
 */
export const MAX_FRAGMENT_BYTES = 8_000;

// Resolving "which identifier does this anchor call reference, and where is IT declared at the top
// level" is plain lexical lookup, not the protected scope-boundary judgment — safe to do locally so a
// schema declared far from its anchor (very common: define near the top, use in an export lower down)
// still gets included.
const INPUT_SCHEMA_ARG_RE = /\.inputSchema\(\s*([A-Za-z_$][\w$]*)/;
const PARSE_RECEIVER_RE = /([A-Za-z_$][\w$]*)\.(?:parse|safeParse|parseAsync|safeParseAsync)\(/;

export interface ZodCandidate {
  id: string;
  codeFragment: string;
  /** fragmentLineToSourceLine[i] = the original 1-based source line for fragment line i+1. Lets
   *  resolveProtectedLogic() translate a server-reported fragment line back to a real location,
   *  since the fragment is a non-contiguous excerpt of the original file, not a raw slice. */
  fragmentLineToSourceLine: number[];
}

function lineRange(node: { loc?: Statement["loc"] }): [number, number] | null {
  if (!node.loc) return null;
  return [node.loc.start.line - 1, node.loc.end.line - 1]; // 0-based, inclusive
}

function findEnclosingStatement(body: Statement[], line0: number): Statement | undefined {
  return body.find((stmt) => stmt.loc && stmt.loc.start.line - 1 <= line0 && line0 <= stmt.loc.end.line - 1);
}

function findDeclarationStatement(body: Statement[], name: string): Statement | undefined {
  return body.find(
    (stmt) =>
      stmt.type === "VariableDeclaration" &&
      stmt.declarations.some((d) => d.id.type === "Identifier" && d.id.name === name)
  );
}

export interface FindZodCandidatesResult {
  candidates: ZodCandidate[];
  /** Relative paths of files whose extracted fragment exceeded MAX_FRAGMENT_BYTES and was dropped
   *  rather than sent -- the caller must surface these, never drop them silently. */
  oversizedFiles: string[];
}

export function findZodCandidates(source: string, filePath: string, root: string): FindZodCandidatesResult {
  const none: FindZodCandidatesResult = { candidates: [], oversizedFiles: [] };
  if (!ZOD_IMPORT_RE.test(source)) return none;

  const lines = source.split("\n");
  const matchLineIndexes: number[] = [];
  lines.forEach((line, i) => {
    if (ANCHOR_CALL_RE.test(line)) matchLineIndexes.push(i);
  });
  if (matchLineIndexes.length === 0) return none;

  const ast = parseSource(source, filePath);
  if (!ast) return none;

  const body = ast.program.body;
  const includedLines = new Set<number>();
  const includeRange = (range: [number, number] | null) => {
    if (!range) return;
    for (let i = range[0]; i <= range[1]; i++) includedLines.add(i);
  };

  for (const directive of ast.program.directives) includeRange(lineRange(directive));
  for (const stmt of body) {
    if (stmt.type === "ImportDeclaration") includeRange(lineRange(stmt));
  }

  // One candidate per file, not per match — a single fragment covering every anchor-shaped
  // statement plus the top-of-file imports, merged and deduped. Keeps this a single call per file
  // rather than one per match; the server already handles "multiple schemas in one fragment" naturally.
  for (const matchLine of matchLineIndexes) {
    const enclosing = findEnclosingStatement(body, matchLine);
    if (!enclosing) continue;
    includeRange(lineRange(enclosing));

    const line = lines[matchLine];
    const referencedName = line.match(INPUT_SCHEMA_ARG_RE)?.[1] ?? line.match(PARSE_RECEIVER_RE)?.[1];
    if (!referencedName) continue;

    const declStmt = findDeclarationStatement(body, referencedName);
    if (declStmt) includeRange(lineRange(declStmt));
  }

  if (includedLines.size === 0) return none;

  const sortedIndexes = [...includedLines].sort((a, b) => a - b);
  const fragment = sortedIndexes.map((i) => lines[i]).join("\n");
  const fragmentLineToSourceLine = sortedIndexes.map((i) => i + 1);
  const relPath = relative(root, filePath);

  const redacted = redactSecrets(fragment);
  if (Buffer.byteLength(redacted, "utf8") > MAX_FRAGMENT_BYTES) {
    return { candidates: [], oversizedFiles: [relPath] };
  }

  return { candidates: [{ id: relPath, codeFragment: redacted, fragmentLineToSourceLine }], oversizedFiles: [] };
}

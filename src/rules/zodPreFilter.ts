import { relative } from "node:path";
import _traverse from "@babel/traverse";
import type { Statement, ImportDeclaration } from "@babel/types";
import type { TraverseOptions } from "@babel/traverse";
import { redactSecrets } from "../engine/secretRedaction.js";
import { parseSource } from "../engine/astUtils.js";

type TraverseFn = (ast: import("@babel/types").Node, visitor: TraverseOptions) => void;
const traverse: TraverseFn = ((_traverse as unknown as { default?: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

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
 *
 * Within the anchor's own enclosing statement, any NESTED function body that doesn't itself contain an
 * anchor match is elided down to an empty block (`{}`) rather than sent whole: the schema judgment only
 * needs the schema and the shape of the anchor call (`X.inputSchema(Y)` / `Y.parse(...)`), never the
 * unrelated business logic a real handler wraps around it (formbricks' signup action alone was ~130
 * lines of that). Eliding is itself statement-boundary-based (a whole function body, start to end), so
 * it can't produce invalid syntax the way an arbitrary line cut could.
 */
const ZOD_IMPORT_RE = /from\s+["']zod(?:\/v[34](?:-mini)?)?["']/;
const ANCHOR_CALL_RE = /\.(?:parse|safeParse|parseAsync|safeParseAsync|inputSchema)\s*\(/;

/**
 * A hard ceiling, not a normal operating limit: protectedLogicClient.ts batches by total bytes, so a
 * large fragment is sent ALONE in its own request rather than bundled with others -- the actual
 * per-batch CPU risk that caused intermittent "Worker exceeded CPU time limit" failures (confirmed via
 * wrangler tail) is handled there, not here. This constant exists only to refuse something pathological
 * (e.g. a machine-generated file with one enormous schema), not to cap ordinary real-world files -- and
 * trimmed extraction (above) means ordinary files need it even less than before.
 *
 * Measured (uncapped, pre-trimming) across the three golden-corpus repos: max 41,992 bytes
 * (formbricks/packages/types/surveys/types.ts). This value is PROVISIONAL and unvalidated against the
 * real Worker limit: that depends on a Cloudflare plan upgrade that hasn't happened yet. Revisit once
 * the upgrade is confirmed and the 10-run wrangler tail test has been repeated.
 */
export const MAX_FRAGMENT_BYTES = 65_536;

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

function containsLine(range: [number, number], line0: number): boolean {
  return line0 >= range[0] && line0 <= range[1];
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

/**
 * Within `root`'s own line range, finds every function body that contains none of `protectedLines`
 * (the real anchor match lines) and returns the set of its INNER line numbers (never the lines holding
 * the opening/closing brace themselves, so the brace pair that keeps the surrounding statement valid is
 * always kept). A function that DOES contain a protected line is left alone -- its content is exactly
 * the point of sending this fragment -- but still descended into, in case it wraps a further, genuinely
 * unrelated nested closure of its own.
 */
function findElidableInnerLines(file: import("@babel/types").Node, rootRange: [number, number], protectedLines: number[]): Set<number> {
  const elidable = new Set<number>();

  // @babel/traverse requires a Program/File root (not an arbitrary sub-statement) -- traverse the
  // whole file and use rootRange to scope the search to just the one enclosing statement.
  traverse(file, {
    Function(path) {
      const body = path.node.body;
      if (body.type !== "BlockStatement") return; // concise arrow body (`() => x`) -- nothing to strip
      const bodyRange = lineRange(body);
      if (!bodyRange) return;
      if (bodyRange[0] < rootRange[0] || bodyRange[1] > rootRange[1]) return; // outside root entirely

      // Only the lines STRICTLY BETWEEN the braces count as "inside" this block for protection
      // purposes -- the opening-brace line very often also carries the anchor itself (formbricks'
      // `actionClient.inputSchema(X).action(async () => {` is one line), and that anchor is textually
      // before the `{`, not inside the block it introduces. Using the full inclusive range here would
      // make every such block look "protected" and defeat elision for exactly the common case this
      // exists to handle.
      const innerRange: [number, number] = [bodyRange[0] + 1, bodyRange[1] - 1];
      if (protectedLines.some((line0) => containsLine(innerRange, line0))) return; // keep + descend further

      for (let i = innerRange[0]; i <= innerRange[1]; i++) elidable.add(i);
      path.skip(); // the whole block is already elided; no need to look inside it
    },
  });

  return elidable;
}

function importedLocalNames(decl: ImportDeclaration): string[] {
  return decl.specifiers.map((spec) => spec.local.name);
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
  const excludedLines = new Set<number>();
  const includeRange = (range: [number, number] | null) => {
    if (!range) return;
    for (let i = range[0]; i <= range[1]; i++) includedLines.add(i);
  };

  for (const directive of ast.program.directives) includeRange(lineRange(directive));

  const processedStatements = new Set<Statement>();

  // One candidate per file, not per match — a single fragment covering every anchor-shaped
  // statement plus the schemas it references, merged and deduped. Keeps this a single call per file
  // rather than one per match; the server already handles "multiple schemas in one fragment" naturally.
  for (const matchLine of matchLineIndexes) {
    const enclosing = findEnclosingStatement(body, matchLine);
    if (!enclosing) continue;

    if (!processedStatements.has(enclosing)) {
      processedStatements.add(enclosing);
      const stmtRange = lineRange(enclosing);
      if (stmtRange) {
        includeRange(stmtRange);
        for (const line0 of findElidableInnerLines(ast, stmtRange, matchLineIndexes)) excludedLines.add(line0);
      }
    }

    const line = lines[matchLine];
    const referencedName = line.match(INPUT_SCHEMA_ARG_RE)?.[1] ?? line.match(PARSE_RECEIVER_RE)?.[1];
    if (!referencedName) continue;

    const declStmt = findDeclarationStatement(body, referencedName);
    if (declStmt) includeRange(lineRange(declStmt)); // the schema itself -- never elided internally
  }

  if (includedLines.size === 0) return none;

  // Only the imports actually referenced by what's being sent -- not every import in the file. A
  // simple whole-word scan of the (not yet import-inclusive) fragment text, not real scope resolution:
  // this can only ever over-include (a name that merely appears in a comment or string still pulls its
  // import in), never under-include a genuinely used binding, which is the safe direction to err in.
  const coreIndexes = [...includedLines].filter((i) => !excludedLines.has(i));
  const coreText = coreIndexes.map((i) => lines[i]).join("\n");
  for (const stmt of body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const referenced = importedLocalNames(stmt).some((name) => new RegExp(`\\b${name}\\b`).test(coreText));
    if (referenced) includeRange(lineRange(stmt));
  }

  const sortedIndexes = [...includedLines].filter((i) => !excludedLines.has(i)).sort((a, b) => a - b);
  const fragment = sortedIndexes.map((i) => lines[i]).join("\n");
  const fragmentLineToSourceLine = sortedIndexes.map((i) => i + 1);
  const relPath = relative(root, filePath);

  const redacted = redactSecrets(fragment);
  if (Buffer.byteLength(redacted, "utf8") > MAX_FRAGMENT_BYTES) {
    return { candidates: [], oversizedFiles: [relPath] };
  }

  return { candidates: [{ id: relPath, codeFragment: redacted, fragmentLineToSourceLine }], oversizedFiles: [] };
}

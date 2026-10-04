import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser, Language, type Tree } from "web-tree-sitter";

// This file compiles to dist/engine/pythonAstUtils.js; the grammar is copied to dist/grammars/ by
// scripts/copyGrammars.js as part of `npm run build` (see grammars/README.md for why it's vendored
// rather than an npm dependency).
const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR_PATH = join(HERE, "..", "grammars", "tree-sitter-python.wasm");

// Initialized at most once per process, reused across every Python file in a scan -- mirrors
// tsProject.ts's lazy-memoized pattern for the same reason (real setup cost, no benefit to repeating
// it per file). Parser.init()/Language.load() are both async; parser.parse() itself is synchronous
// once a Parser is set up, and this module's scan-time usage is sequential (not concurrent), so one
// shared Parser instance is safe to reuse.
let parserPromise: Promise<Parser | null> | null = null;

function initParser(): Promise<Parser | null> {
  if (!parserPromise) {
    parserPromise = (async () => {
      try {
        await Parser.init();
        const language = await Language.load(GRAMMAR_PATH);
        const parser = new Parser();
        parser.setLanguage(language);
        return parser;
      } catch {
        // Honest null, matching astUtils.ts's parseSource -- a missing/incompatible grammar build
        // degrades this file's detection to nothing rather than crashing the whole scan.
        return null;
      }
    })();
  }
  return parserPromise;
}

export async function parsePythonSource(source: string): Promise<Tree | null> {
  const parser = await initParser();
  if (!parser) return null;
  try {
    return parser.parse(source);
  } catch {
    return null;
  }
}

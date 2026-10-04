import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Plain, dependency-free Node (no tsx/ts-node) since this runs as part of `build`, which must work
// for every consumer's `npm install` via the `prepare` lifecycle script, not just in this dev repo.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "src", "grammars");
const DEST = join(ROOT, "dist", "grammars");

mkdirSync(DEST, { recursive: true });
// Ships LICENSE alongside the binary it covers; excludes README.md (dev-process documentation, not
// needed at runtime).
cpSync(SRC, DEST, { recursive: true, filter: (path) => !path.endsWith(".md") });

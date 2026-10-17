import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Read from package.json rather than hardcoded, so no reported version can drift from the published
// one. Works from both src/ (tsx, tests) and dist/: this file sits one level below package.json either way.
export function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return (JSON.parse(readFileSync(join(here, "../package.json"), "utf8")) as { version: string }).version;
}

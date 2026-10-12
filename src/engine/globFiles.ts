import { glob } from "tinyglobby";
import type { RootBoundary } from "./rootBoundary.js";

export interface GlobFilesOptions {
  cwd: string;
  absolute?: boolean;
  ignore?: string[];
  dot?: boolean;
  /** When given, symlinks resolving outside the scanned root are neither walked nor returned. */
  boundary?: RootBoundary;
}

// expandDirectories: false keeps tinyglobby's matching identical to the fast-glob behavior this
// replaced (a pattern matches only what it names, never everything under a matched directory).
// tinyglobby/picomatch compiles braces to regex alternation rather than expanding them, so it has no
// equivalent of the `braces` package's stack-overflow/memory exposure (GHSA-vfj7-8cjw-p6xm); patterns
// that come from a scanned repo are still bounded first, in workspacePatterns.ts.
// Sorted so scan order (and therefore the order of findings in reports) doesn't depend on filesystem
// traversal order, which neither fast-glob nor tinyglobby guarantees.
export async function globFiles(patterns: string | string[], options: GlobFilesOptions): Promise<string[]> {
  const { boundary, ...globOptions } = options;
  return (await glob(patterns, { expandDirectories: false, ...globOptions, ...(boundary ? { fs: boundary.globFs() } : {}) })).sort();
}

import { realpathSync } from "node:fs";
import { dirname, sep } from "node:path";
import ts from "typescript";
import type { RootBoundary } from "./rootBoundary.js";

export interface TsProjectHandle {
  getObjectTypeMembersAt(filePath: string, line: number, column: number): string[] | null;
}

// Purely defensive, not a tuned threshold: the largest repo actually measured (dub, 4211 files) took
// ~2.5s/~800MB to build. This is ~5x that, so a project this large skips type resolution entirely
// rather than attempting an untested, unbounded-cost ts.createProgram call.
const MAX_PROGRAM_FILES = 20_000;

const NULL_HANDLE: TsProjectHandle = {
  getObjectTypeMembersAt: () => null,
};

function findNodeAtPosition(root: ts.Node, position: number): ts.Node | undefined {
  if (position < root.getFullStart() || position >= root.getEnd()) {
    return root.getStart() <= position && position < root.getEnd() ? root : undefined;
  }

  let found: ts.Node | undefined;
  root.forEachChild((child) => {
    if (found) return;
    if (position >= child.getFullStart() && position < child.getEnd()) {
      found = findNodeAtPosition(child, position) ?? child;
    }
  });
  return found ?? (root.getStart() <= position && position < root.getEnd() ? root : undefined);
}

const NODE_MODULES_SEGMENT = `${sep}node_modules${sep}`;

/**
 * TypeScript follows imports on its own, so the list of files handed to createProgram is not the whole
 * set it reads: an import crossing a symlink that leaves the scanned root would otherwise pull that
 * file's type members into findings. The host refuses any file whose REAL path is outside the root,
 * except TypeScript's own lib files and package type declarations (a real path under node_modules --
 * package managers legitimately keep those outside the repo, e.g. pnpm's store).
 */
function restrictHostToBoundary(host: ts.CompilerHost, options: ts.CompilerOptions, boundary: RootBoundary): void {
  const libDir = dirname(ts.getDefaultLibFilePath(options));
  const verdicts = new Map<string, boolean>();

  const allowed = (path: string): boolean => {
    const cached = verdicts.get(path);
    if (cached !== undefined) return cached;
    let verdict: boolean;
    try {
      const real = realpathSync(path);
      verdict = boundary.isInsideRealPath(real) || real.startsWith(libDir + sep) || real.includes(NODE_MODULES_SEGMENT);
    } catch {
      verdict = true; // doesn't exist (or can't be resolved): the original host answers "no such file"
    }
    verdicts.set(path, verdict);
    return verdict;
  };

  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (path) => allowed(path) && fileExists.call(host, path);
  host.readFile = (path) => (allowed(path) ? readFile.call(host, path) : undefined);
  host.getSourceFile = (path, ...rest) => (allowed(path) ? getSourceFile.call(host, path, ...rest) : undefined);
}

export function buildTsProject(files: string[], boundary?: RootBoundary): TsProjectHandle {
  if (files.length === 0 || files.length > MAX_PROGRAM_FILES) return NULL_HANDLE;

  let program: ts.Program;
  let checker: ts.TypeChecker;
  try {
    const options: ts.CompilerOptions = {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      skipLibCheck: true,
    };
    const host = ts.createCompilerHost(options);
    if (boundary) restrictHostToBoundary(host, options, boundary);
    program = ts.createProgram(files, options, host);
    checker = program.getTypeChecker();
  } catch {
    return NULL_HANDLE;
  }

  return {
    getObjectTypeMembersAt(filePath, line, column) {
      try {
        const sourceFile = program.getSourceFile(filePath);
        if (!sourceFile) return null;

        const position = ts.getPositionOfLineAndCharacter(sourceFile, line - 1, column);
        const node = findNodeAtPosition(sourceFile, position);
        if (!node) return null;

        const type = checker.getTypeAtLocation(node);
        // Primitives (number/string/boolean) have non-empty "properties" too — their boxed prototype
        // methods (toFixed, toUpperCase, ...) — which getPropertiesOfType happily returns. Only a real
        // object type (an interface, a type literal, a class) is a genuine request-body shape.
        if (!(type.flags & ts.TypeFlags.Object)) return null;

        const properties = checker.getPropertiesOfType(type);
        if (properties.length === 0) return null;

        return properties.map((p) => p.getName());
      } catch {
        // Never let a target project's own type errors, an out-of-range position, or any other
        // resolution failure break the scan — an honest "couldn't resolve this" is a null, not a throw.
        return null;
      }
    },
  };
}

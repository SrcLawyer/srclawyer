import ts from "typescript";

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

export function buildTsProject(files: string[]): TsProjectHandle {
  if (files.length === 0 || files.length > MAX_PROGRAM_FILES) return NULL_HANDLE;

  let program: ts.Program;
  let checker: ts.TypeChecker;
  try {
    program = ts.createProgram(files, {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      skipLibCheck: true,
    });
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

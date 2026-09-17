import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTsProject } from "../src/engine/tsProject.js";

describe("buildTsProject", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("extracts members of an interface defined in the same file", () => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-ts-"));
    const file = join(dir, "a.ts");
    // Named SignupBody, not Body — "Body" collides with lib.dom.d.ts's global Fetch API mixin and
    // triggers interface-merging in a script (non-module) file, which isn't what this test is about.
    writeFileSync(file, `interface SignupBody { email: string; ssn: string; }\nconst body: SignupBody = {} as SignupBody;\n`);

    const project = buildTsProject([file]);
    const members = project.getObjectTypeMembersAt(file, 2, 6); // position of `body`

    expect(members?.slice().sort()).toEqual(["email", "ssn"]);
  });

  it("extracts members of an interface defined in a different, imported file (cross-file resolution for free)", () => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-ts-"));
    writeFileSync(join(dir, "types.ts"), `export interface SignupBody { email: string; ssn: string; }\n`);
    const file = join(dir, "a.ts");
    writeFileSync(file, `import type { SignupBody } from "./types.js";\nconst body: SignupBody = {} as SignupBody;\n`);

    const project = buildTsProject([file, join(dir, "types.ts")]);
    const members = project.getObjectTypeMembersAt(file, 2, 6);

    expect(members?.slice().sort()).toEqual(["email", "ssn"]);
  });

  it("still returns results for the good file when another file in the project has genuine type errors, never throws", () => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-ts-"));
    const good = join(dir, "a.ts");
    const bad = join(dir, "broken.ts");
    writeFileSync(good, `interface SignupBody { email: string; }\nconst body: SignupBody = {} as SignupBody;\n`);
    writeFileSync(bad, `const x: number = "not a number";\nfunction totallyBroken( {\n`);

    expect(() => buildTsProject([good, bad])).not.toThrow();
    const project = buildTsProject([good, bad]);
    expect(project.getObjectTypeMembersAt(good, 2, 6)).toEqual(["email"]);
  });

  it("returns null for a position that doesn't resolve to an object type", () => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-ts-"));
    const file = join(dir, "a.ts");
    writeFileSync(file, `const count: number = 5;\n`);

    const project = buildTsProject([file]);
    expect(project.getObjectTypeMembersAt(file, 1, 6)).toBeNull();
  });

  it("returns null (never throws) when queried against a file not in the program", () => {
    dir = mkdtempSync(join(tmpdir(), "srclawyer-ts-"));
    const file = join(dir, "a.ts");
    writeFileSync(file, `interface SignupBody { email: string; }\nconst body: SignupBody = {} as SignupBody;\n`);

    const project = buildTsProject([file]);
    expect(project.getObjectTypeMembersAt(join(dir, "missing.ts"), 2, 6)).toBeNull();
  });

  it("returns a null-safe handle immediately for an empty file list, without calling ts.createProgram", () => {
    const project = buildTsProject([]);
    expect(project.getObjectTypeMembersAt("/nonexistent.ts", 1, 0)).toBeNull();
  });
});

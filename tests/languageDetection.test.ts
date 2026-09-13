import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectUnsupportedStack } from "../src/engine/languageDetection.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("detectUnsupportedStack", () => {
  it("returns null for a plain JS/TS codebase", async () => {
    const dir = tempDir("srclawyer-lang-js-");
    writeFileSync(join(dir, "server.js"), "const x = 1;\n");
    writeFileSync(join(dir, "app.ts"), "export const y = 2;\n");

    expect(await detectUnsupportedStack(dir)).toBeNull();
  });

  it("flags a Django project via manage.py", async () => {
    const dir = tempDir("srclawyer-lang-django-");
    writeFileSync(join(dir, "manage.py"), "#!/usr/bin/env python\n");
    writeFileSync(join(dir, "settings.py"), "DEBUG = True\n");

    const warning = await detectUnsupportedStack(dir);
    expect(warning).toContain("Django");
    expect(warning).toContain("incomplete");
  });

  it("flags a Rails project via Gemfile + app/controllers", async () => {
    const dir = tempDir("srclawyer-lang-rails-");
    writeFileSync(join(dir, "Gemfile"), 'source "https://rubygems.org"\n');
    mkdirSync(join(dir, "app", "controllers"), { recursive: true });
    writeFileSync(join(dir, "app", "controllers", "users_controller.rb"), "class UsersController; end\n");

    const warning = await detectUnsupportedStack(dir);
    expect(warning).toContain("Rails");
  });

  it("flags a gRPC/protobuf project via .proto files", async () => {
    const dir = tempDir("srclawyer-lang-grpc-");
    writeFileSync(join(dir, "service.proto"), "syntax = \"proto3\";\n");

    const warning = await detectUnsupportedStack(dir);
    expect(warning).toContain("gRPC");
  });

  it("flags a codebase where Python files dominate over JS/TS", async () => {
    const dir = tempDir("srclawyer-lang-py-dominant-");
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(dir, `module_${i}.py`), "x = 1\n");
    }
    writeFileSync(join(dir, "tiny.js"), "// build helper\n");

    const warning = await detectUnsupportedStack(dir);
    expect(warning).toContain("Python");
  });

  it("does not flag a JS-majority codebase that has a couple of Python scripts", async () => {
    const dir = tempDir("srclawyer-lang-js-majority-");
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(dir, `module_${i}.js`), "// js\n");
    }
    writeFileSync(join(dir, "deploy.py"), "# helper script\n");

    expect(await detectUnsupportedStack(dir)).toBeNull();
  });
});

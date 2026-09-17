import { describe, expect, it } from "vitest";
import { parseSource } from "../src/engine/astUtils.js";
import { runTypedRequestBodyRules } from "../src/rules/typedRequestBodyRules.js";

describe("runTypedRequestBodyRules", () => {
  it("queries the type checker for a typed, non-destructured request body binding", () => {
    const source = `export async function POST(request) {\n  const body: SignupRequest = await request.json();\n}\n`;
    const ast = parseSource(source, "route.ts")!;

    const findings = runTypedRequestBodyRules(ast, "/root/route.ts", source, "/root", () => ({
      getObjectTypeMembersAt: () => ["email", "ssn"],
    }));

    const categories = findings.map((f) => f.dataCategories[0]).sort();
    expect(categories).toEqual(["email", "government_id"]);
    expect(findings.every((f) => f.requiresReview)).toBe(true);
    expect(findings.every((f) => f.source === "type-rule")).toBe(true);
  });

  it("also handles the req.body member-expression form, not just await request.json()", () => {
    const source = `app.post("/x", (req, res) => {\n  const body: SignupRequest = req.body;\n});\n`;
    const ast = parseSource(source, "server.ts")!;

    const findings = runTypedRequestBodyRules(ast, "/root/server.ts", source, "/root", () => ({
      getObjectTypeMembersAt: () => ["email"],
    }));

    expect(findings).toHaveLength(1);
    expect(findings[0].dataCategories).toEqual(["email"]);
  });

  it("does not double-emit for a destructured, typed binding (already handled by frameworkRules.ts)", () => {
    const source = `const { email }: SignupRequest = await request.json();\n`;
    const ast = parseSource(source, "route.ts")!;

    const findings = runTypedRequestBodyRules(ast, "/root/route.ts", source, "/root", () => ({
      getObjectTypeMembersAt: () => ["email"],
    }));

    expect(findings).toHaveLength(0);
  });

  it("stays silent when the binding has no type annotation at all", () => {
    const source = `const body = await request.json();\n`;
    const ast = parseSource(source, "route.ts")!;

    const findings = runTypedRequestBodyRules(ast, "/root/route.ts", source, "/root", () => ({
      getObjectTypeMembersAt: () => ["email"],
    }));

    expect(findings).toHaveLength(0);
  });

  it("stays silent when getTsProject() returns null (Program unavailable)", () => {
    const source = `const body: SignupRequest = await request.json();\n`;
    const ast = parseSource(source, "route.ts")!;

    const findings = runTypedRequestBodyRules(ast, "/root/route.ts", source, "/root", () => null);

    expect(findings).toHaveLength(0);
  });

  it("stays silent when the type checker can't resolve any members at this position", () => {
    const source = `const body: SignupRequest = await request.json();\n`;
    const ast = parseSource(source, "route.ts")!;

    const findings = runTypedRequestBodyRules(ast, "/root/route.ts", source, "/root", () => ({
      getObjectTypeMembersAt: () => null,
    }));

    expect(findings).toHaveLength(0);
  });

  it("marks every finding runtimeVerified: false and leaves confidence/requiresReview as the safe provisional default", () => {
    // A type annotation is compile-time-only and can lie relative to runtime reality — the scoring
    // service (not this module) is what turns runtimeVerified: false into a hard "always review" via
    // its own gate. This module's job stops at recording the factor correctly.
    const source = `const body: SignupRequest = await request.json();\n`;
    const ast = parseSource(source, "route.ts")!;

    const findings = runTypedRequestBodyRules(ast, "/root/route.ts", source, "/root", () => ({
      getObjectTypeMembersAt: () => ["email", "phone", "notes"],
    }));

    expect(findings.every((f) => f.confidenceFactors?.runtimeVerified === false)).toBe(true);
    expect(findings.every((f) => f.confidence === "low")).toBe(true);
    expect(findings.every((f) => f.requiresReview === true)).toBe(true);

    const notes = findings.find((f) => f.id.endsWith(":notes"))!;
    expect(notes.confidenceFactors?.siblingConfidentCount).toBe(2); // email + phone
  });

  it("does not flag a typed binding unrelated to a request entry point", () => {
    const source = `const config: AppConfig = loadConfig();\n`;
    const ast = parseSource(source, "config.ts")!;

    const findings = runTypedRequestBodyRules(ast, "/root/config.ts", source, "/root", () => ({
      getObjectTypeMembersAt: () => ["apiUrl"],
    }));

    expect(findings).toHaveLength(0);
  });
});

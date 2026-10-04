import { describe, expect, it } from "vitest";
import { parseSource } from "../src/engine/astUtils.js";
import { runFrameworkRules } from "../src/rules/frameworkRules.js";

/**
 * confidence/requiresReview are now provisional here by design — the actual scoring formula/
 * thresholds live server-side (protected-logic service) and patch these values later, in
 * resolveProtectedLogic.ts. This module's own job is just: classify the field name locally (still
 * local, unprotected) and compute the FACTORS a later scoring call will need — so these tests assert
 * dataCategories + confidenceFactors, not a final confidence verdict.
 */
describe("runFrameworkRules", () => {
  it("classifies destructured req.body fields locally, with confidence left as the safe provisional default", () => {
    const source = `app.post("/signup", (req, res) => {\n  const { email, phone } = req.body;\n});\n`;
    const ast = parseSource(source, "server.js")!;
    const findings = runFrameworkRules(ast, "/root/server.js", source, "/root");

    const categories = findings.map((f) => f.dataCategories[0]).sort();
    expect(categories).toEqual(["email", "phone"]);
    expect(findings.every((f) => f.confidence === "low")).toBe(true);
    expect(findings.every((f) => f.requiresReview === true)).toBe(true);
  });

  it("classifies a single req.body.field member access", () => {
    const source = `const cardNumber = req.body.cardNumber;\n`;
    const ast = parseSource(source, "checkout.js")!;
    const findings = runFrameworkRules(ast, "/root/checkout.js", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].dataCategories).toEqual(["payment_info"]);
    expect(findings[0].confidenceFactors?.lexiconCategory).toBe("payment_info");
  });

  it("captures ambiguousName in confidenceFactors for generically-named fields, without guessing a category", () => {
    const source = `const { data } = req.body;\n`;
    const ast = parseSource(source, "generic.js")!;
    const findings = runFrameworkRules(ast, "/root/generic.js", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].requiresReview).toBe(true);
    expect(findings[0].confidenceFactors).toEqual({
      lexiconCategory: null,
      ambiguousName: true,
      runtimeVerified: true,
      siblingConfidentCount: 0,
    });
  });

  it("classifies fields destructured from await req.json() (Next.js app router)", () => {
    const source = `export async function POST(req) {\n  const { ssn } = await req.json();\n}\n`;
    const ast = parseSource(source, "route.ts")!;
    const findings = runFrameworkRules(ast, "/root/route.ts", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].dataCategories).toEqual(["government_id"]);
  });

  it("computes siblingConfidentCount from the other fields in the same destructured object", () => {
    const source = `const { email, phone, notes } = req.body;\n`;
    const ast = parseSource(source, "server.js")!;
    const findings = runFrameworkRules(ast, "/root/server.js", source, "/root");

    const notes = findings.find((f) => f.id.endsWith(":notes"))!;
    // email + phone are the two OTHER confidently-classified siblings; notes itself is unclassified.
    expect(notes.confidenceFactors?.siblingConfidentCount).toBe(2);
    expect(notes.confidenceFactors?.lexiconCategory).toBeNull();

    const email = findings.find((f) => f.id.endsWith(":email"))!;
    expect(email.confidenceFactors?.siblingConfidentCount).toBe(1); // only phone
  });

  it("marks runtimeVerified true for a value observed directly from req.body (never inferred)", () => {
    const source = `const { email } = req.body;\n`;
    const ast = parseSource(source, "server.js")!;
    const findings = runFrameworkRules(ast, "/root/server.js", source, "/root");

    expect(findings[0].confidenceFactors?.runtimeVerified).toBe(true);
  });

  describe("same-function alias tracking", () => {
    it("detects body.email after const body = req.body", () => {
      const source = `function h(req) {\n  const body = req.body;\n  const email = body.email;\n}\n`;
      const ast = parseSource(source, "server.js")!;
      const findings = runFrameworkRules(ast, "/root/server.js", source, "/root");

      expect(findings).toHaveLength(1);
      expect(findings[0].dataCategories).toEqual(["email"]);
    });

    it("detects body['email'] (bracket/subscript access) after const body = req.body, not just dot access", () => {
      const source = `function h(req) {\n  const body = req.body;\n  const email = body['email'];\n}\n`;
      const ast = parseSource(source, "server.js")!;
      const findings = runFrameworkRules(ast, "/root/server.js", source, "/root");

      expect(findings).toHaveLength(1);
      expect(findings[0].dataCategories).toEqual(["email"]);
    });

    it("detects const { email } = body (destructuring an alias), not just req.body directly", () => {
      const source = `function h(req) {\n  const body = req.body;\n  const { email, phone } = body;\n}\n`;
      const ast = parseSource(source, "server.js")!;
      const findings = runFrameworkRules(ast, "/root/server.js", source, "/root");

      const categories = findings.map((f) => f.dataCategories[0]).sort();
      expect(categories).toEqual(["email", "phone"]);
    });

    it("tracks aliases of req.query / req.params the same way, not just req.body", () => {
      const source = [
        "function h(req) {",
        "  const q = req.query;",
        "  const a = q.email;",
        "  const p = req.params;",
        "  const b = p['phone'];",
        "}",
      ].join("\n") + "\n";
      const ast = parseSource(source, "server.js")!;
      const findings = runFrameworkRules(ast, "/root/server.js", source, "/root");

      const categories = findings.map((f) => f.dataCategories[0]).sort();
      expect(categories).toEqual(["email", "phone"]);
    });

    it("tracks an alias of await req.json(), not just a direct destructure", () => {
      const source = `export async function POST(req) {\n  const data = await req.json();\n  const email = data.email;\n}\n`;
      const ast = parseSource(source, "route.ts")!;
      const findings = runFrameworkRules(ast, "/root/route.ts", source, "/root");

      expect(findings).toHaveLength(1);
      expect(findings[0].dataCategories).toEqual(["email"]);
    });

    it("does not leak an alias across functions: a same-named variable in another function that was never assigned from req is not flagged", () => {
      const source = [
        "function handlerA(req) {",
        "  const body = req.body;",
        "  const email = body.email;",
        "}",
        "function handlerB() {",
        "  const body = loadConfig();",
        "  const debug = body.debug;",
        "}",
      ].join("\n") + "\n";
      const ast = parseSource(source, "server.js")!;
      const findings = runFrameworkRules(ast, "/root/server.js", source, "/root");

      expect(findings).toHaveLength(1);
      expect(findings[0].dataCategories).toEqual(["email"]);
      expect(findings.some((f) => f.id.endsWith(":debug"))).toBe(false);
    });

    it("does not flag a plain object alias that was never assigned from a request accessor", () => {
      const source = `function h() {\n  const body = loadConfig();\n  const debug = body.debug;\n}\n`;
      const ast = parseSource(source, "server.js")!;
      const findings = runFrameworkRules(ast, "/root/server.js", source, "/root");

      expect(findings).toHaveLength(0);
    });
  });
});

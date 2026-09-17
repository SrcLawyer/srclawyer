import { describe, expect, it } from "vitest";
import { parseSource } from "../src/engine/astUtils.js";
import { runSdkRules } from "../src/rules/sdkRules.js";

describe("runSdkRules", () => {
  it("detects a Stripe import and reports the mapped data categories", () => {
    const source = `import Stripe from "stripe";\nconst stripe = new Stripe("sk_test_x");\n`;
    const ast = parseSource(source, "server.ts")!;
    const findings = runSdkRules(ast, "/root/server.ts", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].processor).toBe("Stripe");
    expect(findings[0].dataCategories).toContain("payment_info");
    expect(findings[0].confidence).toBe("high");
    expect(findings[0].evidence).not.toContain("sk_test_x");
  });

  it("detects a require() of a known SDK", () => {
    const source = `const twilio = require("twilio");\n`;
    const ast = parseSource(source, "notify.js")!;
    const findings = runSdkRules(ast, "/root/notify.js", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].processor).toBe("Twilio");
  });

  it("does not flag unrelated imports", () => {
    const source = `import express from "express";\n`;
    const ast = parseSource(source, "app.js")!;
    const findings = runSdkRules(ast, "/root/app.js", source, "/root");

    expect(findings).toHaveLength(0);
  });
});

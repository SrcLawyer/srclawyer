import { describe, expect, it } from "vitest";
import { runHtmlInputRules, extractInlineScripts } from "../src/rules/htmlRules.js";

describe("runHtmlInputRules", () => {
  it("classifies a password input as authentication_credentials regardless of its id", () => {
    const html = `<input type="password" id="tx-passphrase" placeholder="shared secret">`;
    const findings = runHtmlInputRules(html, "/root/index.html", "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].dataCategories).toEqual(["authentication_credentials"]);
    expect(findings[0].confidence).toBe("high");
    expect(findings[0].requiresReview).toBe(false);
  });

  it("classifies email and tel inputs natively", () => {
    const html = `<input type="email" id="contact"><input type="tel" name="mobile">`;
    const findings = runHtmlInputRules(html, "/root/index.html", "/root");

    const categories = findings.flatMap((f) => f.dataCategories);
    expect(categories).toContain("email");
    expect(categories).toContain("phone");
  });

  it("classifies a plain text input by its id via the lexicon", () => {
    const html = `<input type="text" id="fullName">`;
    const findings = runHtmlInputRules(html, "/root/index.html", "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].dataCategories).toEqual(["name"]);
  });

  it("skips inputs with no identifying attribute and non-data control types", () => {
    const html = `<input type="submit" value="Go"><input type="text">`;
    const findings = runHtmlInputRules(html, "/root/index.html", "/root");

    expect(findings).toHaveLength(0);
  });
});

describe("extractInlineScripts", () => {
  it("extracts inline script bodies and pads them so line numbers still match the original file", () => {
    const html = ["<html>", "<body>", "<script>", 'getUserMedia({ audio: true });', "</script>", "</body>", "</html>"].join("\n");

    const scripts = extractInlineScripts(html);
    expect(scripts).toHaveLength(1);

    const lines = scripts[0].code.split("\n");
    expect(lines[3]).toBe("getUserMedia({ audio: true });");
  });

  it("skips external scripts with a src attribute", () => {
    const html = `<script src="fsk.js"></script><script>doStuff();</script>`;
    const scripts = extractInlineScripts(html);

    expect(scripts).toHaveLength(1);
    expect(scripts[0].code).toContain("doStuff();");
  });
});

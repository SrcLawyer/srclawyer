import { describe, expect, it } from "vitest";
import { runHtmlInputRules, extractInlineScripts, extractInlineScriptsBounded, findInputTags, MAX_INLINE_SCRIPT_PADDING_CHARS } from "../src/rules/htmlRules.js";

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

// The previous single-regex implementations, kept here only as a differential-test oracle: the linear
// scanners must find exactly what these did, on everything except the pathological inputs that made
// them quadratic.
const OLD_INPUT_TAG_RE = /<input\b[^>]*>/gi;
const OLD_SCRIPT_TAG_RE = /<script([^>]*)>([\s\S]*?)<\/script>/gi;

function oldInputTags(html: string): Array<{ index: number; tag: string }> {
  const re = new RegExp(OLD_INPUT_TAG_RE.source, OLD_INPUT_TAG_RE.flags);
  const out: Array<{ index: number; tag: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push({ index: m.index, tag: m[0] });
  return out;
}

function oldInlineScripts(html: string): string[] {
  const re = new RegExp(OLD_SCRIPT_TAG_RE.source, OLD_SCRIPT_TAG_RE.flags);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/\btype\s*=\s*["'](?!(?:text\/javascript|module|application\/javascript)["'])[^"']*["']/i.test(attrs)) continue;
    const contentStart = m.index + "<script".length + attrs.length + 1;
    out.push("\n".repeat(html.slice(0, contentStart).split("\n").length - 1) + m[2]);
  }
  return out;
}

describe("linear HTML scanners match the old regexes (differential fuzz)", () => {
  const TOKENS = ["<input", "<INPUT ", "<inputs", "<script", "<SCRIPT ", "</script>", "</SCRIPT>", ">", "<", " type=\"email\"", " src=\"x.js\"", " type=\"text/plain\"", "\n", "\n\n", " ", "x=1;", "a", "\"", "'"];

  function lcg(seed: number): () => number {
    let s = seed;
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  }

  it("agrees on 3,000 random token soups", () => {
    const rand = lcg(42);
    for (let i = 0; i < 3000; i++) {
      const html = Array.from({ length: 1 + Math.floor(rand() * 25) }, () => TOKENS[Math.floor(rand() * TOKENS.length)]).join("");
      expect(findInputTags(html), JSON.stringify(html)).toEqual(oldInputTags(html));
      expect(extractInlineScripts(html).map((s) => s.code), JSON.stringify(html)).toEqual(oldInlineScripts(html));
    }
  });
});

describe("hostile HTML stays linear", () => {
  it("200KB of unclosed <input tags and of unclosed <script tags each finish well under a second", () => {
    for (const unit of ["<input ", "<script>"]) {
      const html = unit.repeat(Math.floor(200_000 / unit.length));
      const started = Date.now();
      runHtmlInputRules(html, "/r/a.html", "/r");
      extractInlineScripts(html);
      expect(Date.now() - started).toBeLessThan(1000);
    }
  });

  it("many inline scripts on many lines stay within the padding budget, and the overflow is counted, not silent", () => {
    const html = Array.from({ length: 12_000 }, () => "<script>var a=1;</script>\n").join("");
    const { scripts, skippedCount } = extractInlineScriptsBounded(html);
    const totalChars = scripts.reduce((n, s) => n + s.code.length, 0);
    expect(skippedCount).toBeGreaterThan(0);
    expect(scripts.length + skippedCount).toBe(12_000);
    expect(totalChars).toBeLessThan(MAX_INLINE_SCRIPT_PADDING_CHARS + 12_000 * 20);
  });

  it("reports the correct line for an input deep in a large file (line index lookup)", () => {
    const html = "\n".repeat(5000) + '<input type="email">\n<input type="password">\n';
    const lines = runHtmlInputRules(html, "/r/a.html", "/r").map((f) => f.location.line);
    expect(lines).toEqual([5001, 5002]);
  });
});

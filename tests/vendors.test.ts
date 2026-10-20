import { describe, expect, it, vi, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { VENDORS, claimsOf, npmPatterns, type VendorEntry } from "../src/rules/vendors.js";
import { PROCESSOR_PROFILES } from "../src/rules/processorProfiles.js";
import { DATA_CATEGORY_LABELS } from "../src/policy/dataCategoryLabels.js";
import { runScan } from "../src/commands/scan.js";
import { runCheck } from "../src/commands/check.js";
import { scan } from "../src/engine/scanEngine.js";
import { computeInventory, DEFAULT_INVENTORY_PATH } from "../src/inventory/inventory.js";
import { runHtmlScriptHostRules } from "../src/rules/htmlRules.js";
import { generatePolicyMarkdown } from "../src/policy/generatePolicy.js";
import { initRepo, tempDir } from "./support/gitFixture.js";

// Domains each vendor's sources may come from: the vendor's own documentation or repositories.
const OFFICIAL_DOMAINS: Record<string, string[]> = {
  supabase: ["supabase.com"],
  clerk: ["clerk.com"],
  posthog: ["posthog.com"],
  "vercel-analytics": ["vercel.com"],
  sentry: ["docs.sentry.io"],
  resend: ["resend.com"],
  openai: ["developers.openai.com", "platform.openai.com"],
  anthropic: ["platform.claude.com", "docs.anthropic.com", "privacy.claude.com"],
  "stripe-js": ["docs.stripe.com"],
  intercom: ["developers.intercom.com", "github.com/intercom/"],
  segment: ["segment.com"],
};

describe("the vendor table", () => {
  it("has unique keys, ISO verification dates and only known data categories", () => {
    expect(new Set(VENDORS.map((v) => v.key)).size).toBe(VENDORS.length);
    for (const v of VENDORS) {
      expect(v.verifiedOn, v.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const c of v.categories) expect(DATA_CATEGORY_LABELS, `${v.key}:${c}`).toHaveProperty(c);
    }
  });

  it.each(VENDORS)("$key: every package, host, category and the disclosure text has a source quote", (v: VendorEntry) => {
    const sourced = new Set(v.sources.map((s) => s.about));
    for (const claim of claimsOf(v)) expect(sourced.has(claim), `${v.key}: no source for ${claim}`).toBe(true);
    // ...and no source supports something the entry does not claim.
    const claims = new Set(claimsOf(v));
    for (const s of v.sources) expect(claims.has(s.about), `${v.key}: source for unclaimed ${s.about}`).toBe(true);
  });

  it.each(VENDORS)("$key: sources are https pages on the vendor's own documentation", (v: VendorEntry) => {
    const allowed = OFFICIAL_DOMAINS[v.key];
    expect(allowed, `no allowed domains for ${v.key}`).toBeTruthy();
    for (const s of v.sources) {
      const url = new URL(s.url);
      expect(url.protocol, s.url).toBe("https:");
      expect(allowed!.some((d) => (url.host + url.pathname).startsWith(d) || url.host === d || url.host.endsWith(`.${d}`)), `${v.key}: ${s.url}`).toBe(true);
      expect(s.quote.length, `${v.key}: short quote`).toBeGreaterThanOrEqual(8);
    }
  });

  it("no package or module is claimed by two vendors, and none collides with an older entry", () => {
    const seen = new Map<string, string>();
    for (const v of VENDORS) for (const id of [...v.npm.map((n) => `npm:${n}`), ...v.pypi.map((m) => `pypi:${m}`)]) {
      expect(seen.has(id), `${id} claimed by ${seen.get(id)} and ${v.key}`).toBe(false);
      seen.set(id, v.key);
    }
    for (const older of ["stripe", "sendgrid", "twilio", "mixpanel", "auth0", "firebase", "cognito"]) {
      expect(VENDORS.some((v) => v.key === older)).toBe(false);
    }
  });

  it("registers every vendor as a processor profile with its categories and tags", () => {
    for (const v of VENDORS) {
      expect(PROCESSOR_PROFILES[v.key]).toMatchObject({ name: v.name, dataCategories: v.categories, tags: v.tags, disclosureNotes: v.disclosureNotes });
    }
  });

  it("leaves categories out where the documentation does not support them (AI providers)", () => {
    expect(VENDORS.find((v) => v.key === "openai")!.categories).toEqual([]);
    expect(VENDORS.find((v) => v.key === "anthropic")!.categories).toEqual([]);
    expect(VENDORS.find((v) => v.key === "openai")!.tags).toContain("ai");
  });

  it("a policy with a vendor that lists no categories still generates", () => {
    const result = { projects: [], findings: [], ambiguousCount: 0, filesScanned: 1, unsupportedStackWarning: null, workspaceWarning: null, skippedFiles: [], skippedFilesWarning: null, templateSyntaxNote: null, pendingZodCandidates: [], oversizedZodFiles: [], maxZodFragmentBytes: 0 };
    const finding = { id: "x", dataCategories: [], processor: "OpenAI", description: "OpenAI integration detected.", confidence: "high" as const, source: "sdk-rule" as const, location: { file: "a.js", line: 1, column: 0 }, evidence: "", requiresReview: false };
    expect(generatePolicyMarkdown({ ...result, findings: [finding] }, null)).toContain("**OpenAI**");
  });
});

describe("import matching", () => {
  const matches = (v: string, spec: string) => npmPatterns(VENDORS.find((x) => x.key === v)!).some((p) => p.test(spec));

  it("matches the package and its subpaths", () => {
    expect(matches("clerk", "@clerk/nextjs")).toBe(true);
    expect(matches("clerk", "@clerk/nextjs/server")).toBe(true);
    expect(matches("posthog", "posthog-js/react")).toBe(true);
    expect(matches("openai", "openai/resources")).toBe(true);
  });

  it("does not match look-alikes or packages the vendor documentation does not support", () => {
    expect(matches("openai", "openai-fetch")).toBe(false);
    expect(matches("openai", "openaix")).toBe(false);
    expect(matches("sentry", "@sentry/webpack-plugin")).toBe(false);
    expect(matches("sentry", "@sentry/cli")).toBe(false);
    expect(matches("posthog", "posthog-jsx")).toBe(false);
    expect(matches("resend", "resend-clone")).toBe(false);
    expect(matches("stripe-js", "@stripe/connect-js")).toBe(false);
    expect(matches("supabase", "@supabase/auth-ui-react")).toBe(false);
    expect(matches("clerk", "@clerk/themes")).toBe(false);
  });
});

describe("adding each vendor produces drift", () => {
  const dirs: string[] = [];
  const originalExitCode = process.exitCode;
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  // No request-field reads anywhere, so nothing needs the confidence service.
  const BASE = { ".gitignore": "generated/\n", "src/app.js": "export const ok = true;\n" };

  function noNetwork() {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      throw new Error(`unexpected network call to ${String(url)}`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  }

  async function driftFor(file: string, content: string) {
    const root = tempDir();
    dirs.push(root);
    initRepo(root, BASE);
    noNetwork();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runScan(root, { json: false, out: "BASELINE.md", llm: false, writeInventory: DEFAULT_INVENTORY_PATH });
    process.exitCode = originalExitCode;
    const { writeFiles, git } = await import("./support/gitFixture.js");
    writeFiles(root, { [file]: content });
    git(root, "add", "-A");
    log.mockClear();
    const code = await runCheck(root, { inventoryPath: DEFAULT_INVENTORY_PATH, format: "json" });
    return { code, report: JSON.parse(String(log.mock.calls.at(-1)![0])) };
  }

  for (const v of VENDORS) {
    it(`${v.name} (${v.key}): an import is drift (exit 1) naming the processor and its categories`, async () => {
      const pkg = v.npm[0];
      const { code, report } = pkg
        ? await driftFor("src/vendor.js", `import x from "${pkg}";\nexport default x;\n`)
        : await driftFor("src/vendor.html", `<script src="https://${v.scriptHosts[0]}/x.js"></script>\n`);
      expect(code).toBe(1);
      expect(report.result).toBe("drift");
      expect(report.diff.added.processors).toContain(v.name);
      for (const category of v.categories) expect(report.diff.added.categories).toContain(category);
    }, 30_000);
  }

  // The remaining forms are cheap, so they run through the scan engine directly.
  async function inventoryOf(files: Record<string, string>) {
    const root = tempDir();
    dirs.push(root);
    initRepo(root, { ...BASE, ...files });
    noNetwork();
    const result = await scan(root);
    return computeInventory(result.findings, { srclawyerVersion: "test", discovery: "glob" });
  }

  for (const v of VENDORS) {
    for (const pkg of v.npm) {
      it(`${v.key}: require("${pkg}") is detected`, async () => {
        const inv = await inventoryOf({ "src/v.js": `const x = require("${pkg}");\n` });
        expect(inv.processors).toContain(v.name);
      });
    }
    for (const mod of v.pypi) {
      it(`${v.key}: Python "import ${mod}" and "from ${mod} import x" are detected`, async () => {
        const a = await inventoryOf({ "svc/v.py": `import ${mod}\n` });
        expect(a.processors).toContain(v.name);
        const b = await inventoryOf({ "svc/w.py": `from ${mod} import something\n` });
        expect(b.processors).toContain(v.name);
      });
    }
  }
});

describe("HTML script hosts", () => {
  const find = (html: string) => runHtmlScriptHostRules(html, "/proj/page.html", "/proj");

  it("matches the documented script hosts, once per vendor per file", () => {
    const html = [
      '<script src="https://js.stripe.com/v3/"></script>',
      '<script async src="//js.stripe.com/v3/"></script>',
      '<script src="https://widget.intercom.io/widget/abc"></script>',
      '<script src="https://us-assets.i.posthog.com/static/array.js"></script>',
      '<script src="https://js.sentry-cdn.com/abc.min.js" crossorigin="anonymous"></script>',
      '<script src="https://cdn.segment.com/analytics.js/v1/KEY/analytics.min.js"></script>',
    ].join("\n");
    const found = find(html);
    expect(found.map((f) => f.processor).sort()).toEqual(["Intercom", "PostHog", "Segment", "Sentry", "Stripe"]);
    expect(found.every((f) => f.location.file === "page.html")).toBe(true);
    expect(found.find((f) => f.processor === "Stripe")!.location.line).toBe(1);
  });

  it("evidence is the host only, never the rest of the tag", () => {
    const [f] = find('<script src="https://js.sentry-cdn.com/SECRETISH.min.js"></script>');
    expect(f!.evidence).toBe('<script src="https://js.sentry-cdn.com/...">');
    expect(JSON.stringify(f)).not.toContain("SECRETISH");
  });

  it("does not match other hosts, look-alike hosts, relative paths or inline scripts", () => {
    expect(find('<script src="https://js.stripe.com.evil.example/v3/"></script>')).toEqual([]);
    expect(find('<script src="https://evil.example/js.stripe.com/v3"></script>')).toEqual([]);
    expect(find('<script src="/static/js.stripe.com.js"></script>')).toEqual([]);
    expect(find('<script>var u = "https://js.stripe.com/v3/";</script>')).toEqual([]);
    expect(find('<link href="https://js.stripe.com/v3/">')).toEqual([]);
  });

  it("an unterminated tag does not hang or throw", () => {
    expect(find("<script src=\"https://js.stripe.com/v3/\"")).toEqual([]);
    expect(find("<script ".repeat(5000))).toEqual([]);
  });
});

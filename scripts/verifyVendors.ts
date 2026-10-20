// Re-fetches every source page in src/rules/vendors.ts and checks that each quote is still on it.
// Network access required; run on demand (`npm run verify:vendors`), not part of the test suite.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { VENDORS, type VendorSource } from "../src/rules/vendors.js";
import { SERVICE_FEATURES, featureKey } from "../src/rules/serviceFeatures.js";

const execFileAsync = promisify(execFile);

function common(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Plain text of a fetched page, comparable across HTML and Markdown renderings. Real HTML tags are
 * stripped only when the response is an HTML document; in Markdown, text such as `<script src=...>` is
 * content and is kept.
 */
export function normalizePage(raw: string): string {
  const isHtml = /<(!doctype|html)\b/i.test(raw.slice(0, 2000));
  // Inline tags (syntax-highlighting spans, links, emphasis) disappear without leaving a space, so a code
  // sample split into spans reads as it does on screen; every other tag becomes a space.
  const body = isHtml
    ? raw
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<\/?(span|code|a|em|strong|b|i|mark|kbd)\b[^>]*>/gi, "")
        .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    : raw;
  return common(body);
}

export function normalizeQuote(quote: string): string {
  return common(quote);
}

export interface SourceCheck {
  vendor: string;
  about: string;
  url: string;
  quote: string;
  found: boolean;
  fetchError: string | null;
}

// curl, not fetch(): some documentation sites answer a bare fetch() with a client-rendered shell that has
// no page text in it, but serve the real page (often as Markdown) to the same request made by curl.
async function fetchPage(url: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "curl",
    ["-sL", "--fail", "--max-time", "40", "-A", "Mozilla/5.0 (srclawyer vendor verification)", "-H", "Accept: text/markdown, text/html", url],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  return stdout;
}

export async function verifyAll(): Promise<SourceCheck[]> {
  const pages = new Map<string, Promise<string>>();
  const all: Array<{ vendor: string; source: VendorSource }> = [
    ...VENDORS.flatMap((v) => v.sources.map((source) => ({ vendor: v.key, source }))),
    ...SERVICE_FEATURES.flatMap((f) => f.sources.map((source) => ({ vendor: `feature ${featureKey(f)}`, source }))),
  ];
  const results: SourceCheck[] = [];
  for (const { vendor, source } of all) {
    if (!pages.has(source.url)) pages.set(source.url, fetchPage(source.url));
    let found = false;
    let fetchError: string | null = null;
    try {
      const text = normalizePage(await pages.get(source.url)!);
      found = text.includes(normalizeQuote(source.quote));
    } catch (error) {
      fetchError = error instanceof Error ? error.message : String(error);
    }
    results.push({ vendor, about: source.about, url: source.url, quote: source.quote, found, fetchError });
  }
  return results;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const results = await verifyAll();
  const bad = results.filter((r) => !r.found);
  for (const r of bad) console.log(`MISSING  ${r.vendor}  ${r.about}\n         ${r.url}\n         "${r.quote}"${r.fetchError ? `\n         fetch error: ${r.fetchError}` : ""}`);
  console.log(`${results.length - bad.length}/${results.length} quotes found on their pages.`);
  process.exit(bad.length === 0 ? 0 : 1);
}

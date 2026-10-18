// Writes docs/vendor-sources.md from src/rules/vendors.ts so the table the owner reviews is the code's
// own data, not a copy. `npm run docs:vendors` (runs the live quote check first; needs network).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VENDORS, type VendorEntry } from "../src/rules/vendors.js";
import { DATA_CATEGORY_LABELS } from "../src/policy/dataCategoryLabels.js";
import { verifyAll } from "./verifyVendors.js";

const checks = await verifyAll();
const found = checks.filter((c) => c.found).length;
const verifiedOn = VENDORS[0]!.verifiedOn;

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
const code = (items: string[]) => (items.length > 0 ? items.map((i) => `\`${i}\``).join(", ") : "none");
const labelOf = (c: string) => `${(DATA_CATEGORY_LABELS as Record<string, string>)[c] ?? c} (\`${c}\`)`;

function sourceRows(v: VendorEntry): string[] {
  const grouped = new Map<string, { quote: string; url: string; about: string[] }>();
  for (const s of v.sources) {
    const key = `${s.url}\u0000${s.quote}`;
    const entry = grouped.get(key) ?? { quote: s.quote, url: s.url, about: [] };
    entry.about.push(s.about);
    grouped.set(key, entry);
  }
  return [...grouped.values()].map((g) => `| ${cell(g.about.map((a) => `\`${a}\``).join(", "))} | "${cell(g.quote)}" | [${new URL(g.url).host}](${g.url}) |`);
}

const lines: string[] = [
  "# Vendor sources (0.9.0)",
  "",
  `**For owner review before \`vendor-patch\` is merged.** Generated from [\`src/rules/vendors.ts\`](../src/rules/vendors.ts) by \`npm run docs:vendors\`; do not edit by hand.`,
  "",
  "Every package name, host, data category and disclosure sentence below is backed by a short quote from the vendor's own documentation. Anything the documentation did not support was **left out**, and is listed per vendor under \"Left out\". `npm run verify:vendors` re-fetches every page and checks that each quote is still on it.",
  "",
  `**Live check on ${verifiedOn}: ${found} of ${checks.length} quotes found on their pages.**` + (found === checks.length ? "" : " The missing ones are listed in the script's output."),
  "",
  "The disclosure sentence is what appears in a policy and in the review file's suggested wording, so please read those first. \"Tags\" decide which questions a new use raises (for example `ai` raises the AI-services question).",
  "",
  "| Vendor | Tags | npm packages | Python modules | Hosts | Data categories |",
  "|---|---|---|---|---|---|",
  ...VENDORS.map((v) => `| ${v.name} | ${code(v.tags)} | ${code(v.npm)} | ${code(v.pypi)} | ${code(v.hosts)} | ${v.categories.length > 0 ? v.categories.map(labelOf).join(", ") : "none"} |`),
  "",
  "Hosts are recorded as data. The only host that is matched against code is a **script host**, in `<script src=\"https://host/...\">` tags in HTML files (PostHog assets, Sentry loader, Stripe.js, Intercom, Segment). Vercel Analytics has no third-party host to match.",
  "",
];

for (const v of VENDORS) {
  lines.push(
    `## ${v.name}${v.key === "stripe-js" ? " (Stripe.js)" : ""}`,
    "",
    `**Disclosure text** (shown in policies and the review file):`,
    "",
    `> ${v.disclosureNotes}`,
    "",
    `Tags: ${code(v.tags)} · npm: ${code(v.npm)} · Python: ${code(v.pypi)} · hosts: ${code(v.hosts)} · script hosts: ${code(v.scriptHosts)} · categories: ${v.categories.length > 0 ? v.categories.map(labelOf).join(", ") : "none"} · checked ${v.verifiedOn}`,
    "",
    "| Supports | Quote | Page |",
    "|---|---|---|",
    ...sourceRows(v),
    "",
    "**Left out** (no official page supports it):",
    "",
    ...v.omitted.map((o) => `- ${o}`),
    ""
  );
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "vendor-sources.md");
writeFileSync(out, lines.join("\n"));
console.log(`Wrote ${out} (${found}/${checks.length} quotes verified).`);

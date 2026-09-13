import { existsSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";

const IGNORE = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", "**/vendor/**"];

const SUPPORTED_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "html", "htm"];

const UNSUPPORTED_LANGUAGES: Array<{ label: string; extensions: string[] }> = [
  { label: "Python", extensions: ["py"] },
  { label: "Ruby", extensions: ["rb"] },
  { label: "Go", extensions: ["go"] },
  { label: "Java", extensions: ["java"] },
  { label: "PHP", extensions: ["php"] },
  { label: "C#", extensions: ["cs"] },
];

function bannerize(message: string): string {
  return `UNSUPPORTED CODEBASE — ${message} SrcLawyer only analyzes JavaScript/TypeScript and HTML today; the findings below (if any) are incomplete and MUST NOT be treated as a full compliance scan.`;
}

async function detectFrameworkSignature(root: string): Promise<string | null> {
  if (existsSync(join(root, "manage.py"))) {
    return bannerize("Django detected (manage.py found at the project root).");
  }

  const hasGemfile = existsSync(join(root, "Gemfile"));
  const hasRailsLayout = existsSync(join(root, "config", "routes.rb")) || existsSync(join(root, "app", "controllers"));
  if (hasGemfile && hasRailsLayout) {
    return bannerize("Rails detected (Gemfile + a Rails app/config layout found).");
  }

  const protoFiles = await fg("**/*.proto", { cwd: root, ignore: IGNORE, dot: false });
  if (protoFiles.length > 0) {
    return bannerize(`gRPC/Protocol Buffers detected (${protoFiles.length} .proto file(s) found) — protobuf schemas are not parsed.`);
  }

  return null;
}

async function detectDominantUnsupportedLanguage(root: string): Promise<string | null> {
  const [supportedFiles, ...unsupportedGroups] = await Promise.all([
    fg(SUPPORTED_EXTENSIONS.map((ext) => `**/*.${ext}`), { cwd: root, ignore: IGNORE, dot: false }),
    ...UNSUPPORTED_LANGUAGES.map((lang) => fg(lang.extensions.map((ext) => `**/*.${ext}`), { cwd: root, ignore: IGNORE, dot: false })),
  ]);

  const counts = UNSUPPORTED_LANGUAGES.map((lang, i) => ({ label: lang.label, count: unsupportedGroups[i].length }));
  const dominant = counts.filter((c) => c.count > 0).sort((a, b) => b.count - a.count)[0];

  if (!dominant || dominant.count <= supportedFiles.length) return null;

  return bannerize(`${dominant.label} detected as the primary language (${dominant.count} file(s), vs ${supportedFiles.length} supported JS/TS/HTML file(s)).`);
}

export async function detectUnsupportedStack(root: string): Promise<string | null> {
  const frameworkWarning = await detectFrameworkSignature(root);
  if (frameworkWarning) return frameworkWarning;

  return detectDominantUnsupportedLanguage(root);
}

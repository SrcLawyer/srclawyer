import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";

const IGNORE = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", "**/vendor/**", "**/venv/**", "**/.venv/**", "**/__pycache__/**"];

// Python moved from UNSUPPORTED_LANGUAGES to here once Flask detection shipped (Stage A) -- it's a
// supported *language* now, but only one framework within it is actually understood. A Python project
// using a different framework still needs an honest gap warning; see detectUnsupportedPythonFramework.
const SUPPORTED_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "html", "htm", "py"];

const UNSUPPORTED_LANGUAGES: Array<{ label: string; extensions: string[] }> = [
  { label: "Ruby", extensions: ["rb"] },
  { label: "Go", extensions: ["go"] },
  { label: "Java", extensions: ["java"] },
  { label: "PHP", extensions: ["php"] },
  { label: "C#", extensions: ["cs"] },
];

const FASTAPI_IMPORT = /\bfrom\s+fastapi\b|\bimport\s+fastapi\b/;

function bannerize(message: string): string {
  return `UNSUPPORTED CODEBASE — ${message} SrcLawyer only analyzes JavaScript/TypeScript, HTML, and Flask-based Python today; the findings below (if any) are incomplete and MUST NOT be treated as a full compliance scan.`;
}

async function detectFrameworkSignature(root: string): Promise<string | null> {
  if (existsSync(join(root, "manage.py"))) {
    return bannerize("Django detected (manage.py found at the project root) — Django support isn't built yet.");
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

/**
 * Presence-based, like detectFrameworkSignature's manage.py check -- not an absence heuristic ("we
 * found nothing so something must be wrong"), which can't tell a genuinely clean Flask file apart
 * from an unsupported framework. Scans actual file content (not just a marker file) since FastAPI,
 * unlike Django, has no single root-level marker file to check for instead.
 */
async function detectUnsupportedPythonFramework(root: string, pythonFiles: string[]): Promise<string | null> {
  for (const filePath of pythonFiles) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (FASTAPI_IMPORT.test(content)) {
      return bannerize("FastAPI detected (a `fastapi` import was found) — FastAPI support isn't built yet.");
    }
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

  return bannerize(`${dominant.label} detected as the primary language (${dominant.count} file(s), vs ${supportedFiles.length} supported file(s)).`);
}

export async function detectUnsupportedStack(root: string): Promise<string | null> {
  const frameworkWarning = await detectFrameworkSignature(root);
  if (frameworkWarning) return frameworkWarning;

  const pythonFiles = await fg("**/*.py", { cwd: root, absolute: true, ignore: IGNORE, dot: false });
  if (pythonFiles.length > 0) {
    const pythonFrameworkWarning = await detectUnsupportedPythonFramework(root, pythonFiles);
    if (pythonFrameworkWarning) return pythonFrameworkWarning;
  }

  return detectDominantUnsupportedLanguage(root);
}

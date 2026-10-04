import fg from "fast-glob";

const CODE_PATTERNS = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"];
const PYTHON_PATTERNS = ["**/*.py"];
const HTML_PATTERNS = ["**/*.html", "**/*.htm"];
const SCHEMA_PATTERNS = ["**/*.graphql", "**/*.gql", "**/openapi.yaml", "**/openapi.yml", "**/openapi.json", "**/swagger.yaml", "**/swagger.yml", "**/swagger.json"];
const MANIFEST_PATTERNS = ["**/package.json", "**/requirements.txt"];

const IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/*.min.js",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.d.ts",
];

// Separate from IGNORE: node_modules has no Python analogue, and excluding a venv/site-packages
// directory matters even more here, since it's a full copy of every installed pip package's own
// source -- the Python equivalent of node_modules, and just as irrelevant/misleading to scan.
const PYTHON_IGNORE = [
  ...IGNORE,
  "**/venv/**",
  "**/.venv/**",
  "**/__pycache__/**",
  "**/site-packages/**",
  "**/test_*.py",
  "**/*_test.py",
];

export interface DiscoveredFiles {
  codeFiles: string[];
  pythonFiles: string[];
  htmlFiles: string[];
  schemaFiles: string[];
  manifestFiles: string[];
}

export async function discoverFiles(root: string): Promise<DiscoveredFiles> {
  const [codeFiles, pythonFiles, htmlFiles, schemaFiles, manifestFiles] = await Promise.all([
    fg(CODE_PATTERNS, { cwd: root, absolute: true, ignore: IGNORE, dot: false }),
    fg(PYTHON_PATTERNS, { cwd: root, absolute: true, ignore: PYTHON_IGNORE, dot: false }),
    fg(HTML_PATTERNS, { cwd: root, absolute: true, ignore: IGNORE, dot: false }),
    fg(SCHEMA_PATTERNS, { cwd: root, absolute: true, ignore: ["**/node_modules/**"], dot: false }),
    fg(MANIFEST_PATTERNS, { cwd: root, absolute: true, ignore: ["**/node_modules/**"], dot: false }),
  ]);

  return { codeFiles, pythonFiles, htmlFiles, schemaFiles, manifestFiles };
}

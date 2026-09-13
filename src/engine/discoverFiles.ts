import fg from "fast-glob";

const CODE_PATTERNS = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"];
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

export interface DiscoveredFiles {
  codeFiles: string[];
  htmlFiles: string[];
  schemaFiles: string[];
  manifestFiles: string[];
}

export async function discoverFiles(root: string): Promise<DiscoveredFiles> {
  const [codeFiles, htmlFiles, schemaFiles, manifestFiles] = await Promise.all([
    fg(CODE_PATTERNS, { cwd: root, absolute: true, ignore: IGNORE, dot: false }),
    fg(HTML_PATTERNS, { cwd: root, absolute: true, ignore: IGNORE, dot: false }),
    fg(SCHEMA_PATTERNS, { cwd: root, absolute: true, ignore: ["**/node_modules/**"], dot: false }),
    fg(MANIFEST_PATTERNS, { cwd: root, absolute: true, ignore: ["**/node_modules/**"], dot: false }),
  ]);

  return { codeFiles, htmlFiles, schemaFiles, manifestFiles };
}

import { readFileSync } from "node:fs";
import { extname, relative } from "node:path";
import { discoverProjects } from "./discoverProjects.js";
import { discoverFiles } from "./discoverFiles.js";
import { detectUnsupportedStack } from "./languageDetection.js";
import { parseSource } from "./astUtils.js";
import { parsePythonSource } from "./pythonAstUtils.js";
import { runSdkRules } from "../rules/sdkRules.js";
import { runFrameworkRules } from "../rules/frameworkRules.js";
import { runWebApiRules } from "../rules/webApiRules.js";
import { runTypedRequestBodyRules } from "../rules/typedRequestBodyRules.js";
import { runPythonSdkRules } from "../rules/pythonSdkRules.js";
import { runPythonFrameworkRules } from "../rules/pythonFrameworkRules.js";
import { findZodCandidates, type ZodCandidate } from "../rules/zodPreFilter.js";
import { buildTsProject, type TsProjectHandle } from "./tsProject.js";
import { runHtmlInputRules, extractInlineScriptsBounded } from "../rules/htmlRules.js";
import {
  containsTemplateSyntax,
  isOversizedFile,
  summarizeSkippedFiles,
  summarizeTemplateScripts,
  type SkipReason,
  type SkippedFile,
} from "./scanLimits.js";
import { RootBoundary } from "./rootBoundary.js";
import { parseOpenApiSpec } from "../schemaParsers/openapi.js";
import { parseGraphQLSchema } from "../schemaParsers/graphql.js";
import type { Finding, ScanResult } from "./types.js";

const OPENAPI_NAME = /(openapi|swagger)\.(ya?ml|json)$/i;
const GRAPHQL_NAME = /\.(graphql|gql)$/i;

// Built at most once per project root, per scan, and only the first time a rule actually needs it
// (see typedRequestBodyRules.ts) — measured against the real dub/formbricks golden-corpus repos at
// ~2.5s/~800MB and ~2.2s/~650MB respectively for a full ts.Program build. Eager construction would tax
// every scan of a large project regardless of whether it ever hits the one pattern that needs it;
// memoized-lazy pays that cost at most once, only on the scan that actually earns it.
function makeLazyTsProject(files: string[], boundary: RootBoundary): () => TsProjectHandle | null {
  let handle: TsProjectHandle | null | undefined;
  return () => {
    if (handle === undefined) {
      try {
        handle = buildTsProject(files, boundary);
      } catch {
        handle = null;
      }
    }
    return handle;
  };
}

type RuleFailure = "parse-failed" | "analysis-failed" | null;

/**
 * Per-file containment: nothing a single file does (a parse failure, or an exception such as the
 * RangeError a very deep AST throws inside @babel/traverse) may abort the scan or discard the other
 * files' findings. Each rule group is isolated so one group failing keeps the others' findings for the
 * same file, and the failure comes back as a reason for the caller to record -- never swallowed.
 */
function runCodeRules(
  filePath: string,
  source: string,
  root: string,
  getTsProject: () => TsProjectHandle | null,
  zodCandidates: ZodCandidate[],
  oversizedZodFiles: string[]
): { findings: Finding[]; failure: RuleFailure } {
  let failure: RuleFailure = null;
  const findings: Finding[] = [];

  let ast: ReturnType<typeof parseSource> = null;
  try {
    ast = parseSource(source, filePath);
  } catch {
    ast = null;
  }

  try {
    const zodResult = findZodCandidates(source, filePath, root);
    zodCandidates.push(...zodResult.candidates);
    oversizedZodFiles.push(...zodResult.oversizedFiles);
  } catch {
    failure = "analysis-failed";
  }

  if (!ast) return { findings, failure: failure ?? "parse-failed" };

  const groups = [
    () => runSdkRules(ast, filePath, source, root),
    () => runFrameworkRules(ast, filePath, source, root),
    () => runWebApiRules(ast, filePath, source, root),
    () => runTypedRequestBodyRules(ast, filePath, source, root, getTsProject),
  ];
  for (const run of groups) {
    try {
      findings.push(...run());
    } catch {
      failure = "analysis-failed";
    }
  }
  return { findings, failure };
}

async function runPythonCodeRules(filePath: string, source: string, root: string): Promise<{ findings: Finding[]; failure: RuleFailure }> {
  let tree: Awaited<ReturnType<typeof parsePythonSource>> = null;
  try {
    tree = await parsePythonSource(source);
  } catch {
    tree = null;
  }
  if (!tree) return { findings: [], failure: "parse-failed" };

  const findings: Finding[] = [];
  let failure: RuleFailure = null;
  for (const run of [() => runPythonSdkRules(tree, filePath, source, root), () => runPythonFrameworkRules(tree, filePath, source, root)]) {
    try {
      findings.push(...run());
    } catch {
      failure = "analysis-failed";
    }
  }
  return { findings, failure };
}

/**
 * Pure, local, offline — no network access anywhere in this function or anything it calls. Zod
 * schemas and confidence scoring can no longer be fully resolved here (see pendingZodCandidates and
 * every Finding.confidenceFactors) — resolving those against the protected-logic service is a
 * separate, explicit step in src/cloud/resolveProtectedLogic.ts, called from commands/scan.ts, the
 * same way Layer 2's resolveAmbiguousFindings.ts is a separate step layered on top of this function
 * rather than folded into it. Anyone auditing "does this touch the network" can still answer that by
 * reading this file alone.
 */
export async function scan(root: string): Promise<ScanResult> {
  const boundary = new RootBoundary(root);
  const [{ projects, workspaceWarning }, unsupportedStackWarning] = await Promise.all([
    discoverProjects(root, boundary),
    detectUnsupportedStack(root, boundary),
  ]);
  const findings: Finding[] = [];
  const pendingZodCandidates: ZodCandidate[] = [];
  const oversizedZodFiles: string[] = [];
  const skippedFiles: SkippedFile[] = [];
  let filesScanned = 0;

  const recordSkip = (filePath: string, reason: SkipReason): void => {
    const file = relative(root, filePath);
    if (!skippedFiles.some((s) => s.file === file && s.reason === reason)) skippedFiles.push({ file, reason });
  };

  // The one gate every scanned file passes through before any content is read: real path inside the
  // scanned root (the glob layer already refuses to return out-of-root symlinks; this re-checks at read
  // time), then the shared size cap, then the read itself. A skipped file is recorded and surfaced as
  // a warning, never silently dropped. Returns null when the file must not be analyzed.
  const readScannable = (filePath: string): string | null => {
    if (!boundary.allowsPath(filePath)) return null; // recorded by the boundary as a blocked link
    if (isOversizedFile(filePath)) {
      recordSkip(filePath, "oversized");
      return null;
    }
    filesScanned += 1;
    try {
      return readFileSync(filePath, "utf8");
    } catch {
      recordSkip(filePath, "unreadable");
      return null;
    }
  };

  const projectRootList = [...new Set(projects.map((p) => p.root))];
  const fileSets = await Promise.all(projectRootList.map((projectRoot) => discoverFiles(projectRoot, boundary)));

  // The same real file can be reached by several paths (an in-root symlink, or a directory loop that
  // stays inside the root); scan it once, under its shortest path, so findings aren't duplicated.
  const seenRealPaths = new Map<string, string>();
  const claimsRealPath = (filePath: string): boolean => {
    const real = boundary.resolveInside(filePath);
    if (real === null) return true; // let readScannable record why it is being skipped
    const holder = seenRealPaths.get(real);
    if (holder === undefined) {
      seenRealPaths.set(real, filePath);
      return true;
    }
    return holder === filePath;
  };
  const shortestPathFirst = (paths: string[]): string[] => [...paths].sort((a, b) => a.length - b.length || a.localeCompare(b));
  // Claimed shortest-first, but returned in the original sorted order so report order is unchanged.
  const claimed = (paths: string[]): string[] => shortestPathFirst(paths).filter(claimsRealPath).sort();

  const allCodeFiles = new Set<string>();
  const allPythonFiles = new Set<string>();
  const allHtmlFiles = new Set<string>();
  const allSchemaFiles = new Set<string>();
  const rootForFile = new Map<string, string>();
  const tsProjectByRoot = new Map<string, () => TsProjectHandle | null>();
  fileSets.forEach((set, i) => {
    const projectRoot = projectRootList[i];
    tsProjectByRoot.set(projectRoot, makeLazyTsProject(set.codeFiles, boundary));
    claimed(set.codeFiles).forEach((f) => {
      allCodeFiles.add(f);
      rootForFile.set(f, projectRoot);
    });
    claimed(set.pythonFiles).forEach((f) => allPythonFiles.add(f));
    claimed(set.htmlFiles).forEach((f) => allHtmlFiles.add(f));
    claimed(set.schemaFiles).forEach((f) => allSchemaFiles.add(f));
  });
  // HTML files (and their inline <script> blocks) aren't part of any codeFiles list and never carry
  // a resolvable TS type, so they get a permanently-null thunk rather than a project association.
  const noTsProject = () => null;

  for (const filePath of allCodeFiles) {
    const source = readScannable(filePath);
    if (source === null) continue;

    const getTsProject = tsProjectByRoot.get(rootForFile.get(filePath) ?? "") ?? noTsProject;
    const result = runCodeRules(filePath, source, root, getTsProject, pendingZodCandidates, oversizedZodFiles);
    findings.push(...result.findings);
    if (result.failure) recordSkip(filePath, result.failure);
  }

  for (const filePath of allPythonFiles) {
    const source = readScannable(filePath);
    if (source === null) continue;

    const result = await runPythonCodeRules(filePath, source, root);
    findings.push(...result.findings);
    if (result.failure) recordSkip(filePath, result.failure);
  }

  for (const filePath of allHtmlFiles) {
    const html = readScannable(filePath);
    if (html === null) continue;

    try {
      findings.push(...runHtmlInputRules(html, filePath, root));
    } catch {
      recordSkip(filePath, "analysis-failed");
    }

    let extraction: ReturnType<typeof extractInlineScriptsBounded> = { scripts: [], skippedCount: 0 };
    try {
      extraction = extractInlineScriptsBounded(html);
    } catch {
      recordSkip(filePath, "analysis-failed");
    }
    if (extraction.skippedCount > 0) recordSkip(filePath, "inline-scripts-truncated");
    let templateScripts = 0;
    for (const script of extraction.scripts) {
      const result = runCodeRules(filePath, script.code, root, noTsProject, pendingZodCandidates, oversizedZodFiles);
      findings.push(...result.findings);
      if (result.failure === "parse-failed" && containsTemplateSyntax(script.code)) templateScripts += 1;
      else if (result.failure) recordSkip(filePath, result.failure);
    }
    if (templateScripts > 0) skippedFiles.push({ file: relative(root, filePath), reason: "template-syntax", scripts: templateScripts });
  }

  for (const filePath of allSchemaFiles) {
    if (!boundary.allowsPath(filePath)) continue;
    if (isOversizedFile(filePath)) {
      recordSkip(filePath, "oversized");
      continue;
    }
    filesScanned += 1;
    try {
      if (OPENAPI_NAME.test(filePath)) {
        const report = { hadErrors: false };
        findings.push(...parseOpenApiSpec(filePath, root, report));
        if (report.hadErrors) recordSkip(filePath, "parse-failed");
      } else if (GRAPHQL_NAME.test(filePath) || extname(filePath) === ".graphql") {
        findings.push(...parseGraphQLSchema(filePath, root));
      }
    } catch {
      recordSkip(filePath, "parse-failed");
    }
  }

  for (const link of boundary.blockedLinks()) skippedFiles.push({ file: link, reason: "symlink-outside-root" });

  const ambiguousCount = findings.filter((f) => f.requiresReview).length;
  const maxZodFragmentBytes = pendingZodCandidates.length
    ? Math.max(...pendingZodCandidates.map((c) => Buffer.byteLength(c.codeFragment, "utf8")))
    : 0;

  return {
    projects,
    findings,
    ambiguousCount,
    filesScanned,
    unsupportedStackWarning,
    workspaceWarning,
    skippedFiles,
    skippedFilesWarning: summarizeSkippedFiles(skippedFiles),
    templateSyntaxNote: summarizeTemplateScripts(skippedFiles),
    pendingZodCandidates,
    oversizedZodFiles,
    maxZodFragmentBytes,
  };
}

import { readFileSync } from "node:fs";
import { extname } from "node:path";
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
import { runHtmlInputRules, extractInlineScripts } from "../rules/htmlRules.js";
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
function makeLazyTsProject(files: string[]): () => TsProjectHandle | null {
  let handle: TsProjectHandle | null | undefined;
  return () => {
    if (handle === undefined) {
      try {
        handle = buildTsProject(files);
      } catch {
        handle = null;
      }
    }
    return handle;
  };
}

function runCodeRules(
  filePath: string,
  source: string,
  root: string,
  getTsProject: () => TsProjectHandle | null,
  zodCandidates: ZodCandidate[],
  oversizedZodFiles: string[]
): Finding[] {
  const ast = parseSource(source, filePath);
  const zodResult = findZodCandidates(source, filePath, root);
  zodCandidates.push(...zodResult.candidates);
  oversizedZodFiles.push(...zodResult.oversizedFiles);
  if (!ast) return [];

  return [
    ...runSdkRules(ast, filePath, source, root),
    ...runFrameworkRules(ast, filePath, source, root),
    ...runWebApiRules(ast, filePath, source, root),
    ...runTypedRequestBodyRules(ast, filePath, source, root, getTsProject),
  ];
}

async function runPythonCodeRules(filePath: string, source: string, root: string): Promise<Finding[]> {
  const tree = await parsePythonSource(source);
  if (!tree) return [];

  return [...runPythonSdkRules(tree, filePath, source, root), ...runPythonFrameworkRules(tree, filePath, source, root)];
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
  const [projects, unsupportedStackWarning] = await Promise.all([discoverProjects(root), detectUnsupportedStack(root)]);
  const findings: Finding[] = [];
  const pendingZodCandidates: ZodCandidate[] = [];
  const oversizedZodFiles: string[] = [];
  let filesScanned = 0;

  const projectRootList = [...new Set(projects.map((p) => p.root))];
  const fileSets = await Promise.all(projectRootList.map((projectRoot) => discoverFiles(projectRoot)));

  const allCodeFiles = new Set<string>();
  const allPythonFiles = new Set<string>();
  const allHtmlFiles = new Set<string>();
  const allSchemaFiles = new Set<string>();
  const rootForFile = new Map<string, string>();
  const tsProjectByRoot = new Map<string, () => TsProjectHandle | null>();
  fileSets.forEach((set, i) => {
    const projectRoot = projectRootList[i];
    tsProjectByRoot.set(projectRoot, makeLazyTsProject(set.codeFiles));
    set.codeFiles.forEach((f) => {
      allCodeFiles.add(f);
      rootForFile.set(f, projectRoot);
    });
    set.pythonFiles.forEach((f) => allPythonFiles.add(f));
    set.htmlFiles.forEach((f) => allHtmlFiles.add(f));
    set.schemaFiles.forEach((f) => allSchemaFiles.add(f));
  });
  // HTML files (and their inline <script> blocks) aren't part of any codeFiles list and never carry
  // a resolvable TS type, so they get a permanently-null thunk rather than a project association.
  const noTsProject = () => null;

  for (const filePath of allCodeFiles) {
    filesScanned += 1;
    let source: string;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const getTsProject = tsProjectByRoot.get(rootForFile.get(filePath) ?? "") ?? noTsProject;
    findings.push(...runCodeRules(filePath, source, root, getTsProject, pendingZodCandidates, oversizedZodFiles));
  }

  for (const filePath of allPythonFiles) {
    filesScanned += 1;
    let source: string;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    findings.push(...(await runPythonCodeRules(filePath, source, root)));
  }

  for (const filePath of allHtmlFiles) {
    filesScanned += 1;
    let html: string;
    try {
      html = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    findings.push(...runHtmlInputRules(html, filePath, root));
    for (const script of extractInlineScripts(html)) {
      findings.push(...runCodeRules(filePath, script.code, root, noTsProject, pendingZodCandidates, oversizedZodFiles));
    }
  }

  for (const filePath of allSchemaFiles) {
    filesScanned += 1;
    if (OPENAPI_NAME.test(filePath)) {
      try {
        findings.push(...parseOpenApiSpec(filePath, root));
      } catch {
        continue;
      }
    } else if (GRAPHQL_NAME.test(filePath) || extname(filePath) === ".graphql") {
      try {
        findings.push(...parseGraphQLSchema(filePath, root));
      } catch {
        continue;
      }
    }
  }

  const ambiguousCount = findings.filter((f) => f.requiresReview).length;

  return { projects, findings, ambiguousCount, filesScanned, unsupportedStackWarning, pendingZodCandidates, oversizedZodFiles };
}

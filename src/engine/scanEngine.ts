import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { discoverProjects } from "./discoverProjects.js";
import { discoverFiles } from "./discoverFiles.js";
import { detectUnsupportedStack } from "./languageDetection.js";
import { parseSource } from "./astUtils.js";
import { runSdkRules } from "../rules/sdkRules.js";
import { runFrameworkRules } from "../rules/frameworkRules.js";
import { runWebApiRules } from "../rules/webApiRules.js";
import { runHtmlInputRules, extractInlineScripts } from "../rules/htmlRules.js";
import { parseOpenApiSpec } from "../schemaParsers/openapi.js";
import { parseGraphQLSchema } from "../schemaParsers/graphql.js";
import type { Finding, ScanResult } from "./types.js";

const OPENAPI_NAME = /(openapi|swagger)\.(ya?ml|json)$/i;
const GRAPHQL_NAME = /\.(graphql|gql)$/i;

function runCodeRules(filePath: string, source: string, root: string): Finding[] {
  const ast = parseSource(source, filePath);
  if (!ast) return [];

  return [
    ...runSdkRules(ast, filePath, source, root),
    ...runFrameworkRules(ast, filePath, source, root),
    ...runWebApiRules(ast, filePath, source, root),
  ];
}

export async function scan(root: string): Promise<ScanResult> {
  const [projects, unsupportedStackWarning] = await Promise.all([discoverProjects(root), detectUnsupportedStack(root)]);
  const findings: Finding[] = [];
  let filesScanned = 0;

  const projectRoots = new Set(projects.map((p) => p.root));
  const fileSets = await Promise.all([...projectRoots].map((projectRoot) => discoverFiles(projectRoot)));

  const allCodeFiles = new Set<string>();
  const allHtmlFiles = new Set<string>();
  const allSchemaFiles = new Set<string>();
  for (const set of fileSets) {
    set.codeFiles.forEach((f) => allCodeFiles.add(f));
    set.htmlFiles.forEach((f) => allHtmlFiles.add(f));
    set.schemaFiles.forEach((f) => allSchemaFiles.add(f));
  }

  for (const filePath of allCodeFiles) {
    filesScanned += 1;
    let source: string;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    findings.push(...runCodeRules(filePath, source, root));
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
      findings.push(...runCodeRules(filePath, script.code, root));
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

  return { projects, findings, ambiguousCount, filesScanned, unsupportedStackWarning };
}

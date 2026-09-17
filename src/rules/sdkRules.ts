import _traverse from "@babel/traverse";
import type { File, Node } from "@babel/types";
import type { TraverseOptions } from "@babel/traverse";
import { relative } from "node:path";
import type { Finding } from "../engine/types.js";
import { PROCESSOR_PROFILES } from "./processorProfiles.js";
import { redactSecrets } from "../engine/secretRedaction.js";

type TraverseFn = (ast: Node, visitor: TraverseOptions) => void;
// @babel/traverse's ESM default export is wrapped under interop; unwrap it defensively.
const traverse: TraverseFn = ((_traverse as unknown as { default?: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

interface SdkMatcher {
  processorKey: keyof typeof PROCESSOR_PROFILES;
  packagePatterns: RegExp[];
}

const SDK_MATCHERS: SdkMatcher[] = [
  { processorKey: "stripe", packagePatterns: [/^stripe$/] },
  { processorKey: "sendgrid", packagePatterns: [/^@sendgrid\/mail$/] },
  { processorKey: "twilio", packagePatterns: [/^twilio$/] },
  { processorKey: "google-analytics", packagePatterns: [/^react-ga4?$/, /^universal-analytics$/, /^@google-analytics\/data$/] },
  { processorKey: "mixpanel", packagePatterns: [/^mixpanel-browser$/, /^mixpanel$/] },
  { processorKey: "auth0", packagePatterns: [/^auth0$/, /^@auth0\//] },
  { processorKey: "firebase", packagePatterns: [/^firebase$/, /^firebase-admin/, /^@firebase\//] },
  { processorKey: "cognito", packagePatterns: [/^amazon-cognito-identity-js$/, /^@aws-sdk\/client-cognito-identity-provider$/] },
];

function matchProcessor(source: string): SdkMatcher | undefined {
  return SDK_MATCHERS.find((matcher) => matcher.packagePatterns.some((p) => p.test(source)));
}

export function runSdkRules(ast: File, filePath: string, source: string, root: string): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split("\n");
  const seenProcessors = new Set<string>();

  traverse(ast, {
    ImportDeclaration(path) {
      const src = path.node.source.value;
      const matcher = matchProcessor(src);
      if (!matcher) return;
      emitFinding(matcher, path.node.loc?.start.line ?? 1);
    },
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type !== "Identifier" || callee.name !== "require") return;
      const arg = path.node.arguments[0];
      if (!arg || arg.type !== "StringLiteral") return;
      const matcher = matchProcessor(arg.value);
      if (!matcher) return;
      emitFinding(matcher, path.node.loc?.start.line ?? 1);
    },
  });

  function emitFinding(matcher: SdkMatcher, line: number) {
    const dedupeKey = `${matcher.processorKey}:${filePath}`;
    if (seenProcessors.has(dedupeKey)) return;
    seenProcessors.add(dedupeKey);

    const profile = PROCESSOR_PROFILES[matcher.processorKey];
    const evidenceLine = lines[line - 1] ?? "";
    findings.push({
      id: `sdk:${matcher.processorKey}:${relative(root, filePath)}:${line}`,
      dataCategories: profile.dataCategories,
      processor: profile.name,
      description: `${profile.name} integration detected. ${profile.disclosureNotes}`,
      confidence: "high",
      source: "sdk-rule",
      location: { file: relative(root, filePath), line, column: 0 },
      evidence: redactSecrets(evidenceLine.trim()).slice(0, 200),
      requiresReview: false,
    });
  }

  return findings;
}

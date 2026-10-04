import { relative } from "node:path";
import type { Node, Tree } from "web-tree-sitter";
import type { Finding } from "../engine/types.js";
import { PROCESSOR_PROFILES } from "./processorProfiles.js";
import { redactSecrets } from "../engine/secretRedaction.js";

interface SdkMatcher {
  processorKey: keyof typeof PROCESSOR_PROFILES;
  /** Matched against the imported module's root package name (the first dotted segment). */
  moduleNames: string[];
}

/**
 * Deliberately narrower than sdkRules.ts's JS table -- not every processor has a reliable
 * import-name signal in Python's ecosystem:
 *   - Cognito: Python code almost always calls it through boto3, AWS's *general* SDK used for every
 *     AWS service (S3, DynamoDB, SQS, ...). Mapping a bare `import boto3` to "Amazon Cognito" would be
 *     wrong far more often than right; reliably detecting it needs finding the specific
 *     `boto3.client("cognito-idp")` call, not just the import -- a real gap, not covered here.
 *   - Google Analytics: no single well-known, unambiguous pip import root the way `stripe` or
 *     `twilio` are for their processors. Left out rather than guessed.
 */
const SDK_MATCHERS: SdkMatcher[] = [
  { processorKey: "stripe", moduleNames: ["stripe"] },
  { processorKey: "sendgrid", moduleNames: ["sendgrid"] },
  { processorKey: "twilio", moduleNames: ["twilio"] },
  { processorKey: "mixpanel", moduleNames: ["mixpanel"] },
  { processorKey: "auth0", moduleNames: ["auth0"] },
  // PyPI package is "firebase-admin"; its import root is firebase_admin.
  { processorKey: "firebase", moduleNames: ["firebase_admin"] },
];

function matchProcessor(moduleRoot: string): SdkMatcher | undefined {
  return SDK_MATCHERS.find((matcher) => matcher.moduleNames.includes(moduleRoot));
}

/** The root package name from a dotted module path node (e.g. "twilio" from "twilio.rest"). */
function moduleRootName(moduleNameNode: Node | null): string | null {
  if (!moduleNameNode) return null;
  if (moduleNameNode.type === "dotted_name") {
    return moduleNameNode.child(0)?.text ?? null;
  }
  if (moduleNameNode.type === "aliased_import") {
    return moduleRootName(moduleNameNode.childForFieldName("name"));
  }
  // relative_import ("from . import x") and anything else has no external package name.
  return null;
}

export function runPythonSdkRules(tree: Tree, filePath: string, source: string, root: string): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split("\n");
  const relPath = relative(root, filePath);
  const seenProcessors = new Set<string>();

  const importNodes = [
    ...tree.rootNode.descendantsOfType("import_statement"),
    ...tree.rootNode.descendantsOfType("import_from_statement"),
  ];

  for (const node of importNodes) {
    const fieldName = node.type === "import_statement" ? "name" : "module_name";
    const moduleRoot = moduleRootName(node.childForFieldName(fieldName));
    if (!moduleRoot) continue;

    const matcher = matchProcessor(moduleRoot);
    if (!matcher || seenProcessors.has(matcher.processorKey)) continue;
    seenProcessors.add(matcher.processorKey);

    const profile = PROCESSOR_PROFILES[matcher.processorKey];
    const line = node.startPosition.row + 1;
    const evidenceLine = lines[line - 1] ?? "";

    findings.push({
      id: `sdk:${matcher.processorKey}:${relPath}:${line}`,
      dataCategories: profile.dataCategories,
      processor: profile.name,
      description: `${profile.name} integration detected. ${profile.disclosureNotes}`,
      confidence: "high",
      source: "sdk-rule",
      location: { file: relPath, line, column: 0 },
      evidence: redactSecrets(evidenceLine.trim()),
      requiresReview: false,
    });
  }

  return findings;
}

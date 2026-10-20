import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

export const CONFIG_FILENAME = ".srclawyer.config.yml";

/** The pre-0.5.0 name. Never auto-migrated or silently read as a fallback -- see legacyConfigMessage. */
export const LEGACY_CONFIG_FILENAME = ".privacypolicy.yml";

export type SrcLawyerTier = "free" | "byok" | "managed";

export interface SrcLawyerLlmConfig {
  provider: "anthropic";
  apiKeyEnvVar: string | null;
}

/** "generated": the policy file is a build output and scan/update always regenerate it. "handwritten" (also when absent): the file is the owner's once edited. */
export type PolicyMode = "generated" | "handwritten";

/** Text the owner adds to a generated policy; shown exactly as written (docs/question-catalog.md section 6.1). */
export interface PolicyTextConfig {
  intro?: string | null;
  /** A date written by the owner. SrcLawyer never generates one. */
  lastUpdated?: string | null;
  closing?: string | null;
  additionalSections?: Array<{ heading: string; body: string }>;
}

export const POLICY_TEXT_LIMITS = { heading: 100, body: 4000, intro: 2000, closing: 2000, lastUpdated: 100, sections: 10 } as const;

export interface SrcLawyerConfig {
  entityLocation: string | null;
  targetMarkets: string[];
  industry: string | null;
  // null means "never answered" (e.g. a hand-edited or pre-0.6.1 config missing this key), distinct
  // from an explicit "no" -- see generatePolicy.ts's rendering of this field, and buildRequestItem's
  // call site in scan.ts, which coerces null to false to preserve the existing Layer 2 override as-is.
  collectsChildrensData: boolean | null;
  tier?: SrcLawyerTier;
  llm?: SrcLawyerLlmConfig;
  // Everything below is optional, attorney-reviewable policy content -- never inferred, only ever
  // what the user explicitly provided via `init` or by hand-editing this file. null/absent renders as
  // a `[TO COMPLETE: ...]` placeholder in the generated policy, never a guessed or default value.
  companyName?: string | null;
  siteUrl?: string | null;
  privacyContactEmail?: string | null;
  hasEuUkUsers?: boolean | null;
  hasCaliforniaUsers?: boolean | null;
  sellsOrSharesData?: boolean | null;
  usesDataForAdvertising?: boolean | null;
  dataRetentionPolicy?: string | null;
  accountDeletionInstructions?: string | null;
  minimumAge?: number | null;
  sendsDataToAiServices?: boolean | null;
  policyMode?: PolicyMode;
  policyText?: PolicyTextConfig;
  /** The owner's answers about features of services they use, keyed `<profile>.<feature>` (docs/question-catalog.md section 10). */
  serviceUse?: Record<string, boolean>;
}

export const DEFAULT_CONFIG: SrcLawyerConfig = {
  entityLocation: null,
  targetMarkets: [],
  industry: null,
  collectsChildrensData: null,
  tier: "free",
  companyName: null,
  siteUrl: null,
  privacyContactEmail: null,
  hasEuUkUsers: null,
  hasCaliforniaUsers: null,
  sellsOrSharesData: null,
  usesDataForAdvertising: null,
  dataRetentionPolicy: null,
  accountDeletionInstructions: null,
  minimumAge: null,
  sendsDataToAiServices: null,
};

export function configPath(root: string): string {
  return join(root, CONFIG_FILENAME);
}

export function legacyConfigPath(root: string): string {
  return join(root, LEGACY_CONFIG_FILENAME);
}

/** True only when the old file is present and the new one isn't -- never fires once migrated. */
export function hasUnmigratedLegacyConfig(root: string): boolean {
  return existsSync(legacyConfigPath(root)) && !existsSync(configPath(root));
}

/**
 * Single source of truth for this message so init and scan can't drift into saying it two different
 * ways. Deliberately never auto-reads the legacy file as a fallback, even though the YAML shape is
 * identical -- the rename needs to be an explicit, visible action, not a silent compatibility shim
 * that lets the old filename linger indefinitely.
 */
export function legacyConfigMessage(): string {
  return `Found a legacy ${LEGACY_CONFIG_FILENAME} from an older version of SrcLawyer. Rename it to keep your existing settings:\n\n  mv ${LEGACY_CONFIG_FILENAME} ${CONFIG_FILENAME}\n\nThen re-run this command. (If you'd rather start fresh instead, delete ${LEGACY_CONFIG_FILENAME} first.)`;
}

export function loadConfig(root: string): SrcLawyerConfig | null {
  const path = configPath(root);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  const config = { ...DEFAULT_CONFIG, ...(yaml.load(raw) as Partial<SrcLawyerConfig>) };
  // Anything other than the exact word "generated" is the old behaviour.
  if (config.policyMode !== undefined && config.policyMode !== "generated") config.policyMode = "handwritten";
  return config;
}

/** The mode a project runs in; a missing key means the 0.8.0 behaviour. */
export function policyModeOf(config: SrcLawyerConfig | null): PolicyMode {
  return config?.policyMode === "generated" ? "generated" : "handwritten";
}

export function writeConfig(root: string, config: SrcLawyerConfig): void {
  const path = configPath(root);
  const header = "# Generated by srclawyer init. Safe to edit by hand.\n";
  writeFileSync(path, header + yaml.dump(config), "utf8");
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  CONFIG_FILENAME,
  DEFAULT_CONFIG,
  configPath,
  hasUnmigratedLegacyConfig,
  legacyConfigMessage,
  writeConfig,
  type SrcLawyerConfig,
  type SrcLawyerTier,
} from "../config/config.js";
import { NETWORK_CALLS_NOTICE } from "../policy/legalNotices.js";

export interface InitFlags {
  policyDetails?: boolean;
  companyName?: string;
  siteUrl?: string;
  privacyContactEmail?: string;
  euUkUsers?: boolean;
  californiaUsers?: boolean;
  sellsOrSharesData?: boolean;
  usesDataForAdvertising?: boolean;
  dataRetentionPolicy?: string;
  accountDeletionInstructions?: string;
  minimumAge?: number;
  sendsDataToAiServices?: boolean;
}

function guessIndustry(root: string): string | null {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (typeof pkg.description === "string" && pkg.description.length > 0) return pkg.description;
    return null;
  } catch {
    return null;
  }
}

type LineIterator = AsyncIterator<string>;

async function ask(lines: LineIterator, question: string, fallback: string): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : "";
  process.stdout.write(`${question}${suffix}: `);
  const { value, done } = await lines.next();
  const answer = done ? "" : value.trim();
  return answer.length > 0 ? answer : fallback;
}

async function askOptional(lines: LineIterator, question: string): Promise<string | null> {
  process.stdout.write(`${question} (optional, press Enter to skip): `);
  const { value, done } = await lines.next();
  const answer = done ? "" : value.trim();
  return answer.length > 0 ? answer : null;
}

// suggested, when not null, is shown as the bracketed default and adopted on a blank answer -- used
// to prefill EU/UK and California questions from targetMarkets without ever forcing an answer. When
// suggested is null (no signal), blank means genuinely unanswered, same as every other optional field.
async function askYesNoOptional(lines: LineIterator, question: string, suggested: boolean | null = null): Promise<boolean | null> {
  const suffix = suggested === null ? " (y/n, optional, press Enter to skip)" : ` [${suggested ? "y" : "n"}]`;
  process.stdout.write(`${question}${suffix}: `);
  const { value, done } = await lines.next();
  const answer = done ? "" : value.trim().toLowerCase();
  if (answer.length === 0) return suggested;
  return /^y(es)?$/.test(answer);
}

async function askOptionalAge(lines: LineIterator, question: string): Promise<number | null> {
  const raw = await askOptional(lines, question);
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.log(`  (Could not read "${raw}" as a whole, non-negative number -- skipping. You can set this later by editing ${CONFIG_FILENAME}.)`);
    return null;
  }
  return parsed;
}

// Generic resolution order for every new optional field: an explicit flag always wins outright;
// otherwise the field is only asked if the policy-details gate resolved to yes; otherwise it's null.
async function resolveField<T>(flagValue: T | undefined, gateYes: boolean, askFn: () => Promise<T | null>): Promise<T | null> {
  if (flagValue !== undefined) return flagValue;
  if (!gateYes) return null;
  return askFn();
}

const EU_UK_TOKENS = new Set(["eu", "uk", "gb", "eea", "european union", "united kingdom"]);
const CALIFORNIA_TOKENS = new Set(["ca", "california", "us-ca"]);

function targetMarketsSuggestEuUk(markets: string[]): boolean {
  return markets.some((m) => EU_UK_TOKENS.has(m.trim().toLowerCase()));
}

function targetMarketsSuggestCalifornia(markets: string[]): boolean {
  return markets.some((m) => CALIFORNIA_TOKENS.has(m.trim().toLowerCase()));
}

// Only warns in the one direction that's a real contradiction: target markets signal a region, but
// the final answer explicitly denies it. The reverse (no signal, but the user says yes) isn't a
// contradiction -- targetMarkets is free text and was never meant to be an exhaustive jurisdiction
// list. Never blocks or overrides -- the explicit answer always stands, this only warns.
function warnIfContradictsTargetMarkets(label: string, finalValue: boolean | null, suggestedFromMarkets: boolean): void {
  if (suggestedFromMarkets && finalValue === false) {
    console.log(
      `\nWarning: your target markets suggest ${label} users, but you indicated none -- the generated policy will omit ${label}-specific disclosures. Re-run init or edit ${CONFIG_FILENAME} if this is incorrect.\n`
    );
  }
}

export async function runInit(root: string, flags: InitFlags = {}): Promise<void> {
  const existingPath = configPath(root);
  if (existsSync(existingPath)) {
    console.log(`${CONFIG_FILENAME} already exists. Delete it first if you want to redo setup.`);
    return;
  }

  if (hasUnmigratedLegacyConfig(root)) {
    console.log(legacyConfigMessage());
    return;
  }

  const guessedIndustry = guessIndustry(root);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();

  // Printed once, here, not re-shown on every scan -- informational only, never blocks: nothing below
  // waits on an acknowledgment, so this is safe in non-interactive contexts (CI, scripted installs).
  console.log(`${NETWORK_CALLS_NOTICE}\n`);
  console.log("SrcLawyer setup — answered once, reused on every scan.\n");

  const entityLocation = await ask(lines, "Where is your legal entity located? (country)", DEFAULT_CONFIG.entityLocation ?? "");
  const targetMarketsRaw = await ask(lines, "Which regions/markets do you serve? (comma-separated, e.g. US, EU)", "");
  const targetMarkets = targetMarketsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const industry = await ask(lines, "What industry/vertical is this product in?", guessedIndustry ?? "");
  const childrensDataRaw = await ask(lines, "Does this product knowingly collect data from children under 13/16?", "no");

  const gateYes = flags.policyDetails !== undefined
    ? flags.policyDetails
    : /^y(es)?$/i.test((await ask(lines, "Add privacy policy details now? (company info, data practices, regional rights, etc.)", "y")).trim());

  const minimumAge = await resolveField(flags.minimumAge, gateYes, () => askOptionalAge(lines, "Minimum age required to use this product"));
  const companyName = await resolveField(flags.companyName, gateYes, () => askOptional(lines, "Company or product name"));
  const siteUrl = await resolveField(flags.siteUrl, gateYes, () => askOptional(lines, "Site or app URL"));
  const privacyContactEmail = await resolveField(flags.privacyContactEmail, gateYes, () => askOptional(lines, "Privacy contact email"));

  const euUkSuggested = targetMarketsSuggestEuUk(targetMarkets);
  const hasEuUkUsers = await resolveField(flags.euUkUsers, gateYes, () =>
    askYesNoOptional(lines, "Do you have users in the EU/UK?", euUkSuggested ? true : null)
  );
  warnIfContradictsTargetMarkets("EU/UK", hasEuUkUsers, euUkSuggested);

  const californiaSuggested = targetMarketsSuggestCalifornia(targetMarkets);
  const hasCaliforniaUsers = await resolveField(flags.californiaUsers, gateYes, () =>
    askYesNoOptional(lines, "Do you have users in California?", californiaSuggested ? true : null)
  );
  warnIfContradictsTargetMarkets("California", hasCaliforniaUsers, californiaSuggested);

  const sellsOrSharesData = await resolveField(flags.sellsOrSharesData, gateYes, () =>
    askYesNoOptional(lines, "Does this product sell or share personal data with third parties?")
  );
  const usesDataForAdvertising = await resolveField(flags.usesDataForAdvertising, gateYes, () =>
    askYesNoOptional(lines, "Does this product use personal data for advertising?")
  );
  const dataRetentionPolicy = await resolveField(flags.dataRetentionPolicy, gateYes, () =>
    askOptional(lines, "How long is personal data retained?")
  );
  const accountDeletionInstructions = await resolveField(flags.accountDeletionInstructions, gateYes, () =>
    askOptional(lines, "How can a user delete their account or request data deletion?")
  );
  // Deliberately about the SCANNED PRODUCT's own behavior (does it send its end-users' data to AI
  // services as part of its own functionality) -- not about SrcLawyer's own, separately-documented
  // BYOK network calls described in NETWORK_CALLS_NOTICE above.
  const sendsDataToAiServices = await resolveField(flags.sendsDataToAiServices, gateYes, () =>
    askYesNoOptional(lines, "Does this product send user data to third-party AI services (e.g. OpenAI, Anthropic) as part of its own functionality?")
  );

  // "managed" is deliberately not offered here -- it's a real SrcLawyerTier value and config.ts/
  // resolveProviderForTier.ts both still support it fully (a hand-edited config with tier: managed
  // still gets a clear, accurate error at scan time), but there's no advertised path to it from this
  // prompt, so a tester reading the choices here can't select a dead end during setup.
  const enableByokRaw = await ask(lines, "Enable optional AI-assisted review with your own Anthropic key? (advanced)", "n");
  const tier: SrcLawyerTier = /^y(es)?$/i.test(enableByokRaw.trim()) ? "byok" : "free";
  let apiKeyEnvVar: string | null = null;

  if (tier === "byok") {
    apiKeyEnvVar = await ask(lines, "Which environment variable holds your Anthropic API key?", "ANTHROPIC_API_KEY");
    console.log(`\nNote: only the name "${apiKeyEnvVar}" is written to ${CONFIG_FILENAME} — the key itself is never written to disk. It's read from your environment at scan time.`);
  }

  rl.close();

  const config: SrcLawyerConfig = {
    entityLocation: entityLocation || null,
    targetMarkets,
    industry: industry || null,
    collectsChildrensData: /^y(es)?$/i.test(childrensDataRaw.trim()),
    tier,
    ...(tier === "byok" ? { llm: { provider: "anthropic" as const, apiKeyEnvVar } } : {}),
    companyName,
    siteUrl,
    privacyContactEmail,
    hasEuUkUsers,
    hasCaliforniaUsers,
    sellsOrSharesData,
    usesDataForAdvertising,
    dataRetentionPolicy,
    accountDeletionInstructions,
    minimumAge,
    sendsDataToAiServices,
  };

  writeConfig(root, config);
  console.log(`\nWrote ${CONFIG_FILENAME}. Run "srclawyer scan" to analyze this codebase.`);
}

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

export async function runInit(root: string): Promise<void> {
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
  const industry = await ask(lines, "What industry/vertical is this product in?", guessedIndustry ?? "");
  const childrensDataRaw = await ask(lines, "Does this product knowingly collect data from children under 13/16?", "no");
  const tierRaw = await ask(lines, "Tier: free (static analysis only) / byok (bring your own Anthropic key) / managed (not yet available)", "free");

  const tier = normalizeTier(tierRaw);
  let apiKeyEnvVar: string | null = null;

  if (tier === "byok") {
    apiKeyEnvVar = await ask(lines, "Which environment variable holds your Anthropic API key?", "ANTHROPIC_API_KEY");
    console.log(`\nNote: only the name "${apiKeyEnvVar}" is written to ${CONFIG_FILENAME} — the key itself is never written to disk. It's read from your environment at scan time.`);
  } else if (tier === "managed") {
    console.log("\nHeads up: the managed tier's hosted backend isn't available yet. Layer 1 (static analysis) will still run fine; AI-assisted resolution will report a clear error until it ships.");
  }

  rl.close();

  const config: SrcLawyerConfig = {
    entityLocation: entityLocation || null,
    targetMarkets: targetMarketsRaw.split(",").map((s) => s.trim()).filter(Boolean),
    industry: industry || null,
    collectsChildrensData: /^y(es)?$/i.test(childrensDataRaw.trim()),
    tier,
    ...(tier === "byok" ? { llm: { provider: "anthropic" as const, apiKeyEnvVar } } : {}),
  };

  writeConfig(root, config);
  console.log(`\nWrote ${CONFIG_FILENAME}. Run "srclawyer scan" to analyze this codebase.`);
}

function normalizeTier(raw: string): SrcLawyerTier {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "byok" || normalized === "managed") return normalized;
  return "free";
}

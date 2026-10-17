#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { isValidEnvVarName, runInit } from "./commands/init.js";
import { runScan } from "./commands/scan.js";
import { runCheck } from "./commands/check.js";
import { DEFAULT_INVENTORY_PATH } from "./inventory/inventory.js";
import { EXIT_CRASH } from "./exitCodes.js";
import { readPackageVersion } from "./version.js";

// Read from package.json rather than hardcoding, so --version can't silently drift out of sync with
// the published version the way a literal string did through every prior release.
const version = readPackageVersion();

const program = new Command();

// Commander normally calls process.exit(1) itself on a usage error; exit codes are this CLI's contract
// (see exitCodes.ts), so it throws instead and the handler at the bottom decides the code.
program.exitOverride();

program
  .name("srclawyer")
  .description("Static analysis engine that derives privacy policy documentation directly from source code")
  .version(version);

interface InitCliOptions {
  policyDetails?: boolean;
  collectsChildrensData?: boolean;
  companyName?: string;
  siteUrl?: string;
  privacyContactEmail?: string;
  euUkUsers?: boolean;
  californiaUsers?: boolean;
  sellsOrSharesData?: boolean;
  usesDataForAdvertising?: boolean;
  dataRetentionPolicy?: string;
  accountDeletionInstructions?: string;
  minimumAge?: string;
  sendsDataToAiServices?: boolean;
  enableAiReview?: boolean;
  apiKeyEnvVar?: string;
}

program
  .command("init")
  .description("One-time setup: jurisdiction, markets, industry, and optional policy details (company info, data practices, regional rights)")
  .option("--policy-details", "ask the optional policy-detail questions (company info, data practices, regional rights)")
  .option("--no-policy-details", "skip all optional policy-detail questions, leaving them unanswered")
  .option("--collects-childrens-data", "declare that this product knowingly collects data from children under 13/16")
  .option("--no-collects-childrens-data", "declare that this product does not knowingly collect data from children under 13/16")
  .option("--company-name <name>", "company or product name")
  .option("--site-url <url>", "site or app URL")
  .option("--privacy-contact-email <email>", "privacy contact email address")
  .option("--eu-uk-users", "declare that this product has users in the EU/UK")
  .option("--no-eu-uk-users", "declare that this product has no users in the EU/UK")
  .option("--california-users", "declare that this product has users in California")
  .option("--no-california-users", "declare that this product has no users in California")
  .option("--sells-or-shares-data", "declare that personal data is sold or shared with third parties")
  .option("--no-sells-or-shares-data", "declare that personal data is not sold or shared with third parties")
  .option("--uses-data-for-advertising", "declare that personal data is used for advertising")
  .option("--no-uses-data-for-advertising", "declare that personal data is not used for advertising")
  .option("--data-retention-policy <text>", "how long personal data is retained")
  .option("--account-deletion-instructions <text>", "how a user can delete their account or request data deletion")
  .option("--minimum-age <number>", "minimum age required to use this product")
  .option("--sends-data-to-ai-services", "declare that user data is sent to third-party AI services")
  .option("--no-sends-data-to-ai-services", "declare that user data is not sent to third-party AI services")
  .option("--enable-ai-review", "advanced: enable optional AI-assisted review of ambiguous findings with your own Anthropic API key (sets tier: byok)")
  .option("--api-key-env-var <name>", "with --enable-ai-review: the environment variable holding your Anthropic API key (default ANTHROPIC_API_KEY)")
  .action(async (opts: InitCliOptions) => {
    if (opts.apiKeyEnvVar !== undefined) {
      if (!opts.enableAiReview) program.error("error: --api-key-env-var requires --enable-ai-review");
      if (!isValidEnvVarName(opts.apiKeyEnvVar)) program.error(`error: --api-key-env-var must be a valid environment variable name (got "${opts.apiKeyEnvVar}")`);
    }

    let minimumAge: number | undefined;
    if (opts.minimumAge !== undefined) {
      const parsed = Number(opts.minimumAge);
      if (!Number.isInteger(parsed) || parsed < 0) {
        program.error(`error: --minimum-age must be a whole, non-negative number (got "${opts.minimumAge}")`);
      }
      minimumAge = parsed;
    }

    await runInit(process.cwd(), {
      policyDetails: opts.policyDetails,
      collectsChildrensData: opts.collectsChildrensData,
      companyName: opts.companyName,
      siteUrl: opts.siteUrl,
      privacyContactEmail: opts.privacyContactEmail,
      euUkUsers: opts.euUkUsers,
      californiaUsers: opts.californiaUsers,
      sellsOrSharesData: opts.sellsOrSharesData,
      usesDataForAdvertising: opts.usesDataForAdvertising,
      dataRetentionPolicy: opts.dataRetentionPolicy,
      accountDeletionInstructions: opts.accountDeletionInstructions,
      minimumAge,
      sendsDataToAiServices: opts.sendsDataToAiServices,
      enableAiReview: opts.enableAiReview,
      apiKeyEnvVar: opts.apiKeyEnvVar,
    });
  });

program
  .command("scan")
  .description("Scan the codebase for data-collection patterns and generate a privacy policy")
  .option("--json", "output findings as JSON", false)
  .option("--out <path>", "path to write the generated privacy policy", "PRIVACY_POLICY.md")
  .option("--no-llm", "skip AI-assisted resolution of ambiguous findings for this run")
  .option(
    "--write-inventory [path]",
    `also write the drift baseline (data categories and processors only) to <path> (default ${DEFAULT_INVENTORY_PATH}); uses git-aware file discovery in a git repository`
  )
  .option("--allow-incomplete-inventory", "with --write-inventory: write the baseline even if the scan completed with warnings")
  .action(async (opts: { json: boolean; out: string; llm: boolean; writeInventory?: string | true; allowIncompleteInventory?: boolean }) => {
    await runScan(process.cwd(), {
      json: opts.json,
      out: opts.out,
      llm: opts.llm,
      writeInventory: opts.writeInventory === true ? DEFAULT_INVENTORY_PATH : opts.writeInventory,
      allowIncompleteInventory: opts.allowIncompleteInventory,
    });
  });

program
  .command("check")
  .description("Check for drift: compare the code's data categories and processors with the committed baseline (exit 0 no drift, 1 drift, 2 error, 3 inconclusive)")
  .option("--inventory <path>", "the baseline file", DEFAULT_INVENTORY_PATH)
  .option("--format <format>", "text or json", "text")
  .action(async (opts: { inventory: string; format: string }) => {
    const format = opts.format;
    if (format !== "text" && format !== "json") return program.error(`error: --format must be "text" or "json" (got "${format}")`);
    process.exitCode = await runCheck(process.cwd(), { inventoryPath: opts.inventory, format });
  });

// Exit 1 is reserved for "completed with warnings" (scan) and "drift" (check), so anything that ends
// the run abnormally -- an uncaught error, an unhandled rejection, a usage error -- exits 2.
function crash(error: unknown): never {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(EXIT_CRASH);
}

process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof CommanderError) {
    // Help and --version also arrive here, with exitCode 0; commander has already printed its message.
    process.exitCode = error.exitCode === 0 ? 0 : EXIT_CRASH;
    return;
  }
  crash(error);
});

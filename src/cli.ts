#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runScan } from "./commands/scan.js";

// Read from package.json rather than hardcoding, so --version can't silently drift out of sync with
// the published version the way a literal string did through every prior release.
const HERE = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(HERE, "../package.json"), "utf8")) as { version: string };

const program = new Command();

program
  .name("srclawyer")
  .description("Static analysis engine that derives privacy policy documentation directly from source code")
  .version(version);

interface InitCliOptions {
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
  minimumAge?: string;
  sendsDataToAiServices?: boolean;
}

program
  .command("init")
  .description("One-time setup: jurisdiction, markets, industry, and optional policy details (company info, data practices, regional rights)")
  .option("--policy-details", "ask the optional policy-detail questions (company info, data practices, regional rights)")
  .option("--no-policy-details", "skip all optional policy-detail questions, leaving them unanswered")
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
  .action(async (opts: InitCliOptions) => {
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
    });
  });

program
  .command("scan")
  .description("Scan the codebase for data-collection patterns and generate a privacy policy")
  .option("--json", "output findings as JSON", false)
  .option("--out <path>", "path to write the generated privacy policy", "PRIVACY_POLICY.md")
  .option("--no-llm", "skip AI-assisted resolution of ambiguous findings for this run")
  .action(async (opts: { json: boolean; out: string; llm: boolean }) => {
    await runScan(process.cwd(), { json: opts.json, out: opts.out, llm: opts.llm });
  });

program.parseAsync(process.argv);

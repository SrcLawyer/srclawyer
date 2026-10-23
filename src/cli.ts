#!/usr/bin/env node
import { Command, CommanderError, Option } from "commander";
import { isValidEnvVarName, runInit } from "./commands/init.js";
import { runScan } from "./commands/scan.js";
import { readFileSync } from "node:fs";
import { runUpdate } from "./commands/update.js";
import { runStatus } from "./commands/status.js";
import { runQuestions } from "./commands/questionsCommand.js";
import { runAnswer } from "./commands/answer.js";
import { runApprove } from "./commands/approve.js";
import { runAgentSetup } from "./commands/agentSetup.js";
import { runCiInit } from "./commands/ciInit.js";
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
  yes?: boolean;
  policyMode?: string;
  agentRules?: boolean;
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
  .option("--policy-mode <mode>", "generated: the policy file is a build output that scan and update always regenerate; handwritten (the default): the file is yours once you edit it")
  .option("--agent-rules", "after setup, show and (with your yes, or --yes) write the instructions for your coding assistant (see agent-setup)")
  .option("--yes", "set up with defaults and run the first scan; every policy answer stays blank for your assistant to ask you")
  .option("--enable-ai-review", "advanced: enable optional AI-assisted review of ambiguous findings with your own Anthropic API key (sets tier: byok)")
  .option("--api-key-env-var <name>", "with --enable-ai-review: the environment variable holding your Anthropic API key (default ANTHROPIC_API_KEY)")
  .action(async (opts: InitCliOptions) => {
    if (opts.apiKeyEnvVar !== undefined) {
      if (!opts.enableAiReview) program.error("error: --api-key-env-var requires --enable-ai-review");
      if (!isValidEnvVarName(opts.apiKeyEnvVar)) program.error(`error: --api-key-env-var must be a valid environment variable name (got "${opts.apiKeyEnvVar}")`);
    }

    if (opts.policyMode !== undefined && opts.policyMode !== "generated" && opts.policyMode !== "handwritten") {
      program.error(`error: --policy-mode must be "generated" or "handwritten" (got "${opts.policyMode}")`);
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
      yes: opts.yes,
      policyMode: opts.policyMode as "generated" | "handwritten" | undefined,
    });
    if (opts.agentRules) {
      process.exitCode = (await runAgentSetup(process.cwd(), { dryRun: false, yes: opts.yes === true, claudeAskRules: false, json: false })) || process.exitCode;
    }
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
  .option("--force", "overwrite the policy file even if it was edited since SrcLawyer generated it, or was not generated by SrcLawyer", false)
  .action(async (opts: { json: boolean; out: string; llm: boolean; writeInventory?: string | true; allowIncompleteInventory?: boolean; force: boolean }) => {
    await runScan(process.cwd(), {
      json: opts.json,
      out: opts.out,
      llm: opts.llm,
      writeInventory: opts.writeInventory === true ? DEFAULT_INVENTORY_PATH : opts.writeInventory,
      allowIncompleteInventory: opts.allowIncompleteInventory,
      force: opts.force,
    });
  });

program
  .command("check")
  .description("Check for drift: compare the code's data categories and processors with the committed baseline (exit 0 no drift, 1 drift, 2 error, 3 inconclusive)")
  .option("--inventory <path>", "the baseline file", DEFAULT_INVENTORY_PATH)
  .option("--format <format>", "text or json", "text")
  .option("--json", "same as --format json")
  .action(async (opts: { inventory: string; format: string; json?: boolean }) => {
    const format = opts.json ? "json" : opts.format;
    if (format !== "text" && format !== "json") return program.error(`error: --format must be "text" or "json" (got "${format}")`);
    process.exitCode = await runCheck(process.cwd(), { inventoryPath: opts.inventory, format });
  });

program
  .command("update")
  .description("On drift, write a draft policy and a review file next to (never over) your policy and baseline (exit 0 no new items, 1 new items found, 2 error, 3 inconclusive)")
  .option("--inventory <path>", "the baseline file", DEFAULT_INVENTORY_PATH)
  .option("--out-dir <dir>", "where to write PRIVACY_POLICY.generated.md and PRIVACY_POLICY.review.md", ".")
  .option("--format <format>", "text or json", "text")
  .option("--json", "same as --format json")
  .action(async (opts: { inventory: string; outDir: string; format: string; json?: boolean }) => {
    const format = opts.json ? "json" : opts.format;
    if (format !== "text" && format !== "json") return program.error(`error: --format must be "text" or "json" (got "${format}")`);
    process.exitCode = await runUpdate(process.cwd(), { inventoryPath: opts.inventory, outDir: opts.outDir, format });
  });

program
  .command("status")
  .description("Where the project stands, from local files only (no scan, no network); always exits 0")
  .option("--inventory <path>", "the baseline file", DEFAULT_INVENTORY_PATH)
  .option("--json", "print the stable JSON report")
  .action((opts: { inventory: string; json?: boolean }) => {
    process.exitCode = runStatus(process.cwd(), { inventoryPath: opts.inventory, json: opts.json === true });
  });

program
  .command("questions")
  .description("The questions that still need the owner's answer, in plain wording, from local files only")
  .option("--inventory <path>", "the baseline file", DEFAULT_INVENTORY_PATH)
  .option("--json", "print the stable JSON report")
  .action((opts: { inventory: string; json?: boolean }) => {
    process.exitCode = runQuestions(process.cwd(), { inventoryPath: opts.inventory, json: opts.json === true });
  });

program
  .command("answer <id> [value]")
  .description("Record one answer from the owner, non-interactively (prints JSON; exit 0 recorded, 2 refused)")
  .option("--inventory <path>", "the baseline file", DEFAULT_INVENTORY_PATH)
  .option("--note <text>", "what the owner said, up to 120 characters on one line; required for the sensitive questions")
  .option("--stdin", "read the answer from standard input instead of the argument")
  .option("--heading <text>", "policyText.additionalSections only: the heading of the section being added")
  .option("--json", "accepted for consistency; the output is always JSON")
  .action((id: string, value: string | undefined, opts: { inventory: string; note?: string; stdin?: boolean; heading?: string }) => {
    const raw = opts.stdin ? readFileSync(0, "utf8") : value;
    if (raw === undefined) return program.error("error: give a value, or --stdin");
    process.exitCode = runAnswer(process.cwd(), { inventoryPath: opts.inventory, id, value: raw, note: opts.note, heading: opts.heading, json: true });
  });

program
  .command("approve")
  .description("Record the owner's confirmation that they looked at the changes (prints JSON; exit 0 recorded, 2 refused, 3 scan incomplete)")
  .requiredOption("--review <hash>", "the review hash from update or questions")
  .requiredOption("--user-reply <text>", "the owner's reply: their yes, and nothing else")
  .option("--allow-unanswered <ids>", "comma-separated question ids the owner chose to leave unanswered", "")
  .option("--inventory <path>", "the baseline file", DEFAULT_INVENTORY_PATH)
  .option("--json", "accepted for consistency; the output is always JSON")
  .action(async (opts: { review: string; userReply: string; allowUnanswered: string; inventory: string }) => {
    process.exitCode = await runApprove(process.cwd(), {
      inventoryPath: opts.inventory,
      review: opts.review,
      userReply: opts.userReply,
      allowUnanswered: opts.allowUnanswered.split(",").map((s) => s.trim()).filter(Boolean),
      json: true,
    });
  });

program
  .command("agent-setup")
  .description("Show, and with your yes write, the instructions that let a coding assistant keep your privacy policy current (AGENTS.md, the skill, optional Claude Code permission rules); never overwrites a file")
  .option("--dry-run", "show what would be written and write nothing")
  .option("--yes", "write without asking (the assistant has already shown you the plan and you said yes)")
  .option("--claude-ask-rules", "also merge four permission rules into .claude/settings.json so Claude Code always asks before recording an answer or an approval")
  .option("--json", "print the plan as JSON")
  .action(async (opts: { dryRun?: boolean; yes?: boolean; claudeAskRules?: boolean; json?: boolean }) => {
    process.exitCode = await runAgentSetup(process.cwd(), { dryRun: opts.dryRun === true, yes: opts.yes === true, claudeAskRules: opts.claudeAskRules === true, json: opts.json === true });
  });

const ci = program.command("ci").description("Set up continuous review on GitHub");

ci
  .command("init")
  .description("With your yes, write one GitHub workflow (.github/workflows/srclawyer.yml, never over an existing file) and, if there is none, the baseline; commits and pushes nothing")
  .option("--yes", "write without asking")
  .addOption(new Option("--srclawyer-version <spec>", "testing only: what the workflow pins srclawyer-version to").hideHelp())
  .addOption(new Option("--action-ref <ref>", "testing only: the ref of the Action in the workflow").hideHelp())
  .action(async (opts: { yes?: boolean; srclawyerVersion?: string; actionRef?: string }) => {
    if (opts.srclawyerVersion !== undefined && !/^(\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?|github:SrcLawyer\/srclawyer#[0-9a-f]{40})$/.test(opts.srclawyerVersion)) {
      return program.error("error: --srclawyer-version must be an exact version, or github:SrcLawyer/srclawyer#<40-character commit sha>");
    }
    if (opts.actionRef !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(opts.actionRef)) return program.error("error: --action-ref is not a valid ref");
    process.exitCode = await runCiInit(process.cwd(), { yes: opts.yes === true, versionSpec: opts.srclawyerVersion, actionRef: opts.actionRef });
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

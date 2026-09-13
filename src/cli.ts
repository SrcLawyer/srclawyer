#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runScan } from "./commands/scan.js";

const program = new Command();

program
  .name("srclawyer")
  .description("Static analysis engine that derives privacy policy documentation directly from source code")
  .version("0.1.0");

program
  .command("init")
  .description("One-time setup: jurisdiction, markets, industry")
  .action(async () => {
    await runInit(process.cwd());
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

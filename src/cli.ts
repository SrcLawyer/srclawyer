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

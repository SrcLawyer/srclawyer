// Runs Claude Code headless for one conversation turn and normalises its stream-json output.
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The desktop app keeps one folder per Claude Code version and moves on when it updates, so use the newest one
// (or CLAUDE_BIN). The version that ran is printed by run.mts and recorded in docs/transcript-tests.md.
function findClaude(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const root = join(process.env.HOME ?? "", "Library/Application Support/Claude/claude-code");
  const versions = existsSync(root) ? readdirSync(root).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
  for (const version of versions.reverse()) {
    for (const build of readdirSync(join(root, version))) {
      const bin = join(root, version, build, "claude.app/Contents/MacOS/claude");
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error("Claude Code not found; set CLAUDE_BIN");
}
export const CLAUDE = findClaude();

export interface ToolCall {
  name: string;
  /** For Bash, the command line. */
  command: string | null;
  input: Record<string, unknown>;
  turn: number;
}

export interface TurnResult {
  prompt: string;
  sessionId: string;
  /** Assistant text blocks in order. */
  texts: string[];
  tools: ToolCall[];
  resultText: string;
  costUsd: number;
  permissionDenials: number;
  raw: unknown[];
}

const ALLOWED = [
  "Read", "Glob", "Grep",
  "Bash(srclawyer *)",
  "Bash(npx --no-install srclawyer *)",
  "Bash(ls *)", "Bash(cat *)", "Bash(echo *)", "Bash(head *)", "Bash(grep *)", "Bash(git status*)", "Bash(git diff*)", "Bash(pwd)",
];

export async function claudeTurn(opts: { cwd: string; prompt: string; resume?: string; turn: number; env: NodeJS.ProcessEnv; maxBudgetUsd?: number }): Promise<TurnResult> {
  const args = [
    "-p", opts.prompt,
    "--output-format", "stream-json", "--verbose",
    "--permission-mode", "dontAsk",
    "--allowedTools", ...ALLOWED,
    "--setting-sources", "project,local",
    "--max-budget-usd", String(opts.maxBudgetUsd ?? 2),
  ];
  if (opts.resume) args.push("--resume", opts.resume);
  const child = spawn(CLAUDE, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const code: number = await new Promise((resolve) => child.on("close", (c) => resolve(c ?? 1)));

  const raw: unknown[] = [];
  const texts: string[] = [];
  const tools: ToolCall[] = [];
  let sessionId = opts.resume ?? "";
  let resultText = "";
  let costUsd = 0;
  let permissionDenials = 0;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    raw.push(event);
    if (event.session_id) sessionId = event.session_id;
    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if (block.type === "text" && typeof block.text === "string") texts.push(block.text);
        if (block.type === "tool_use") {
          tools.push({ name: block.name, command: block.name === "Bash" ? String(block.input?.command ?? "") : null, input: block.input ?? {}, turn: opts.turn });
        }
      }
    }
    if (event.type === "result") {
      resultText = String(event.result ?? "");
      costUsd = Number(event.total_cost_usd ?? 0);
      permissionDenials = Array.isArray(event.permission_denials) ? event.permission_denials.length : 0;
    }
  }
  if (code !== 0 && !resultText) throw new Error(`claude exited ${code}: ${err.slice(0, 500)}`);
  return { prompt: opts.prompt, sessionId, texts, tools, resultText, costUsd, permissionDenials, raw };
}

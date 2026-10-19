// Runs the transcript scenarios against a real Claude Code (headless) and writes the transcripts.
//   npx tsx scripts/transcript/run.mts S2 --n 5
// Manual or nightly; it spends model usage. See docs/transcript-tests.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeTurn, type ToolCall } from "./claude.mts";
import { analyticsProject, bareProject, envWith, makeShimDir } from "./fixtures.mts";
import { check, nextReply, OPENING, type Reply, type ScenarioId, type SimState } from "./scenarios.mts";

const scenario = (process.argv[2] ?? "S2") as ScenarioId;
const n = Number(process.argv[process.argv.indexOf("--n") + 1] ?? 1) || 1;
const outDir = process.env.TRANSCRIPT_DIR ?? join(process.cwd(), "transcripts");
mkdirSync(outDir, { recursive: true });

const shim = makeShimDir();
const env = envWith(shim);
let totalCost = 0;
const summary: Array<{ run: number; pass: boolean; turns: number; cost: number; violations: string[]; notes: string[] }> = [];

for (let run = 1; run <= n; run++) {
  const root = scenario === "S1" ? bareProject() : analyticsProject(shim, scenario === "S5");
  const state: SimState = { scenario, ambiguousSent: false, confirmed: false, turns: 0 };
  const replies: Reply[] = [{ index: 0, text: OPENING[scenario], kinds: [] }];
  const tools: ToolCall[] = [];
  const texts: string[] = [];
  const log: Array<{ role: string; text: string }> = [];
  let sessionId: string | undefined;
  let cost = 0;
  let prompt = OPENING[scenario];
  let turn = 0;
  let error: string | null = null;

  try {
    for (;;) {
      log.push({ role: "owner", text: prompt });
      const result = await claudeTurn({ cwd: root, prompt, resume: sessionId, turn, env });
      sessionId = result.sessionId;
      tools.push(...result.tools);
      texts.push(...result.texts);
      cost += result.costUsd;
      for (const t of result.tools) log.push({ role: "tool", text: `${t.name}: ${t.command ?? JSON.stringify(t.input).slice(0, 300)}` });
      const reply = result.resultText || result.texts.at(-1) || "";
      log.push({ role: "assistant", text: reply });
      const next = nextReply(reply, state);
      if (!next) break;
      turn += 1;
      replies.push({ index: turn, text: next.text, kinds: next.kinds });
      prompt = next.text;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const verdict = check(scenario, tools, replies, texts, root);
  if (error) verdict.violations.push(`harness error: ${error}`);
  totalCost += cost;
  summary.push({ run, pass: verdict.pass && !error, turns: turn + 1, cost, violations: verdict.violations, notes: verdict.notes });
  writeFileSync(join(outDir, `${scenario}-${run}.json`), JSON.stringify({ scenario, run, root, replies, log, tools, verdict, cost }, null, 2));
  console.log(`${scenario} run ${run}: ${verdict.pass && !error ? "PASS" : "FAIL"}  turns=${turn + 1}  cost=$${cost.toFixed(2)}  ${verdict.violations.join(" | ")}  [${verdict.notes.join("; ")}]`);
}

const passed = summary.filter((s) => s.pass).length;
console.log(`\n${scenario}: ${passed}/${n} passed, total cost $${totalCost.toFixed(2)}`);
writeFileSync(join(outDir, `${scenario}-summary.json`), JSON.stringify({ scenario, passed, n, totalCost, summary }, null, 2));
process.exit(passed === n ? 0 : 1);

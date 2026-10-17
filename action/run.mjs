// Entry point of the SrcLawyer drift-check Action (see ../action.yml). Plain ESM with no dependencies,
// so it runs on a hosted runner with nothing but Node. The pure parts are exported and unit-tested
// (tests/actionRun.test.ts); main() wires them to the runner, with every side effect injectable.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const COMMENT_MARKER = "<!-- srclawyer-drift-check -->";

// Exact versions or one pinned commit only: a floating spec would make the same workflow pass today
// and fail tomorrow with no change in the repository.
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const PINNED_COMMIT = /^github:SrcLawyer\/srclawyer#[0-9a-f]{40}$/;

export function validateVersionSpec(spec) {
  const value = (spec ?? "").trim();
  if (value === "") return { ok: false, reason: "srclawyer-version is required" };
  if (EXACT_VERSION.test(value) || PINNED_COMMIT.test(value)) return { ok: true, spec: value };
  return {
    ok: false,
    reason: `srclawyer-version must be an exact version such as 0.7.0, or github:SrcLawyer/srclawyer#<40-character commit sha> (got "${value}"; latest, ranges, tags and branch names are not accepted because they can change under a pinned workflow)`,
  };
}

const truthy = (value, fallback) => (value === undefined || value === "" ? fallback : /^(true|1|yes)$/i.test(value.trim()));

export function readInputs(env) {
  return {
    version: env.INPUT_SRCLAWYER_VERSION,
    inventoryPath: env.INPUT_INVENTORY_PATH || ".srclawyer.inventory.json",
    path: env.INPUT_PATH || ".",
    failOnDrift: truthy(env.INPUT_FAIL_ON_DRIFT, true),
    failOnInconclusive: truthy(env.INPUT_FAIL_ON_INCONCLUSIVE, false),
    prComment: truthy(env.INPUT_PR_COMMENT, false),
    token: env.INPUT_GITHUB_TOKEN || "",
  };
}

/** The command a maintainer runs to accept a change: the pinned CLI, so it matches what the check used. */
export function fixCommand(spec) {
  const target = EXACT_VERSION.test(spec) ? `srclawyer@${spec}` : spec;
  return `npx ${target} scan --write-inventory`;
}

export function flattenDiff(diff) {
  const items = (prefix, values) => values.map((v) => `${prefix}:${v}`);
  return {
    added: [...items("category", diff.added.categories), ...items("processor", diff.added.processors)],
    removed: [...items("category", diff.removed.categories), ...items("processor", diff.removed.processors)],
  };
}

/**
 * Exit code 0/1/3 from `srclawyer check` map to no-drift / drift / inconclusive; anything else -- exit 2,
 * a missing or unparseable report, an install failure -- is an error, which always fails the step.
 */
export function decideOutcome({ exitCode, report, failOnDrift, failOnInconclusive }) {
  const known = { 0: "no-drift", 1: "drift", 3: "inconclusive" };
  const result = known[exitCode];
  if (result === undefined || !report || report.result !== result) {
    return { result: "error", failed: true, level: "error", message: report?.error ?? `srclawyer check failed (exit code ${exitCode}) without a usable report` };
  }
  if (result === "no-drift") return { result, failed: false, level: null, message: "No drift: the code matches the committed inventory." };
  if (result === "drift") {
    const { added, removed } = flattenDiff(report.diff);
    const parts = [added.length ? `added ${added.join(", ")}` : null, removed.length ? `removed ${removed.join(", ")}` : null].filter(Boolean);
    return { result, failed: failOnDrift, level: failOnDrift ? "error" : "warning", message: `Drift detected: ${parts.join("; ")}.` };
  }
  return {
    result,
    failed: failOnInconclusive,
    level: failOnInconclusive ? "error" : "warning",
    message: `No drift verdict: ${report.inconclusiveReasons.length} problem(s) made the scan incomplete or not comparable.`,
  };
}

const code = (values) => (values.length ? values.map((v) => `\`${v}\``).join(", ") : "—");

export function renderSummary({ outcome, report, spec, inventoryPath }) {
  const lines = [];
  if (outcome.result === "no-drift") {
    lines.push("## SrcLawyer drift check: no drift", "", `The data categories and processors in the code match \`${inventoryPath}\`.`);
  } else if (outcome.result === "drift") {
    const { diff } = report;
    lines.push(
      "## SrcLawyer drift check: drift detected",
      "",
      "| | Added | Removed |",
      "|---|---|---|",
      `| Data categories | ${code(diff.added.categories)} | ${code(diff.removed.categories)} |`,
      `| Processors | ${code(diff.added.processors)} | ${code(diff.removed.processors)} |`,
      "",
      `**To fix:** if this change is intended, update your privacy policy, then run \`${fixCommand(spec)}\` and commit \`${inventoryPath}\`.`
    );
    if (report.baseline && report.baseline.srclawyerVersion !== report.srclawyerVersion) {
      lines.push("", `_The baseline was written by srclawyer ${report.baseline.srclawyerVersion}; this check ran ${report.srclawyerVersion}. Detection rules can change between versions._`);
    }
  } else if (outcome.result === "inconclusive") {
    lines.push("## SrcLawyer drift check: inconclusive", "", "No drift verdict was reached, because the scan was not complete or not comparable with the baseline:", "");
    for (const reason of report.inconclusiveReasons) lines.push(`- ${reason}`);
    lines.push("", "This is not drift. Re-run the check; if it persists, resolve the problem above (or set `fail-on-inconclusive: false`, the default, to keep it a warning).");
  } else {
    lines.push("## SrcLawyer drift check: error", "", outcome.message);
  }
  return lines.join("\n") + "\n";
}

export function renderComment({ outcome, report, spec, inventoryPath }) {
  return `${COMMENT_MARKER}\n${renderSummary({ outcome, report, spec, inventoryPath })}`;
}

// Workflow-command values: % \r \n must be escaped or they would terminate or split the annotation.
export function escapeAnnotation(text) {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function defaultDeps() {
  return {
    env: process.env,
    run: (command, args, options) => spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options }),
    appendFile: appendFileSync,
    readFile: (p) => readFileSync(p, "utf8"),
    log: (line) => process.stdout.write(`${line}\n`),
  };
}

function setOutputs(deps, values) {
  const file = deps.env.GITHUB_OUTPUT;
  if (!file) return;
  deps.appendFile(file, Object.entries(values).map(([k, v]) => `${k}=${String(v).replace(/[\r\n]+/g, " ")}\n`).join(""));
}

function postComment(deps, { inputs, outcome, report, spec }) {
  const notice = (message) => deps.log(`::notice title=SrcLawyer drift check::${escapeAnnotation(message)}`);
  const warn = (message) => deps.log(`::warning title=SrcLawyer drift check::${escapeAnnotation(message)}`);
  if (deps.env.GITHUB_EVENT_NAME !== "pull_request" || !deps.env.GITHUB_EVENT_PATH) return notice("pr-comment skipped: not a pull_request event.");
  if (!inputs.token) return warn("pr-comment skipped: no github-token.");

  let event;
  try {
    event = JSON.parse(deps.readFile(deps.env.GITHUB_EVENT_PATH));
  } catch {
    return warn("pr-comment skipped: could not read the event payload.");
  }
  const repo = deps.env.GITHUB_REPOSITORY;
  const number = event.pull_request?.number;
  if (!repo || !number) return warn("pr-comment skipped: could not determine the pull request.");
  if (event.pull_request?.head?.repo?.full_name !== repo) return notice("pr-comment skipped: pull requests from forks get a read-only token.");

  const gh = (args) => deps.run("gh", args, { env: { ...deps.env, GH_TOKEN: inputs.token } });
  const listed = gh(["api", "--paginate", `repos/${repo}/issues/${number}/comments`, "--jq", ".[] | {id, body}"]);
  if (listed.error || listed.status !== 0) return warn("pr-comment skipped: could not list comments (is `gh` available, and does the token have pull-requests: write?).");
  const existing = listed.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((c) => typeof c.body === "string" && c.body.includes(COMMENT_MARKER));

  if (outcome.result === "no-drift" && !existing) return;
  const body = renderComment({ outcome, report, spec, inventoryPath: inputs.inventoryPath });
  const sent = existing
    ? gh(["api", "-X", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "-f", `body=${body}`])
    : gh(["api", "-X", "POST", `repos/${repo}/issues/${number}/comments`, "-f", `body=${body}`]);
  if (sent.error || sent.status !== 0) warn("pr-comment failed (the check result is unaffected).");
}

/** Returns the process exit code. */
export function main(deps = defaultDeps()) {
  const inputs = readInputs(deps.env);
  const fail = (message) => {
    deps.log(`::error title=SrcLawyer drift check::${escapeAnnotation(message)}`);
    setOutputs(deps, { result: "error", added: "", removed: "" });
    if (deps.env.GITHUB_STEP_SUMMARY) deps.appendFile(deps.env.GITHUB_STEP_SUMMARY, `## SrcLawyer drift check: error\n\n${message}\n`);
    return 1;
  };

  const validated = validateVersionSpec(inputs.version);
  if (!validated.ok) return fail(validated.reason);
  const spec = validated.spec;

  const temp = deps.env.RUNNER_TEMP || deps.env.TMPDIR || "/tmp";
  const prefix = join(temp, "srclawyer-action");
  mkdirSync(prefix, { recursive: true });
  deps.log(`::group::Install srclawyer (${spec})`);
  const installed = deps.run("npm", ["install", "--prefix", prefix, "--no-audit", "--no-fund", "--loglevel=error", EXACT_VERSION.test(spec) ? `srclawyer@${spec}` : spec], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  deps.log("::endgroup::");
  if (installed.error || installed.status !== 0) return fail(`could not install srclawyer (${spec}) with npm.`);

  const cwd = resolve(inputs.path);
  const checked = deps.run("node", [join(prefix, "node_modules", "srclawyer", "dist", "cli.js"), "check", "--format", "json", "--inventory", inputs.inventoryPath], { cwd });
  if (checked.stderr) deps.log(checked.stderr.trimEnd());

  let report = null;
  try {
    report = JSON.parse(checked.stdout);
  } catch {
    report = null;
  }
  const outcome = decideOutcome({ exitCode: checked.status, report, failOnDrift: inputs.failOnDrift, failOnInconclusive: inputs.failOnInconclusive });

  const flat = outcome.result === "drift" ? flattenDiff(report.diff) : { added: [], removed: [] };
  setOutputs(deps, { result: outcome.result, added: flat.added.join(","), removed: flat.removed.join(",") });
  if (outcome.level) deps.log(`::${outcome.level} title=SrcLawyer drift check::${escapeAnnotation(outcome.message)}`);
  else deps.log(outcome.message);

  const summaryInput = { outcome, report, spec, inventoryPath: inputs.inventoryPath };
  if (deps.env.GITHUB_STEP_SUMMARY) deps.appendFile(deps.env.GITHUB_STEP_SUMMARY, renderSummary(summaryInput));
  if (inputs.prComment && report) postComment(deps, { inputs, outcome, report, spec });

  return outcome.failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}

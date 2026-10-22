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
    mode: (env.INPUT_MODE || "check").trim().toLowerCase(),
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
  if (result === "no-drift") return { result, failed: false, level: null, message: "No new items found by the scanner. This is not a statement that your product or your policy is compliant." };
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

// Verbatim from docs/question-catalog.md section 5 (tests/questionCatalogSync.test.ts checks it).
export const NO_DRIFT_STATEMENT =
  "No new items found by the scanner since your last approved review. This is not a statement that your product or your policy is compliant.";

const code = (values) => (values.length ? values.map((v) => `\`${v}\``).join(", ") : "—");

export function renderSummary({ outcome, report, spec, inventoryPath }) {
  const lines = [];
  if (outcome.result === "no-drift") {
    lines.push("## SrcLawyer: no new items found", "", NO_DRIFT_STATEMENT);
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
  if (report?.coverage && outcome.result !== "error") lines.push("", report.coverage);
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


// ---------------------------------------------------------------------------------------------------
// mode: review (docs/question-catalog.md section 7). The wording and the renderers live in the installed
// CLI (dist/report/reviewText.js), so the Action holds no copy of them; this part gathers the facts,
// calls GitHub, and never lets a GitHub failure change the result.
// ---------------------------------------------------------------------------------------------------
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { posix, relative, basename } from "node:path";

export const REVIEW_DIRNAME = "srclawyer-review";

async function loadReviewText(prefix) {
  const file = join(prefix, "node_modules", "srclawyer", "dist", "report", "reviewText.js");
  return import(pathToFileURL(file).href);
}

function reviewDeps(deps) {
  return {
    exists: existsSync,
    listDir: (p) => readdirSync(p),
    copyFile: copyFileSync,
    loadText: loadReviewText,
    ...deps,
  };
}

/** The pinned CLI as `npx` is told to run it. */
export function npxTarget(spec) {
  return EXACT_VERSION.test(spec) ? `srclawyer@${spec}` : spec;
}

function parseLines(stdout) {
  return (stdout ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((v) => v !== null);
}

/** Repo-relative path of the baseline, or null if it points outside the repository. */
export function baselineRepoPath(path, inventoryPath) {
  const joined = posix.normalize(posix.join(path.replace(/\\/g, "/"), inventoryPath.replace(/\\/g, "/")));
  if (joined.startsWith("../") || joined === ".." || posix.isAbsolute(joined)) return null;
  return joined.replace(/^\.\//, "");
}

export async function mainReview(rawDeps = defaultDeps()) {
  const deps = reviewDeps(rawDeps);
  const inputs = readInputs(deps.env);
  const note = (message) => deps.log(`::notice title=SrcLawyer::${escapeAnnotation(message)}`);
  const warn = (message) => deps.log(`::warning title=SrcLawyer::${escapeAnnotation(message)}`);
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
  const installed = deps.run("npm", ["install", "--prefix", prefix, "--no-audit", "--no-fund", "--loglevel=error", npxTarget(spec)], { stdio: ["ignore", "inherit", "inherit"] });
  deps.log("::endgroup::");
  if (installed.error || installed.status !== 0) return fail(`could not install srclawyer (${spec}) with npm.`);

  let text;
  try {
    text = await deps.loadText(prefix);
    if (typeof text.renderRunSummary !== "function") throw new Error("no review mode");
  } catch {
    return fail(`srclawyer ${spec} does not have the review mode. Use 0.10.0 or later, or set mode to check.`);
  }

  const cwd = resolve(inputs.path);
  const outDir = join(temp, REVIEW_DIRNAME);
  mkdirSync(outDir, { recursive: true });
  const updated = deps.run("node", [join(prefix, "node_modules", "srclawyer", "dist", "cli.js"), "update", "--format", "json", "--inventory", inputs.inventoryPath, "--out-dir", relative(cwd, outDir)], { cwd });
  if (updated.stderr) deps.log(updated.stderr.trimEnd());

  let report = null;
  try {
    report = JSON.parse(updated.stdout);
  } catch {
    report = null;
  }

  // Exit codes as for `check`: 0 no new items (or a first review), 1 new items, 3 inconclusive; anything else is an error.
  const known = { 0: "no-drift", 1: "drift", 3: "inconclusive" };
  let result = known[updated.status];
  if (result === undefined || !report || report.result !== result) result = "error";
  const failed = result === "error" || (result === "drift" && inputs.failOnDrift) || (result === "inconclusive" && inputs.failOnInconclusive);
  const level = result === "error" ? "error" : failed ? "error" : result === "drift" ? "warning" : result === "inconclusive" ? "warning" : null;
  const errorMessage = report?.error ?? `srclawyer update failed (exit code ${updated.status}). See the log above.`;
  const firstReview = result === "no-drift" && report?.firstReview === true;

  const flat = result === "drift" ? flattenDiff(report.diff) : { added: [], removed: [] };
  setOutputs(deps, { result, added: flat.added.join(","), removed: flat.removed.join(",") });

  const A = text.ACTION;
  if (result === "error") deps.log(`::error title=SrcLawyer drift check::${escapeAnnotation(errorMessage)}`);
  else if (firstReview) warn(A.noteFirst);
  else if (result === "drift") deps.log(`::${level} title=SrcLawyer::${escapeAnnotation(A.noteLook)}`);
  else if (result === "inconclusive") deps.log(`::${level} title=SrcLawyer drift check::${escapeAnnotation(`No drift verdict: ${report.inconclusiveReasons.length} problem(s) made the scan incomplete or not comparable.`)}`);

  // ---- what happened, as a view the renderers understand ----
  const questions = (report?.questions ?? []).map((q) => ({ ask: q.ask, sensitive: q.sensitive === true }));
  let view;
  let fingerprint = null;
  if (result === "error") view = { kind: "error", message: errorMessage };
  else if (result === "inconclusive") view = { kind: "inconclusive", reasons: report.inconclusiveReasons };
  else if (result === "drift") {
    view = { kind: "drift", changes: text.buildChangeLines(report.diff, false, { bold: true, onlyKnown: true }), questions, baselineChanged: false };
    fingerprint = text.fingerprintOf(text.diffItems(report.diff));
  } else if (firstReview) {
    let baselineText = null;
    try {
      baselineText = deps.readFile(join(cwd, inputs.inventoryPath));
    } catch {
      baselineText = null;
    }
    const found = baselineText === null ? null : text.firstReviewLines(baselineText);
    if (found) {
      view = { kind: "first-review", lines: found.lines, questions };
      fingerprint = text.fingerprintOf(found.items);
    } else view = { kind: "no-drift" };
  } else view = { kind: "no-drift" };

  // ---- artifacts: the generated policy joins the draft and the review file when `update` rewrote it itself ----
  if (report?.policy?.written) {
    try {
      deps.copyFile(join(cwd, report.policy.path), join(outDir, basename(report.policy.path)));
    } catch {
      /* the artifact is a convenience */
    }
  }
  let artifacts = false;
  try {
    artifacts = deps.listDir(outDir).length > 0;
  } catch {
    artifacts = false;
  }

  const eventName = deps.env.GITHUB_EVENT_NAME;
  const repo = deps.env.GITHUB_REPOSITORY;
  const runLink = deps.env.GITHUB_SERVER_URL && repo && deps.env.GITHUB_RUN_ID ? `${deps.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${deps.env.GITHUB_RUN_ID}` : null;
  const ctx = { target: npxTarget(spec), coverage: report && result !== "error" ? report.coverage : null, runLink };
  const gh = (args) => deps.run("gh", args, { env: { ...deps.env, GH_TOKEN: inputs.token } });

  let event = null;
  if (deps.env.GITHUB_EVENT_PATH) {
    try {
      event = JSON.parse(deps.readFile(deps.env.GITHUB_EVENT_PATH));
    } catch {
      event = null;
    }
  }

  const isPullRequest = eventName === "pull_request";
  const pr = isPullRequest ? event?.pull_request : null;
  const fork = isPullRequest && Boolean(pr) && pr.head?.repo?.full_name !== repo;
  let commentFailed = false;

  // ---- pull request: one comment, kept up to date (cases A to D) ----
  let postComment = null;
  if (isPullRequest && pr && repo && inputs.token) {
    if (view.kind === "drift" || view.kind === "no-drift") {
      const detected = detectBaselineChange({ gh, repo, pr, cwd, inputs, deps, text });
      if (detected.failed) commentFailed = true;
      else if (detected.change) {
        if (view.kind === "no-drift") view = { kind: "baseline-changed", change: detected.change };
        else view.baselineChanged = true;
      }
    }
    postComment = () => {
      if (fork) return note(A.noteFork);
      if (!["drift", "no-drift", "baseline-changed"].includes(view.kind)) return;
      const listed = gh(["api", "--paginate", `repos/${repo}/issues/${pr.number}/comments`, "--jq", ".[] | {id, body}"]);
      if (listed.error || listed.status !== 0) return warn(A.noteCommentFailed);
      const existing = parseLines(listed.stdout).find((c) => typeof c.body === "string" && c.body.includes(text.COMMENT_MARKER));
      if (view.kind === "no-drift" && !existing) return;
      const body = text.renderComment(view, ctx);
      const sent = existing
        ? gh(["api", "-X", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "-f", `body=${body}`])
        : gh(["api", "-X", "POST", `repos/${repo}/issues/${pr.number}/comments`, "-f", `body=${body}`]);
      if (sent.error || sent.status !== 0) warn(A.noteCommentFailed);
    };
  }

  // ---- default branch, schedule, manual run: one issue, kept up to date and never closed (7.4) ----
  let postIssue = null;
  if (["push", "schedule", "workflow_dispatch"].includes(eventName) && repo && inputs.token) {
    const defaultBranch = event?.repository?.default_branch;
    const onDefault = defaultBranch ? deps.env.GITHUB_REF === `refs/heads/${defaultBranch}` : false;
    if (!onDefault) {
      if (eventName === "workflow_dispatch") note(A.noteNotDefault);
    } else {
      postIssue = () => {
        if (!["drift", "first-review", "no-drift"].includes(view.kind)) return;
        const listed = gh(["api", "--paginate", `repos/${repo}/issues?state=all&per_page=100`, "--jq", ".[] | select(.pull_request == null) | {number, title, state, body}"]);
        if (listed.error || listed.status !== 0) return warn(A.noteIssueFailed);
        const ours = parseLines(listed.stdout)
          .filter((i) => i.title === A.issueTitle && typeof i.body === "string" && i.body.includes(text.COMMENT_MARKER))
          .sort((a, b) => b.number - a.number);
        const open = ours.find((i) => i.state === "open");
        const closed = ours.find((i) => i.state === "closed");
        if (view.kind === "no-drift" && !open) return;
        const body = text.renderIssue(view, ctx, fingerprint ?? "");
        if (open) {
          const sent = gh(["api", "-X", "PATCH", `repos/${repo}/issues/${open.number}`, "-f", `body=${body}`]);
          if (sent.error || sent.status !== 0) warn(A.noteIssueFailed);
          return;
        }
        const closedFingerprint = closed ? text.FINGERPRINT_PATTERN.exec(closed.body)?.[1] : null;
        if (closedFingerprint && closedFingerprint === fingerprint) return note(A.noteIssueClosed);
        const sent = gh(["api", "-X", "POST", `repos/${repo}/issues`, "-f", `title=${A.issueTitle}`, "-f", `body=${body}`]);
        if (sent.error || sent.status !== 0) warn(A.noteIssueFailed);
      };
    }
  }

  if (commentFailed) warn(A.noteCommentFailed);
  if (deps.env.GITHUB_STEP_SUMMARY) {
    deps.appendFile(deps.env.GITHUB_STEP_SUMMARY, text.renderRunSummary(view, ctx, { issueText: !isPullRequest, artifacts, fork }));
  }
  if (!commentFailed) postComment?.();
  postIssue?.();

  return failed ? 1 : 0;
}

/**
 * Whether this pull request changes the baseline file, and what it changes. Compares the baseline at the
 * point the branch left its base with the one in the pull request. A pull request that adds the very first
 * baseline changes nothing that was approved, so it reports no change. Any API problem is a failure, never a guess.
 */
export function detectBaselineChange({ gh, repo, pr, cwd, inputs, deps, text }) {
  const none = { failed: false, change: null };
  const workspace = deps.env.GITHUB_WORKSPACE || process.cwd();
  const repoPath = baselineRepoPath(relative(workspace, cwd) || ".", inputs.inventoryPath);
  if (!repoPath) return none;
  const files = gh(["api", "--paginate", `repos/${repo}/pulls/${pr.number}/files`, "--jq", ".[].filename"]);
  if (files.error || files.status !== 0) return { failed: true, change: null };
  if (!files.stdout.split("\n").includes(repoPath)) return none;

  const base = gh(["api", `repos/${repo}/compare/${pr.base?.sha}...${pr.head?.sha}`, "--jq", ".merge_base_commit.sha"]);
  if (base.error || base.status !== 0) return { failed: true, change: null };
  const before = gh(["api", "-H", "Accept: application/vnd.github.raw+json", `repos/${repo}/contents/${encodeURI(repoPath)}?ref=${base.stdout.trim()}`]);
  if (before.error || before.status !== 0) return none; // not in the base branch yet: there is no earlier review state to change
  let after;
  try {
    after = deps.readFile(join(cwd, inputs.inventoryPath));
  } catch {
    return { failed: true, change: null };
  }
  const change = text.describeBaselineChange(before.stdout, after);
  return { failed: false, change };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = readInputs(process.env).mode;
  if (mode === "review") {
    mainReview().then((code) => {
      process.exitCode = code;
    });
  } else if (mode === "check") {
    process.exitCode = main();
  } else {
    process.stdout.write(`::error title=SrcLawyer drift check::mode must be "check" or "review" (got "${mode}")\n`);
    process.exitCode = 1;
  }
}

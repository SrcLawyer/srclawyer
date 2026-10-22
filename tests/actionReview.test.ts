import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error -- plain ESM with no type declarations; this is the file the Action actually runs.
import * as action from "../action/run.mjs";
import * as text from "../src/report/reviewText.js";

const COVERAGE = "Coverage: scanned 3 files (git discovery) for personal data read from requests in JavaScript/TypeScript (Express, Next.js) and Python (Flask), and for 18 known third-party services. Not covered: other languages and frameworks, calls to third-party services made with plain HTTP, scripts your pages load at runtime, and data handled outside this repository. AI-assisted review is off.";
const BASELINE = (processors: string[], categories: string[], approval?: { review: string; note: string }) =>
  JSON.stringify({ schema: 1, srclawyerVersion: "0.10.0", discovery: "git", categories, processors, ...(approval ? { approval } : {}) }, null, 2) + "\n";

const REPORT_BASE = {
  schema: 1,
  srclawyerVersion: "0.10.0",
  baseline: { path: ".srclawyer.inventory.json", srclawyerVersion: "0.10.0", discovery: "git", approved: true },
  inconclusiveReasons: [],
  error: null,
  coverage: COVERAGE,
  // Fields a hostile or careless report could carry; none of them may reach a comment, an issue or a summary.
  draft: { path: "src/secret/internal-billing.ts", written: true, skippedReason: null },
  review: { path: "PRIVACY_POLICY.review.md", written: true, skippedReason: null },
  policy: null,
  firstReview: false,
};
const DRIFT = {
  ...REPORT_BASE,
  result: "drift",
  exitCode: 1,
  diff: { added: { categories: ["phone"], processors: ["Twilio"] }, removed: { categories: [], processors: [] } },
  questions: [{ id: "hasEuUkUsers", field: "hasEuUkUsers", ask: "Do you have users in the European Union or the United Kingdom?", why: "x", sensitive: true, currentAnswer: "not answered" }],
};
const NO_DRIFT = { ...REPORT_BASE, result: "no-drift", exitCode: 0, diff: { added: { categories: [], processors: [] }, removed: { categories: [], processors: [] } }, questions: [] };
const FIRST_REVIEW = { ...NO_DRIFT, firstReview: true, baseline: { ...REPORT_BASE.baseline, approved: false } };
const INCONCLUSIVE = { ...REPORT_BASE, result: "inconclusive", exitCode: 3, diff: null, inconclusiveReasons: ["The confidence service could not be reached."], questions: [] };

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

interface GhCall {
  args: string[];
}

function harness(options: {
  report?: unknown;
  status?: number;
  eventName?: string;
  event?: Record<string, unknown> | null;
  ref?: string;
  inputs?: Record<string, string>;
  baseline?: string;
  /** What `gh` answers, by a fragment of the endpoint; unmatched calls succeed with no output. */
  gh?: Array<{ match: string; method?: string; status?: number; stdout?: string }>;
  ghDefault?: { status: number; stdout: string };
  loadText?: () => Promise<unknown>;
  writeOutFiles?: boolean;
}) {
  dir = mkdtempSync(join(tmpdir(), "srclawyer-review-"));
  const work = join(dir, "work");
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, ".srclawyer.inventory.json"), options.baseline ?? BASELINE(["Twilio"], ["phone"]));
  const eventPath = join(dir, "event.json");
  if (options.event) writeFileSync(eventPath, JSON.stringify(options.event));
  const out = join(dir, "output.txt");
  const summary = join(dir, "summary.md");
  const env: Record<string, string> = {
    INPUT_SRCLAWYER_VERSION: "0.10.0",
    INPUT_MODE: "review",
    INPUT_PATH: work,
    INPUT_GITHUB_TOKEN: "ghs_test_token",
    INPUT_FAIL_ON_DRIFT: "false",
    RUNNER_TEMP: dir,
    GITHUB_OUTPUT: out,
    GITHUB_STEP_SUMMARY: summary,
    GITHUB_REPOSITORY: "acme/app",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_RUN_ID: "123",
    GITHUB_EVENT_NAME: options.eventName ?? "pull_request",
    GITHUB_REF: options.ref ?? "refs/pull/7/merge",
    GITHUB_WORKSPACE: work,
    ...(options.event ? { GITHUB_EVENT_PATH: eventPath } : {}),
    ...options.inputs,
  };
  const calls: Array<{ command: string; args: string[] }> = [];
  const logs: string[] = [];
  const appended = new Map<string, string>();
  const deps = {
    env,
    run: (command: string, args: string[]) => {
      calls.push({ command, args });
      if (command === "npm") return { status: 0, stdout: "", stderr: "" };
      if (command === "node") {
        if (options.writeOutFiles) {
          const outDirArg = args[args.indexOf("--out-dir") + 1];
          const absolute = join(work, outDirArg);
          mkdirSync(absolute, { recursive: true });
          writeFileSync(join(absolute, "PRIVACY_POLICY.review.md"), "review");
        }
        return { status: options.status ?? (options.report as { exitCode?: number })?.exitCode ?? 0, stdout: JSON.stringify(options.report ?? NO_DRIFT), stderr: "" };
      }
      if (command === "gh") {
        const joined = args.join(" ");
        const method = args.includes("PATCH") ? "PATCH" : args.includes("POST") ? "POST" : "GET";
        const hit = options.gh?.find((g) => joined.includes(g.match) && (g.method ?? "GET") === method);
        if (hit) return { status: hit.status ?? 0, stdout: hit.stdout ?? "", stderr: "" };
        return { status: options.ghDefault?.status ?? 0, stdout: options.ghDefault?.stdout ?? "", stderr: "" };
      }
      throw new Error(`unexpected command ${command}`);
    },
    appendFile: (file: string, body: string) => appended.set(file, (appended.get(file) ?? "") + body),
    readFile: (file: string) => readFileSync(file, "utf8"),
    log: (line: string) => logs.push(line),
    loadText: options.loadText ?? (async () => text),
  };
  const ghCalls = () => calls.filter((c) => c.command === "gh").map((c) => c.args);
  const writes = () => ghCalls().filter((a) => a.includes("POST") || a.includes("PATCH"));
  const bodyOf = (args: string[]) => args.find((a) => a.startsWith("body="))!.slice(5);
  return { deps, calls, logs, ghCalls, writes, bodyOf, out: () => appended.get(out) ?? "", summary: () => appended.get(summary) ?? "", work };
}

const PR_EVENT = { pull_request: { number: 7, head: { repo: { full_name: "acme/app" }, sha: "h".repeat(40) }, base: { sha: "b".repeat(40) } } };
const MARKED = (id: number, body = "old") => JSON.stringify({ id, body: `${text.COMMENT_MARKER}\n${body}` }) + "\n";
const COMMENTS = "issues/7/comments";

describe("review mode: the pull-request comment", () => {
  it("case A: creates one marked comment with the changes, the questions and the assistant block", async () => {
    const h = harness({ report: DRIFT, event: PR_EVENT });

    expect(await action.mainReview(h.deps)).toBe(0);

    const posts = h.writes();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain(`repos/acme/app/${COMMENTS}`);
    const body = h.bodyOf(posts[0]);
    expect(body.startsWith(`${text.COMMENT_MARKER}\n## SrcLawyer: your privacy policy needs a quick look`)).toBe(true);
    expect(body).toContain("- Your code now uses **Twilio**.");
    expect(body).toContain("- Your code now appears to handle **phone numbers**.");
    expect(body).toContain("1 question needs your answer.\n- Do you have users in the European Union or the United Kingdom?");
    expect(body).toContain("### Fix it with your AI coding assistant");
    expect(body).toContain("`npx srclawyer@0.10.0 agent-setup`");
    expect(body).not.toContain("This pull request changes the approved review state");
    expect(h.logs.join("\n")).toContain("::warning title=SrcLawyer::Your privacy policy needs a quick look. The details are in the run summary.");
    expect(h.out()).toContain("result=drift");
  });

  it("updates the oldest marked comment on a later push, never adding another or deleting any", async () => {
    const h = harness({
      report: DRIFT,
      event: PR_EVENT,
      gh: [{ match: COMMENTS, stdout: JSON.stringify({ id: 5, body: "someone else" }) + "\n" + MARKED(99) + MARKED(150) }],
    });

    await action.mainReview(h.deps);

    const [write] = h.writes();
    expect(h.writes()).toHaveLength(1);
    expect(write).toContain("PATCH");
    expect(write).toContain("repos/acme/app/issues/comments/99");
    expect(h.ghCalls().some((a) => a.includes("DELETE"))).toBe(false);
  });

  it("case B: adds the baseline-changed notice under the changes when the pull request also changes the baseline", async () => {
    const h = harness({
      report: DRIFT,
      event: PR_EVENT,
      gh: [
        { match: "pulls/7/files", stdout: "src/a.ts\n.srclawyer.inventory.json\n" },
        { match: "compare/", stdout: "m".repeat(40) + "\n" },
        { match: "contents/.srclawyer.inventory.json", stdout: BASELINE(["Stripe"], ["payment_info"]) },
      ],
    });

    await action.mainReview(h.deps);

    const body = h.bodyOf(h.writes()[0]);
    expect(body).toContain("This differs from your last approved review.\n\n**This pull request changes the approved review state.** Reviewer: please confirm that the changes listed above are intended.");
  });

  it("case C: comments when a pull request records changes as reviewed, with nothing new to report, and never shows the approval note", async () => {
    const h = harness({
      report: NO_DRIFT,
      event: PR_EVENT,
      baseline: BASELINE(["Stripe", "Twilio"], ["payment_info", "phone"], { review: "abc", note: "yes ship it [click here](https://evil.example)" }),
      gh: [
        { match: "pulls/7/files", stdout: ".srclawyer.inventory.json\n" },
        { match: "compare/", stdout: "m".repeat(40) + "\n" },
        { match: "contents/.srclawyer.inventory.json", stdout: BASELINE(["Stripe"], ["payment_info"]) },
      ],
    });

    await action.mainReview(h.deps);

    const body = h.bodyOf(h.writes()[0]);
    expect(body).toContain("## SrcLawyer: this pull request changes the approved review state");
    expect(body).toContain("- Services now recorded as reviewed: Twilio.");
    expect(body).toContain("- Kinds of personal data now recorded as reviewed: phone numbers.");
    expect(body).toContain("No new items found by the scanner since your last approved review.");
    expect(body).not.toContain("evil.example");
    expect(body).not.toContain("ship it");
    expect(h.summary()).not.toContain("evil.example");
  });

  it("case C with only the approval record changed says the lists are unchanged", async () => {
    const h = harness({
      report: NO_DRIFT,
      event: PR_EVENT,
      baseline: BASELINE(["Twilio"], ["phone"], { review: "abc", note: "yes" }),
      gh: [
        { match: "pulls/7/files", stdout: ".srclawyer.inventory.json\n" },
        { match: "compare/", stdout: "m".repeat(40) },
        { match: "contents/.srclawyer.inventory.json", stdout: BASELINE(["Twilio"], ["phone"]) },
      ],
    });

    await action.mainReview(h.deps);

    expect(h.bodyOf(h.writes()[0])).toContain("The services and kinds of personal data in the approved review state are unchanged.");
  });

  it("a pull request that adds the very first baseline is not a change of anything approved: no comment", async () => {
    const h = harness({
      report: NO_DRIFT,
      event: PR_EVENT,
      gh: [
        { match: "pulls/7/files", stdout: ".srclawyer.inventory.json\n" },
        { match: "compare/", stdout: "m".repeat(40) },
        { match: "contents/.srclawyer.inventory.json", status: 1, stdout: "" },
      ],
    });

    await action.mainReview(h.deps);

    expect(h.writes()).toEqual([]);
  });

  it("case D: nothing is posted on a clean run, and an earlier comment is rewritten to 'no new items found'", async () => {
    const clean = harness({ report: NO_DRIFT, event: PR_EVENT });
    await action.mainReview(clean.deps);
    expect(clean.writes()).toEqual([]);

    const resolved = harness({ report: NO_DRIFT, event: PR_EVENT, gh: [{ match: COMMENTS, stdout: MARKED(99) }] });
    await action.mainReview(resolved.deps);
    const [write] = resolved.writes();
    expect(write).toContain("repos/acme/app/issues/comments/99");
    expect(resolved.bodyOf(write)).toContain("## SrcLawyer: no new items found");
  });

  it("on a baseline nobody has approved, an earlier comment is rewritten when the drift is gone, and a pull request that rewrites the baseline is still flagged", async () => {
    const resolved = harness({ report: FIRST_REVIEW, event: PR_EVENT, gh: [{ match: COMMENTS, stdout: MARKED(99) }] });
    await action.mainReview(resolved.deps);
    expect(resolved.writes()).toHaveLength(1);
    expect(resolved.writes()[0]).toContain("repos/acme/app/issues/comments/99");
    expect(resolved.bodyOf(resolved.writes()[0])).toContain("## SrcLawyer: no new items found");

    // The base branch's baseline was approved; this pull request's is not (the approval was removed along with an item).
    const stripped = harness({
      report: FIRST_REVIEW,
      event: PR_EVENT,
      baseline: BASELINE(["Twilio"], ["phone"]),
      gh: [
        { match: "pulls/7/files", stdout: ".srclawyer.inventory.json\n" },
        { match: "compare/", stdout: "m".repeat(40) },
        { match: "contents/.srclawyer.inventory.json", stdout: BASELINE(["Stripe", "Twilio"], ["payment_info", "phone"], { review: "a", note: "yes" }) },
      ],
    });
    await action.mainReview(stripped.deps);
    expect(stripped.writes()).toHaveLength(1);
    const body = stripped.bodyOf(stripped.writes()[0]);
    expect(body).toContain("## SrcLawyer: this pull request changes the approved review state");
    expect(body).toContain("- Services no longer recorded: Stripe.");
  });

  it("posts nothing for a first review, an inconclusive run or an error, and the summary explains an inconclusive one", async () => {
    for (const report of [FIRST_REVIEW, INCONCLUSIVE]) {
      const h = harness({ report, event: PR_EVENT });
      await action.mainReview(h.deps);
      expect(h.writes()).toEqual([]);
    }
    const inconclusive = harness({ report: INCONCLUSIVE, event: PR_EVENT, writeOutFiles: true });
    expect(await action.mainReview(inconclusive.deps)).toBe(0);
    expect(inconclusive.summary()).toContain("## SrcLawyer: couldn't finish checking");
    expect(inconclusive.summary()).toContain("- The confidence service could not be reached.");
    expect(inconclusive.summary()).not.toContain("artifact");

    const broken = harness({ report: { result: "error", error: "no baseline found" }, status: 2, event: PR_EVENT });
    expect(await action.mainReview(broken.deps)).toBe(1);
    expect(broken.writes()).toEqual([]);
    expect(broken.summary()).toContain("no baseline found");
  });

  it("a pull request from a fork gets no comment, and the run summary carries the content", async () => {
    const fork = { pull_request: { ...PR_EVENT.pull_request, head: { repo: { full_name: "evil/app" }, sha: "h".repeat(40) } } };
    const h = harness({ report: DRIFT, event: fork, writeOutFiles: true });

    expect(await action.mainReview(h.deps)).toBe(0);

    expect(h.writes()).toEqual([]);
    expect(h.summary().startsWith("This pull request comes from a fork, so no comment was posted and the result is shown here instead.")).toBe(true);
    expect(h.summary()).toContain("- Your code now uses **Twilio**.");
    expect(h.summary()).toContain('The policy draft and the review file are attached to this run as the artifact "srclawyer-review". They are kept for 7 days.');
    expect(h.logs.join("\n")).toContain("No comment was posted because this pull request comes from a fork.");
  });

  it("a failing gh is a warning, never a different result", async () => {
    const h = harness({ report: DRIFT, event: PR_EVENT, ghDefault: { status: 1, stdout: "" } });

    expect(await action.mainReview(h.deps)).toBe(0);

    expect(h.logs.join("\n")).toContain("Couldn't post the comment. Check that the job has pull-requests: write.");
    expect(h.out()).toContain("result=drift");
  });

  it("fail-on-drift true fails the step, false does not", async () => {
    const strict = harness({ report: DRIFT, event: PR_EVENT, inputs: { INPUT_FAIL_ON_DRIFT: "true" } });
    expect(await action.mainReview(strict.deps)).toBe(1);
    expect(strict.logs.join("\n")).toContain("::error title=SrcLawyer::Your privacy policy needs a quick look.");
  });

  it("shows sensitive questions first, five of them, and folds the rest into a collapsed block", async () => {
    const q = (n: number, sensitive: boolean) => ({ id: `q${n}`, field: `q${n}`, ask: `Question ${n}?`, why: "", sensitive, currentAnswer: "not answered" });
    const questions = [q(1, false), q(2, false), q(3, true), q(4, false), q(5, false), q(6, true), q(7, false)];
    const h = harness({ report: { ...DRIFT, questions }, event: PR_EVENT });

    await action.mainReview(h.deps);

    const body = h.bodyOf(h.writes()[0]);
    expect(body).toContain("7 questions need your answers.\n- Question 3?\n- Question 6?\n- Question 1?\n- Question 2?\n- Question 4?\n\n<details><summary>2 more questions</summary>\n\n- Question 5?\n- Question 7?\n</details>");
  });

  it("never carries a path, a source line or text from the repository, even when the report does", async () => {
    const hostile = {
      ...DRIFT,
      diff: { added: { categories: ["phone"], processors: ["Twilio"] }, removed: { categories: ["[evil](https://evil.example)"], processors: ["<script>alert(1)</script>"] } },
      inconclusiveReasons: ["src/secret/internal-billing.ts:42"],
    };
    const h = harness({ report: hostile, event: PR_EVENT, writeOutFiles: true });

    await action.mainReview(h.deps);

    const everything = [...h.writes().map((w) => h.bodyOf(w)), h.summary()].join("\n");
    for (const forbidden of ["internal-billing", "src/", "evil.example", "<script>", ".ts:42"]) expect(everything).not.toContain(forbidden);
    expect(everything).toContain("Your code no longer uses a service this version of SrcLawyer doesn't recognize.");
    expect(everything).toContain("The scanner no longer finds a kind of data this version of SrcLawyer doesn't recognize.");
  });
});

describe("review mode: the issue", () => {
  const PUSH = { repository: { default_branch: "main" } };
  const onMain = { eventName: "push", event: PUSH, ref: "refs/heads/main" };
  const listed = (...issues: Array<Record<string, unknown>>) => issues.map((i) => JSON.stringify(i)).join("\n") + "\n";
  const OURS = (number: number, state: string, body: string) => ({ number, title: "Privacy policy review needed", state, body: `${text.COMMENT_MARKER}\n${body}` });
  const driftFingerprint = text.fingerprintOf(text.diffItems(DRIFT.diff));

  it("creates one issue titled 'Privacy policy review needed' on drift, with the run link", async () => {
    const h = harness({ report: DRIFT, ...onMain });

    expect(await action.mainReview(h.deps)).toBe(0);

    const [create] = h.writes();
    expect(create).toContain("POST");
    expect(create).toContain("repos/acme/app/issues");
    expect(create).toContain("title=Privacy policy review needed");
    const body = h.bodyOf(create);
    expect(body).toContain(`<!-- srclawyer-fingerprint:${driftFingerprint} -->`);
    expect(body).toContain("Found by this run: https://github.com/acme/app/actions/runs/123");
    expect(h.ghCalls().some((a) => a.join(" ").includes("issues?state=all"))).toBe(true);
  });

  it("updates the open issue instead of creating another", async () => {
    const h = harness({ report: DRIFT, ...onMain, gh: [{ match: "issues?state=all", stdout: listed(OURS(12, "open", "old")) }] });

    await action.mainReview(h.deps);

    expect(h.writes()).toHaveLength(1);
    expect(h.writes()[0]).toContain("PATCH");
    expect(h.writes()[0]).toContain("repos/acme/app/issues/12");
  });

  it("does not reopen or recreate an issue a person closed for the same items, but opens a new one for different items", async () => {
    const closed = listed(OURS(9, "closed", `<!-- srclawyer-fingerprint:${driftFingerprint} -->\nx`));
    const same = harness({ report: DRIFT, ...onMain, gh: [{ match: "issues?state=all", stdout: closed }] });
    await action.mainReview(same.deps);
    expect(same.writes()).toEqual([]);
    expect(same.logs.join("\n")).toContain("No issue was created because an issue for these same items was already closed.");

    const different = harness({
      report: { ...DRIFT, diff: { ...DRIFT.diff, added: { categories: [], processors: ["Mixpanel"] } } },
      ...onMain,
      gh: [{ match: "issues?state=all", stdout: closed }],
    });
    await action.mainReview(different.deps);
    expect(different.writes()).toHaveLength(1);
    expect(different.writes()[0]).toContain("POST");
  });

  it("with nothing new, rewrites an open issue to 'no new items found' and never closes it; with none open it does nothing", async () => {
    const open = harness({ report: NO_DRIFT, ...onMain, gh: [{ match: "issues?state=all", stdout: listed(OURS(12, "open", "old")) }] });
    await action.mainReview(open.deps);
    expect(open.writes()).toHaveLength(1);
    expect(open.bodyOf(open.writes()[0])).toContain("You can close this issue once you have looked at it.");
    expect(open.writes()[0].join(" ")).not.toContain("state=");

    const none = harness({ report: NO_DRIFT, ...onMain });
    await action.mainReview(none.deps);
    expect(none.writes()).toEqual([]);
  });

  it("ignores pull requests and other people's issues when looking for its own", async () => {
    const h = harness({
      report: DRIFT,
      ...onMain,
      gh: [{ match: "issues?state=all", stdout: listed({ number: 3, title: "Privacy policy review needed", state: "open", body: "someone wrote this by hand" }) }],
    });

    await action.mainReview(h.deps);

    expect(h.writes()[0]).toContain("POST");
    expect(h.ghCalls()[0].join(" ")).toContain("select(.pull_request == null)");
  });

  it("first review: creates the first-review issue once, with the same assistant prompt, and the pull-request job says nothing", async () => {
    const h = harness({ report: FIRST_REVIEW, ...onMain, baseline: BASELINE(["Twilio"], ["phone"]) });

    expect(await action.mainReview(h.deps)).toBe(0);

    const body = h.bodyOf(h.writes()[0]);
    expect(body).toContain("## SrcLawyer: your first privacy review is waiting");
    expect(body).toContain("This is the first review of this project. Nothing has been approved yet.");
    expect(body).toContain("- Your code uses **Twilio**.");
    expect(body).toContain("- Your code appears to handle **phone numbers**.");
    expect(body).toContain("> Resolve the SrcLawyer privacy review in this project.");
    expect(h.logs.join("\n")).toContain("::warning title=SrcLawyer::Your first privacy review is waiting. The details are in the run summary.");

    const again = harness({ report: FIRST_REVIEW, ...onMain, gh: [{ match: "issues?state=all", stdout: listed(OURS(4, "open", "old")) }] });
    await action.mainReview(again.deps);
    expect(again.writes()[0]).toContain("repos/acme/app/issues/4");
  });

  it("a manual run on another branch writes only the run summary, and says so", async () => {
    const h = harness({ report: DRIFT, eventName: "workflow_dispatch", event: PUSH, ref: "refs/heads/feature" });

    await action.mainReview(h.deps);

    expect(h.writes()).toEqual([]);
    expect(h.ghCalls()).toEqual([]);
    expect(h.summary()).toContain("Found by this run:");
    expect(h.logs.join("\n")).toContain("This run is not on the default branch, so only the run summary was written.");
  });

  it("scheduled runs on the default branch use the same issue", async () => {
    const h = harness({ report: DRIFT, eventName: "schedule", event: PUSH, ref: "refs/heads/main" });
    await action.mainReview(h.deps);
    expect(h.writes()[0]).toContain("POST");
  });

  it("a failing gh is a warning and the result is unchanged", async () => {
    const h = harness({ report: DRIFT, ...onMain, ghDefault: { status: 1, stdout: "" } });
    expect(await action.mainReview(h.deps)).toBe(0);
    expect(h.logs.join("\n")).toContain("Couldn't create or update the issue. Check that Issues are turned on for this repository and that the job has issues: write.");
  });
});

describe("review mode: setup", () => {
  it("runs `update --format json` with an out-dir outside the project, and the pinned install", async () => {
    const h = harness({ report: NO_DRIFT, event: PR_EVENT, inputs: { INPUT_INVENTORY_PATH: "docs/inv.json" } });
    writeFileSync(join(h.work, "inv.json"), "x");

    await action.mainReview(h.deps);

    expect(h.calls[0].args).toContain("srclawyer@0.10.0");
    const update = h.calls[1].args;
    expect(update.slice(1, 6)).toEqual(["update", "--format", "json", "--inventory", "docs/inv.json"]);
    expect(update[update.indexOf("--out-dir") + 1]).toMatch(/srclawyer-review$/);
  });

  it("rejects a pin that predates review mode, and an unknown mode", async () => {
    const old = harness({ report: NO_DRIFT, event: PR_EVENT, loadText: async () => ({}) });
    expect(await action.mainReview(old.deps)).toBe(1);
    expect(old.summary()).toContain("does not have the review mode");

    expect(action.readInputs({ INPUT_MODE: "REVIEW" }).mode).toBe("review");
    expect(action.readInputs({}).mode).toBe("check");
  });

  it("builds a command for a commit pin that npx accepts", () => {
    expect(action.npxTarget("0.10.0")).toBe("srclawyer@0.10.0");
    expect(action.npxTarget(`github:SrcLawyer/srclawyer#${"a".repeat(40)}`)).toBe(`github:SrcLawyer/srclawyer#${"a".repeat(40)}`);
  });

  it("finds the baseline's path in the repository, or none if it points outside", () => {
    expect(action.baselineRepoPath(".", ".srclawyer.inventory.json")).toBe(".srclawyer.inventory.json");
    expect(action.baselineRepoPath("apps/web", ".srclawyer.inventory.json")).toBe("apps/web/.srclawyer.inventory.json");
    expect(action.baselineRepoPath(".", "../x.json")).toBeNull();
  });
});

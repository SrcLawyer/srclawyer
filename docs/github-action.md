# SrcLawyer drift check (GitHub Action)

Flags when your code starts collecting a new kind of data, or using a new third-party processor, that your privacy policy was never updated for. Free during the beta.

It compares the code against a committed **baseline** (`.srclawyer.inventory.json`): the sorted list of data categories and processors the code touches. It never compares policy text — people edit generated policies by hand — and it contains no file names, line numbers or field names.

**Drift** is an added or removed category or processor. A finding moving between "confident" and "needs review" is not drift.

## One-time setup

```bash
npx srclawyer@0.9.0 scan --write-inventory     # writes .srclawyer.inventory.json, and PRIVACY_POLICY.md unless an edited one is there
git add .srclawyer.inventory.json && git commit -m "Add SrcLawyer baseline"
```

`--write-inventory` refuses to write if the scan completed with a warning (Worker unreachable, skipped files, unsupported stack, rejected workspace config): a degraded scan is missing categories, which would later read as drift. `--allow-incomplete-inventory` overrides.

**Write the baseline on the same kind of machine that checks it.** Inside a git repository, `check` and `--write-inventory` only look at tracked files plus untracked-but-not-ignored files (`git ls-files --cached --others --exclude-standard`), so a gitignored build directory on your laptop can't create phantom drift on a clean CI checkout. The mode is recorded in the baseline; if the baseline and the run disagree (for example CI has no `.git`), the result is *inconclusive*, never drift. To generate the baseline on a runner instead of your laptop, use the [baseline workflow](#writing-the-baseline-on-the-runner) below.

## Using the Action

```yaml
- uses: actions/checkout@v7          # pin to a commit sha in your own workflows
- uses: SrcLawyer/srclawyer@v0.9.0
  with:
    srclawyer-version: 0.9.0        # required, and pinned: an exact version, or github:SrcLawyer/srclawyer#<40-char sha>
```

| Input | Default | |
|---|---|---|
| `srclawyer-version` | — (required) | Exact version, or `github:SrcLawyer/srclawyer#<40-hex sha>`. `latest`, ranges, tags and branch names are rejected so a pinned workflow can't change underneath you. |
| `inventory-path` | `.srclawyer.inventory.json` | The committed baseline, relative to `path`. |
| `path` | `.` | Directory to check. |
| `fail-on-drift` | `true` | When `false`, drift is a warning annotation instead of a failure. |
| `fail-on-inconclusive` | `false` | When `true`, "no verdict" fails the step. By default it is a warning. |
| `mode` | `check` | `check` is the drift check described above. `review` runs `srclawyer update` and reports as a comment or an issue; see [Review mode](#review-mode). |
| `pr-comment` | `false` | Post one comment on the pull request and keep it updated. Needs `pull-requests: write`. Skipped on pull requests from forks. |
| `github-token` | `github.token` | Used only for that comment. |

Outputs: `result` (`no-drift`, `drift`, `inconclusive`, `error`), `added` and `removed` (comma-separated `category:<name>` / `processor:<name>`).

**Permissions and secrets.** `contents: read` is enough; no secrets are used. The optional comment is the only thing that needs `pull-requests: write`. The check makes the same two kinds of network call as `scan` (see the README's *Network calls*): opaque ids, categories and signals for confidence grading, and redacted Zod schema fragments. It never calls an AI provider and never writes a policy.

**What a clean result means.** A clean run means *no new items found by the scanner since your last approved review*. It is not a statement that your product or your policy is compliant. Every summary and comment also carries a one-line coverage statement: what the scan covered and what it did not.

**When it fails.** A drift failure's step summary lists what was added and removed and the one-line fix: update your privacy policy, then run `npx srclawyer@<version> scan --write-inventory` and commit the file. That command refreshes the baseline and leaves a hand-edited `PRIVACY_POLICY.md` alone (it says so and exits 0); to get a fresh draft next to it, add `--out PRIVACY_POLICY.generated.md`. See the README's [Editing the generated policy](../README.md#editing-the-generated-policy). An *inconclusive* result — the confidence service unreachable, files skipped, an unsupported stack, or a discovery-mode mismatch — lists its reasons and is a warning, because it says nothing about drift. A crash, or a missing or invalid baseline, always fails.

## Example triggers

Pull requests that touch source or dependency manifests, a weekly run, and manual dispatch:

```yaml
name: SrcLawyer drift check
on:
  pull_request:
    paths:
      - "**/*.js"
      - "**/*.jsx"
      - "**/*.ts"
      - "**/*.tsx"
      - "**/*.mjs"
      - "**/*.cjs"
      - "**/*.py"
      - "**/*.html"
      - "**/*.graphql"
      - "**/openapi.*"
      - "**/package.json"
      - "**/package-lock.json"
      - "**/requirements*.txt"
      - ".srclawyer.inventory.json"
  schedule:
    - cron: "17 6 * * 1"        # Mondays 06:17 UTC: catches drift from dependency or config changes outside PRs
  workflow_dispatch:

permissions:
  contents: read

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: SrcLawyer/srclawyer@v0.9.0
        with:
          srclawyer-version: 0.9.0
```

With the optional PR comment:

```yaml
permissions:
  contents: read
  pull-requests: write

# ...
      - uses: SrcLawyer/srclawyer@v0.9.0
        with:
          srclawyer-version: 0.9.0
          pr-comment: "true"
```

## Review mode

`srclawyer ci init` writes this for you; this section says what it does. It needs SrcLawyer 0.10.0 or later.

In review mode the Action runs `srclawyer update`. On a pull request it keeps one comment up to date; on the default branch and on scheduled runs it keeps one issue, titled "Privacy policy review needed", up to date and never closes it. It posts nothing when it finds nothing new.

- **What the comment and the issue say.** What the scanner found in plain English, the questions that need an answer (the first five, the rest collapsed, sensitive ones first), the coverage line, and how to resolve it with an AI coding assistant or by hand. They contain no file names, paths or source lines, and never the approval note.
- **First review.** A baseline nobody has approved yet gets one issue ("your first privacy review is waiting") on the default branch. It is not repeated for pull requests.
- **A pull request that changes the baseline.** A pull request that changes `.srclawyer.inventory.json` gets a comment saying so, even when the scanner found nothing new, because recording changes as reviewed is an approval that a reviewer should see. It lists the services and kinds of personal data the pull request now records as reviewed.
- **When nothing is new.** An earlier comment is rewritten to "no new items found". An open issue is rewritten the same way; close it when you have looked at it. An issue you closed is not reopened or recreated for the same items.
- **When the scan can't finish** (the confidence service is unreachable, files were skipped, or the baseline and the run used different file discovery) there is no comment, no issue and no artifact, only the run summary.
- **Forks.** Pull requests from forks get a read-only token, so they get no comment; the result is in the run summary.
- **Artifacts.** The run uploads the policy draft and the review file as an artifact named `srclawyer-review`, kept for 7 days. Artifacts inherit the repository's visibility. In handwritten mode the draft contains the same source file names and line numbers as `srclawyer scan` writes.
- **Advisory.** The workflow that `srclawyer ci init` writes sets `fail-on-drift` to `"false"`, so a finding is a comment or an issue, not a failed check. Set it to `"true"` if you want a failed check.
- **Permissions.** `pull-requests: write` on the job that handles pull requests, `issues: write` on the job that handles pushes and scheduled runs, and `contents: read` on both. `srclawyer ci init` writes them as two jobs so that each has only the permission it needs. Issues must be turned on for the repository. A failed GitHub call is a warning and never changes the result.

```yaml
name: SrcLawyer privacy review
on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: "17 6 * * 1"
  workflow_dispatch:

jobs:
  pull-request:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write }
    steps:
      - uses: actions/checkout@v7          # pin to a commit sha in your own workflows
      - uses: SrcLawyer/srclawyer@v0.10.0
        with: { srclawyer-version: 0.10.0, mode: review, fail-on-drift: "false" }
  default-branch:
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    permissions: { contents: read, issues: write }
    steps:
      - uses: actions/checkout@v7
      - uses: SrcLawyer/srclawyer@v0.10.0
        with: { srclawyer-version: 0.10.0, mode: review, fail-on-drift: "false" }
```

`srclawyer ci init` writes the full file (with the actions pinned to commits and a concurrency group) only with your yes, never over an existing file, and commits and pushes nothing. `pr-comment` is ignored in review mode.

## Writing the baseline on the runner

Generates the baseline in the same environment that will check it. Run it from the Actions tab, download the `srclawyer-inventory` artifact (the file is also printed in the run's summary), and commit it.

```yaml
name: SrcLawyer baseline
on: workflow_dispatch

permissions:
  contents: read

jobs:
  baseline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "22"
      - run: npx --yes srclawyer@0.9.0 scan --write-inventory --no-llm --out "$RUNNER_TEMP/PRIVACY_POLICY.md"
      - run: |
          { echo '```json'; cat .srclawyer.inventory.json; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
      - uses: actions/upload-artifact@v7
        with:
          name: srclawyer-inventory
          path: .srclawyer.inventory.json
```

## Exit codes of `srclawyer check`

| Code | Meaning |
|---|---|
| 0 | no drift |
| 1 | drift |
| 2 | crash, bad usage, or a missing or invalid baseline |
| 3 | inconclusive: a warning that would make `scan` exit 1 (skipped files, confidence service unreachable, unsupported stack, rejected workspace config), or a discovery-mode mismatch |

`scan` exits 0 clean, 1 when it completed with warnings, and 2 on a crash or bad usage. `scan`'s "completed with warnings" (1) and `check`'s "inconclusive" (3) are the same condition under different numbers: `scan`'s was left alone so existing scripts keep working.

## In a container

If your job runs in a container, git may refuse the checkout as "dubious ownership" and `check` will report a discovery-mode mismatch. Add `git config --global --add safe.directory "$GITHUB_WORKSPACE"` before the check.

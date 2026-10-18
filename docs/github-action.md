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

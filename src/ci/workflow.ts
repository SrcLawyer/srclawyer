// The workflow file `srclawyer ci init` writes: docs/question-catalog.md Appendix D, verbatim apart from the
// {placeholders}. tests/ciInit.test.ts compares this template with the catalog.

export const WORKFLOW_RELATIVE_PATH = ".github/workflows/srclawyer.yml";

// Full commit of each action the workflow uses, with the release it is (the comment is written next to it).
// Re-resolve with `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` when bumping.
export const CHECKOUT_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
export const CHECKOUT_VERSION = "7.0.1";

export const WORKFLOW_TEMPLATE = `# SrcLawyer privacy review. Created by \`srclawyer ci init\`.
# It reports new services and kinds of personal data it finds in your code as a pull request comment or
# an issue. It never changes your code or your policy, merges, or publishes anything.
# To stop it, delete this file.
name: SrcLawyer privacy review

on:
  pull_request:
  push:
    branches: [{branch}]
  schedule:
    - cron: "{minute} {hour} * * {weekday}"
  workflow_dispatch:

concurrency:
  group: srclawyer-\${{ github.ref }}
  cancel-in-progress: false

jobs:
  pull-request:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@{sha} # v{checkout version}
        with:
          persist-credentials: false
      - uses: SrcLawyer/srclawyer@v{version}
        with:
          srclawyer-version: {version}
          mode: review
          fail-on-drift: "false"

  default-branch:
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@{sha} # v{checkout version}
        with:
          persist-credentials: false
      - uses: SrcLawyer/srclawyer@v{version}
        with:
          srclawyer-version: {version}
          mode: review
          fail-on-drift: "false"
`;

export interface WorkflowInput {
  /** The repository's default branch. */
  branch: string;
  /** What \`srclawyer-version\` is pinned to: an exact version, or \`github:SrcLawyer/srclawyer#<sha>\` for testing. */
  versionSpec: string;
  /** The ref of the Action itself; \`v<version>\` unless overridden for testing. */
  actionRef: string;
  /** The folder inside the repository that was set up, or "" for the repository root. */
  folder: string;
  /** Weekly schedule; the minute is never 0. */
  schedule: { minute: number; hour: number; weekday: number };
}

const SAFE = /^[A-Za-z][A-Za-z0-9._/-]*$/;
/** Plain when it is plainly safe in YAML, double-quoted (JSON) otherwise: a branch or folder name comes from the repository. */
const yamlScalar = (value: string): string => (SAFE.test(value) ? value : JSON.stringify(value));

export function renderWorkflow(input: WorkflowInput): string {
  let out = WORKFLOW_TEMPLATE.replaceAll("SrcLawyer/srclawyer@v{version}", `SrcLawyer/srclawyer@${input.actionRef}`)
    .replaceAll("{sha}", CHECKOUT_SHA)
    .replaceAll("{checkout version}", CHECKOUT_VERSION)
    .replace("{branch}", yamlScalar(input.branch))
    .replace("{minute}", String(input.schedule.minute))
    .replace("{hour}", String(input.schedule.hour))
    .replace("{weekday}", String(input.schedule.weekday))
    .replaceAll("{version}", input.versionSpec);
  if (input.folder !== "") out = out.replaceAll("          srclawyer-version: " + input.versionSpec + "\n", `          srclawyer-version: ${input.versionSpec}\n          path: ${yamlScalar(input.folder)}\n`);
  return out;
}

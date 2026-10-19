# Assistant contract (JSON, schema 1)

Commands an AI coding assistant can run on the owner's behalf. They print one JSON object (`schema: 1`), never prompt, and never publish or commit anything. Fields may be added in minor releases; a field is renamed or removed only in a major release, and tests pin the shape.

Everything the owner is asked comes from static wording reviewed in [question-catalog.md](question-catalog.md). No file name, path, source line or free text from the project is ever put in a question, and a stored free-text answer is shown only as its length and a 60-character preview marked `"untrusted": true`.

## Commands

| Command | Reads | Writes | Network | Exit codes |
|---|---|---|---|---|
| `srclawyer status --json` | config, baseline, `.srclawyer/`, `PRIVACY_POLICY.md` | nothing | none | always 0 |
| `srclawyer questions --json` | same | nothing | none | always 0 |
| `srclawyer update --json` | the project | draft, review file, `.srclawyer/last-update.json` | confidence service only | 0 no new items, 1 new items found, 2 error, 3 inconclusive |
| `srclawyer answer <id> <value> [--note <text>] [--stdin]` | config | `.srclawyer.config.yml` (one value), `.srclawyer/` | none | 0 recorded, 2 refused |
| `srclawyer approve --review <hash> --user-reply <text> [--allow-unanswered <ids>]` | the project | `.srclawyer.inventory.json` | confidence service only | 0 recorded or nothing to approve, 2 refused, 3 scan incomplete |
| `srclawyer init --yes` | the project | config (all answers blank), baseline, policy | confidence service only | as `scan` |

`status` and `questions` answer from local files, so they are fast and safe to call at any time; they report what the last `update` found. Run `update` first.

## `agent-setup`

`srclawyer agent-setup [--dry-run] [--yes] [--claude-ask-rules] [--json]` shows what it would write and writes only with a yes: interactively, or `--yes` after the assistant has shown the owner the plan and the owner said yes. Without a terminal and without `--yes` it writes nothing and exits 2. `--dry-run --json` prints the plan:

```json
{ "schema": 1, "ok": true, "dryRun": true, "written": false,
  "writes": [{"path": "AGENTS.md", "action": "create", "description": "will be created"},
             {"path": ".claude/skills/srclawyer-privacy/SKILL.md", "action": "create", "description": "will be created"}],
  "claudeAskRules": {"included": false, "flag": "--claude-ask-rules", "offer": "Also add rules to .claude/settings.json so Claude Code always asks you before recording an answer or an approval? [y/N] ", "rules": ["Bash(srclawyer answer *)", "..."]},
  "installHint": null, "published": false, "committed": false }
```

`action` is `create`, `insert-block`, `replace-block` (an unedited block from an older version), `merge-json`, `unchanged` or `left-alone` (with a `reason`: `edited`, `malformed`, `invalid-json` or `unexpected-shape`). It never overwrites: an edited block or skill, a block with a missing end line, and an unparsable `.claude/settings.json` are reported and left exactly as they were. `CLAUDE.md` is only written if it already exists. `status --json` reports `agentSetup` (`current`, `older`, `edited`, `malformed`, `missing`, `not-present` for `AGENTS.md` and `CLAUDE.md`; `current`, `edited`, `missing` for the skill), so a changed instruction file shows up.

## `policyMode`

`status` reports `policyMode`: `handwritten` (also when the config has no `policyMode`) or `generated`. In generated mode `update` regenerates `PRIVACY_POLICY.md` every time the scan is conclusive (it writes the review file when new items are found, but no separate draft), and exits 2 without touching the file if it was edited. Then `status` is `blocked` with `policy-file-edited`, and `questions` carries one question:

```json
{ "id": "policy-file-edited", "kind": "choice", "reason": "attention", "blocking": true,
  "ask": "Your privacy policy file has changes that SrcLawyer didn't make. What should happen to them?",
  "why": "SrcLawyer won't overwrite your changes without asking.",
  "options": [{"value": "keep_mine", "label": "Keep my changes and edit the policy by hand from now on"},
              {"value": "move_to_settings", "label": "Move my changes into SrcLawyer's settings so the policy can keep updating itself (I'll help, and you approve each piece)"},
              {"value": "discard", "label": "Throw them away and regenerate the policy (a backup copy is saved first)"}],
  "answerWith": "srclawyer answer policy-file-edited <keep_mine|move_to_settings|discard>" }
```

`keep_mine` sets `policyMode: handwritten`. `discard` saves a backup copy in `.srclawyer/backups/` (the answer reports its path) and lets the next `update` replace exactly that version of the file; nothing is deleted at the moment of the answer. `move_to_settings` changes nothing by itself: `questions` then also offers `policyText.intro`, `policyText.closing` and `policyText.additionalSections`, and when the text is moved the owner chooses `discard`.

## `state`

One of: `needs-setup` (no config, or no baseline), `needs-answers` (a blocking question is open), `needs-update` (nothing is known about the code since the baseline last changed), `needs-approval` (new items were found and every question is answered), `up-to-date`, `blocked` (the last update could not finish). `nextAction` says what to do: `{"do": "run-command", "command": "..."}`, `{"do": "run-update", ...}`, `{"do": "ask-user", "questionId": "..."}`, `{"do": "ask-user-to-confirm", "reviewHash": "..."}` or `{"do": "none"}`.

`up-to-date` means no new items were found by the scanner since the last approved review. It is not a statement that the product or the policy is compliant, and it can hold while `publishable` is `false`.

## `publishable`

`status` and `update` report `publishable`, `publishableBlockers` and `publishableWarnings`, read from `PRIVACY_POLICY.md`. The policy is **not** publishable while it has no file, any `[TO COMPLETE]` blank, or any of the four "scan incomplete" banners. Items listed for manual review are a non-blocking warning with a count. An assistant must not add or enable a `/privacy` page while `publishable` is `false` unless the owner insists after being told what is missing, and a page must never show a blank without the owner having been told.

## `questions`

```json
{ "schema": 1, "srclawyerVersion": "0.9.0", "state": "needs-answers", "reviewHash": null,
  "questions": [{
    "id": "hasEuUkUsers", "field": "hasEuUkUsers", "kind": "yes_no", "reason": "unanswered",
    "blocking": true, "deferred": false, "sensitive": true,
    "ask": "Do you have users in the European Union or the United Kingdom?",
    "why": "People there have extra privacy rights, and the policy has to mention them if they apply.",
    "explain": "...plain-English explanation the assistant may read aloud (sensitive questions only)...",
    "options": [{"value": true, "label": "Yes"}, {"value": false, "label": "No"}, {"value": "unsure", "label": "I'm not sure"}],
    "ifUnsure": "No problem. I'll leave a clearly marked blank in the policy, and it can't be marked ready to publish until someone fills it in.",
    "evidence": {"addedServices": [], "addedDataKinds": []},
    "current": {"answered": false, "value": null},
    "answerWith": "srclawyer answer hasEuUkUsers <true|false|unsure> --note \"<what the user said>\"" }],
  "nextAction": {"do": "ask-user", "questionId": "hasEuUkUsers"} }
```

`reason` is `unanswered` or `changed` (the code changed, so an existing answer should be confirmed; `evidence` then names the added services and kinds of data). `kind` is `yes_no`, `text`, `age` or `list`. `deferred` means the owner said they were not sure: the blank stays, and the question is not re-asked on this machine.

## `answer`

`srclawyer answer <id> <value>`: `true`/`false`/`unsure` for yes-no questions; a whole number 1-120, `none` (stored as `0`) or `unsure` for the minimum age; comma-separated items for a list; text (up to 500 characters, one line, no control characters) for the rest, optionally from `--stdin`. The contact email and site address are validated. `--note` (up to 120 characters, one line) is **required** for the sensitive questions and is written as a trailing comment next to the value, so a reviewer sees in the git diff what the assistant said the owner told it. `unsure` records nothing in the config. The command changes one value in `.srclawyer.config.yml`, keeps the rest of the file, comments included, and never regenerates anything; run `update` next.

```json
{ "schema": 1, "ok": true, "id": "hasEuUkUsers", "field": "hasEuUkUsers", "recorded": true, "written": true,
  "previous": {"answered": false, "value": null}, "current": {"answered": true, "value": true},
  "note": "owner has users in Germany", "state": "needs-update", "nextAction": {"do": "run-update", "command": "srclawyer update --json"} }
```
A refusal prints `{"schema": 1, "ok": false, "id": "...", "error": {"code": "...", "message": "..."}}` and exits 2. Codes: `unknown-question`, `no-config`, `invalid-value`, `invalid-note`, `note-required`.

## `policyText` answers

`srclawyer answer policyText.intro|closing|lastUpdated --stdin` and `srclawyer answer policyText.additionalSections --heading "<heading>" --stdin` record text for a generated policy, exactly as given (line breaks allowed except in the date; limits: heading 100, date 100, introduction and closing 2,000, section body 4,000 characters; at most 10 sections; no control characters; a line that imitates SrcLawyer's end-of-file marker is refused). `answer policyText.lastUpdated none` records that the owner wants no date. The date question is offered once, in generated mode, and is never filled in by SrcLawyer or an assistant.

## `approve`

`srclawyer approve --review <hash> --user-reply "yes"`. `--review` is the `reviewHash` from `update` or `questions`. It scans again and derives the review itself: a review file on disk, or the update record, is never trusted, so a forged one changes nothing. It refuses if the hash is not the review that is true now, if the reply is not a yes (one line, at most 120 characters), or if a blocking question is still open (it names them; the owner may leave some on purpose with `--allow-unanswered`). On success it records, in `.srclawyer.inventory.json` only:

```json
"approval": { "review": "<sha-256 of the approved review>", "note": "yes" }
```

and refreshes the baseline to the code as it is now. **No date is written**; git history is the timestamp. The note is up to 120 characters on one line, is stored in `.srclawyer.inventory.json`, and is committed to your repository if you commit that file.

**What approval is.** The hash proves the caller read this review, and the note records what the owner said. Neither is security: anyone with write access can also edit the baseline directly or run `scan --write-inventory`. For a project with one owner, approval means the owner's yes plus a committed note. It is not independent review. The protection that matters is a human reviewing the pull request that contains the baseline.

## Trust

SrcLawyer's output is built from fixed wording and its own tables; no sentence it prints contains text from your repository, and stored free-text answers are previews flagged `untrusted`. File names, comments, READMEs and `package.json` fields can still contain text written to manipulate an assistant. The instructions `agent-setup` writes tell the assistant to treat all of it as data, and to ask you before recording anything. That is guidance, not enforcement: the `ask` rules (Claude Code) and a tool's own approval prompts add a pause, and the review hash and the note add an audit trail, but anyone who can edit the repository can also edit the baseline. Review changes to instruction files, `.claude/`, `AGENTS.md` and `.srclawyer.inventory.json` like code.

## Local state (`.srclawyer/`)

`update` leaves `.srclawyer/last-update.json` (the review hash, the questions the change raised, the added and removed items by name, and which of those questions were answered) and `answer` may leave `.srclawyer/deferred.json`. The folder contains its own `.gitignore` with `*`, so none of it can be committed. It holds no paths, code or free text, goes stale when the baseline changes, and is safe to delete.

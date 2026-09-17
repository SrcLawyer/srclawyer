# Golden corpus

A real-world accuracy check for Layer 1 (`src/engine/scanEngine.ts`), separate from the fast, synthetic, offline test suite in `tests/`.

## Why this exists

The 68+ tests under `tests/` assert the tool does what it was written to do, on fixtures written specifically to exercise that behavior. They don't say anything about how often the tool is right on code nobody wrote for that purpose. This corpus does — against real, diverse, actively-maintained open-source repositories (`manifest.json`), pinned to a specific commit each, with hand-verified expected findings (`expected-findings/<name>.json`).

**This corpus deliberately does not include MaskProj or any other project the maintainer has a personal stake in** — using your own code as the accuracy benchmark risks overfitting to its quirks rather than measuring real generalization.

## Running it

```bash
npm run test:corpus                    # score against the stored baseline; fails if recall regresses
npm run test:corpus:update-baseline    # score and overwrite baseline.json with today's numbers
```

Each repo is shallow-cloned at its pinned commit into `$CORPUS_CACHE_DIR` (default: a temp directory) at run time — never vendored into this repository, so each project's own license is respected and nothing third-party ships in `git log` here. The clone is reused across runs as long as it's already at the pinned SHA.

## Reading the output

- **Recall** (`matchedExpected / totalExpected`) is the hard gate. It answers: "of the things we've hand-verified this code actually does, how many did the tool find?" A drop against `baseline.json` fails the script.
- **Precision** (`findingsMatchingSomeExpected / totalFindings`) is printed but **not gated on, and will look artificially low** — expected-findings only covers a small, hand-curated subset of what each repo actually contains (a handful of entries against a monorepo with hundreds of real findings). A low precision number here does **not** mean "the tool is only N% accurate" — it means most of the tool's output isn't covered by hand-verified ground truth yet, which is expected at this stage. Growing the expected-findings files over time is how precision becomes a meaningful signal; regressions in it are still worth a look, but it's informational, not a gate.
- Some `expected-findings` entries are marked **KNOWN MISS** in their `note` — real PII/credential collection at that exact file/line that the tool does *not* currently detect. These are intentional: they make today's real gaps visible in the recall number rather than only ever measuring what's already easy.

## Scope boundary: Zod/schema-based detection

`src/rules/zodPreFilter.ts` and the protected-logic service it calls recognize Zod schemas used to validate incoming request data, but not schemas that merely exist in the codebase for other purposes (e.g. validating a third-party API response, an environment variable, or an internal config object) — even though those are identical AST-wise. The exact scope rule is part of the protected detection logic and isn't documented here.

**Known, accepted gap:** `dub`'s own `bankAccountSchema` (see `expected-findings/dub.json`) is genuinely privacy-relevant but falls outside this detection's current scope by design — a distinct class of problem (data received via a third-party integration, not submitted directly by a user) reserved for future work. It remains in `expected-findings/dub.json` as an intentional, tracked gap so it stays visible in recall rather than disappearing silently.

## Adding a repo

1. Pick a real, actively-maintained, license-clear repo with genuine third-party integrations relevant to `src/rules/processorProfiles.ts` (Stripe, auth, analytics, etc.) — not a toy or synthetic example.
2. Add an entry to `manifest.json`: `name`, `url`, a `pinnedSha` (a real commit, confirmed to exist), the repo's actual license (read it — don't assume), and `notes` on why it's a useful entry.
3. Clone it at that SHA and read the real code. Hand-author `expected-findings/<name>.json`: `{filePattern, lineRange, dataCategory, minConfidence, note}` per entry, matched loosely (never by exact description text) so rule refactors don't make the corpus brittle. Include both things the tool currently catches *and* verified real gaps it currently misses.
4. Run `npm run test:corpus:update-baseline` once satisfied, and commit the updated `baseline.json`.

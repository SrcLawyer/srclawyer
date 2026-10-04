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

**If the protected-logic service fails for any repo during a run** (observed in practice: the Worker hitting its CPU time limit, intermittently, on large `detect-zod-schema` batches — see `wrangler tail` against the deployed Worker to confirm), the whole run is printed as **RUN INVALID**: it is not compared against `baseline.json`, does not gate on regression, and `--update-baseline` is a no-op for that run. A failed protected-logic call degrades findings to their safe local default (same as a real scan), which looks identical to a genuine detection regression — conflating the two would make a transient Worker failure corrupt the stored baseline. Just re-run it.

## Reading the output

Every `expected-findings` entry carries a `classification`: `"real_pii"` (this location genuinely involves privacy-relevant data collection, whether or not the tool currently catches it — a `real_pii` entry can still be a documented miss) or `"documented_non_pii"` (this entry exists purely to record that a finding the tool *does* produce at that location is **not** actually PII — a pagination cursor, a redirect target — kept in ground truth so the false positive stays visible rather than vanishing silently). This split exists because a single blended precision/recall number conflates "found real privacy issues" with "matched something I'd already written down," in both directions:

- **Recall of real PII** (`matchedRealPii / totalExpectedRealPii`, computed only from `real_pii`-classified entries) is the hard gate. It answers: "of the genuine privacy-relevant data collection we've hand-verified, how many did the tool find?" A drop against `baseline.json` fails the script. `documented_non_pii` entries are deliberately excluded from this number — "recall" of a known false positive isn't something to maximize.
- **Findings breakdown** (`findingsRealPii` / `findingsDocumentedNonPii` / `findingsUnmatched`, as a share of `totalFindings`) replaces the old single "precision" figure. This is printed but **not gated on**, and it can mislead in **either direction**, not just low:
  - It will look **artificially low** when ground truth is incomplete — most of a scan's real output isn't covered by hand-verified entries yet (a handful of entries against a monorepo with hundreds of findings). Low here does not mean "the tool is only N% accurate."
  - It can also look **artificially high/flattering**: if every finding a scan produces happens to be covered by *some* `expected-findings` entry — including entries that exist specifically to document a false positive — the breakdown can read as "100% accounted for" while a meaningful share of that is `documentedNonPii`, not `realPii`. A high number here is a statement about how complete hand-verification is, not a certification that everything found is correct. Always read the real-PII-vs-documented-non-PII split, never a single blended percentage.
  - `findingsUnmatched` means "not yet covered by ground truth either way" — not "wrong." Growing `expected-findings` over time (in both directions) is what makes this breakdown a meaningful signal.
- Some `real_pii` entries are marked **KNOWN MISS** in their `note` — real PII/credential collection at that exact file/line that the tool does *not* currently detect. These are intentional: they make today's real gaps visible in the recall number rather than only ever measuring what's already easy.

## Scope boundary: Zod/schema-based detection

`src/rules/zodPreFilter.ts` and the protected-logic service it calls recognize Zod schemas used to validate incoming request data, but not schemas that merely exist in the codebase for other purposes (e.g. validating a third-party API response, an environment variable, or an internal config object) — even though those are identical AST-wise. The exact scope rule is part of the protected detection logic and isn't documented here.

**Known, accepted gap:** `dub`'s own `bankAccountSchema` (see `expected-findings/dub.json`) is genuinely privacy-relevant but falls outside this detection's current scope by design — a distinct class of problem (data received via a third-party integration, not submitted directly by a user) reserved for future work. It remains in `expected-findings/dub.json` as an intentional, tracked gap so it stays visible in recall rather than disappearing silently.

## Adding a repo

1. Pick a real, actively-maintained, license-clear repo with genuine third-party integrations relevant to `src/rules/processorProfiles.ts` (Stripe, auth, analytics, etc.) — not a toy or synthetic example.
2. Add an entry to `manifest.json`: `name`, `url`, a `pinnedSha` (a real commit, confirmed to exist), the repo's actual license (read it — don't assume), and `notes` on why it's a useful entry.
3. **Before running the tool against it**, clone the repo at that SHA and enumerate its real request-input reads yourself — grep for the relevant accessors (`request.form`/`.json`/`.args`, `req.body`/`.query`/`.params`, `get_json()`, schema definitions, etc.) and read the surrounding code. Ground truth has to come from the code, not from the tool's own output, or the corpus just measures agreement with itself rather than real-world accuracy. Only run a scan afterward, to compare against what you already found by hand.
4. Hand-author `expected-findings/<name>.json`: `{filePattern, lineRange, dataCategory, minConfidence, classification, note}` per entry, matched loosely (never by exact description text) so rule refactors don't make the corpus brittle. `classification` is `"real_pii"` or `"documented_non_pii"` (see "Reading the output" above). Include things the tool currently catches, verified real gaps it misses, *and* known false positives worth tracking — all three are useful ground truth, just scored differently.
5. Run `npm run test:corpus:update-baseline` once satisfied, and commit the updated `baseline.json`.

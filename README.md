# SrcLawyer

Static analysis engine that derives privacy policy documentation directly from source code, and keeps it in sync as the code changes.

> This is a Phase 1 scaffold: the CLI (`init`, `scan`), the Layer 1 static analysis engine — SDK/framework pattern detection, HTML/browser-API detection, and OpenAPI/GraphQL schema parsing — LLM-assisted reasoning for ambiguous findings (Layer 2, bring-your-own-key or managed), and markdown privacy policy generation. CI/CD integration is not yet implemented.
>
> Scanning is manual-only (`srclawyer scan`, run on demand) — this is the free/solo tier's permanent behavior, not a placeholder. CI/CD integration (PR-triggered scans, a weekly backstop scan) is scoped for the paid/team tier only; see `PRODUCT_SPEC.md` Section 8.5.

## Usage

No install needed for a first try — `npx` fetches and runs the latest version on demand:

```bash
npx srclawyer init     # one-time: jurisdiction, markets, industry
npx srclawyer scan     # analyze the codebase and write PRIVACY_POLICY.md
```

For a persistent `srclawyer` command instead of typing `npx` every time:

```bash
npm install -g srclawyer
srclawyer init
srclawyer scan                  # analyze the codebase and write PRIVACY_POLICY.md
srclawyer scan --json           # findings as JSON (still writes the policy file)
srclawyer scan --out docs/privacy.md
```

If `srclawyer` isn't found right after a global install, see [Troubleshooting: command not found](#troubleshooting-command-not-found) below.

## Development

Working on SrcLawyer itself (not just using it):

```bash
git clone https://github.com/SrcLawyer/srclawyer.git
cd srclawyer
npm install
npm run build
node dist/cli.js scan
```

Or run directly from source without building first: `npm run dev -- scan`.

## Troubleshooting: command not found

After `npm install -g srclawyer`, the install prints `added N packages` but the `srclawyer` command isn't recognized. This almost always means the command *was* installed — npm's own global bin directory just isn't on your shell's `PATH`, or your shell doesn't know about it yet.

**The most common cause: conda.** If you have Anaconda/Miniconda installed with `auto_activate_base` enabled (the default), conda prepends its own directories to `PATH` every time a new shell starts — this can land ahead of, or instead of, the directory npm actually installed into. Symptoms: `srclawyer` works in some terminals/tabs but not others, or never works despite the install reporting success.

Steps, in order of how likely each is to fix it:

1. **Open a brand-new terminal window or tab.** `PATH` is set when a shell starts; a terminal that was already open won't pick up a global install that happened after it launched.
2. **If a new terminal doesn't help, check where npm actually put it versus what's on your `PATH`:**
   ```bash
   npm config get prefix      # where npm installs global packages
   echo $PATH                 # does the above, plus "/bin", appear in here?
   ```
   If `npm config get prefix`'s `bin` subdirectory (or, on Windows, the prefix itself) isn't listed in `$PATH` at all, that's the root cause — your shell's startup files (`.zshrc`, `.bashrc`, `.bash_profile`) need a line adding it, e.g. `export PATH="$(npm config get prefix)/bin:$PATH"`.
3. **If conda specifically is the culprit** (its paths appear in `$PATH` ahead of npm's prefix, or npm's prefix is missing because conda's own Node/npm shadowed the one you expected to use): either run `conda deactivate` before using `srclawyer`, or turn off automatic activation so it stops happening on every new shell: `conda config --set auto_activate_base false`.
4. **If `srclawyer` still isn't found after fixing `PATH`**, your shell may have cached the old (missing) command location. Clear that cache: `hash -r` (bash) or `rehash` (zsh), then try again without opening a new terminal.

If none of this resolves it, `npx srclawyer scan` (see [Usage](#usage) above) sidesteps `PATH` entirely, since `npx` always invokes the binary directly rather than relying on it being a recognized shell command.

## What `scan` does today

- **Known SDK integrations** (import/require detection): Stripe, SendGrid, Twilio, Google Analytics, Mixpanel, Auth0, Firebase, Cognito for JS/TS; Stripe, SendGrid, Twilio, Mixpanel, Auth0, Firebase for Python — each mapped to the data categories it typically processes (`src/rules/processorProfiles.ts`).
- **Request-body field collection** in Express (`req.body.x`, destructured `req.body`) and Next.js (both `pages/api` and the app router's `await request.json()`), and in **Flask** (`request.form`/`.json`/`.args`, both subscript and `.get(...)` forms), classified against a field-name lexicon (`src/rules/dataCategoryLexicon.ts`). In both languages, a value assigned to a local variable earlier in the *same function* (`const body = req.body` / `data = request.get_json()`) is tracked one mechanical hop, so a later `body.email` / `data['email']` is still caught — not just the direct, unaliased form.
- **OpenAPI/Swagger schemas** (`components.schemas.*.properties`) and **GraphQL SDL** type/input fields.
- **HTML forms and inline scripts** (`src/rules/htmlRules.ts`): native `<input>` elements classified by `type` (password/email/tel are unambiguous native signals) or by `id`/`name` against the lexicon; inline `<script>` blocks are extracted and run through the same SDK/framework/web-API rules as any other file.
- **Browser platform APIs** (`src/rules/webApiRules.ts`): `getUserMedia` (split into microphone and camera access), geolocation, and `localStorage`/`sessionStorage` writes classified by key name.
- Fields that can't be confidently classified (generic names like `data`, `payload`) are surfaced with `requiresReview: true` rather than silently guessed.
- **A field-name allowlist** (`src/rules/safeFieldNames.ts`) suppresses findings entirely for exact-match structural and pagination/sort fields (`id`, `createdAt`, `status`, `per_page`, `cursor`, `sort_by`, etc.) so "needs review" stays a signal, not noise from routine boilerplate. Anything not on the allowlist keeps the existing classify-or-flag behavior above.
- **Unsupported language/framework detection** (`src/engine/languageDetection.ts`) runs at the start of every scan: it checks for Django (`manage.py`), FastAPI (`from fastapi import` / `import fastapi`), Rails (`Gemfile` + `app/controllers`), gRPC (`.proto` files), and falls back to a file-count ratio for Ruby/Go/Java/PHP/C# vs JS/TS/HTML/Python. When it fires, a bordered warning appears at the top of the CLI output *and* at the top of the generated `PRIVACY_POLICY.md` (not just a log line easy to miss), the warning is included in `--json` output, and the process exits with code 1 so CI can't silently treat a scan of an unsupported codebase as a pass.
- **Generates a markdown privacy policy** (`src/policy/generatePolicy.ts`) in the same command: findings are grouped by data category, each clause cites the file:line that justified it, third-party processors get their own section, and anything flagged `requiresReview` is excluded from the body and listed separately under "Items Requiring Manual Review" instead of being guessed. The mandatory disclaimer (`src/policy/disclaimer.ts`) is always appended, unconditionally.

Every finding traces back to a file and line (`src/engine/types.ts#Finding`).

### Supported languages and frameworks

| Language | Frameworks | Status |
|---|---|---|
| JavaScript / TypeScript | Express, Next.js (pages + app router) | Supported |
| Python | Flask | Supported (beta — see "Known gaps" below) |
| Python | FastAPI, Django | Explicitly detected and flagged as unsupported, never silently skipped |
| Ruby, Go, Java, PHP, C#, gRPC | — | Explicitly detected and flagged as unsupported |

### Known gaps

- **Cross-function aliasing isn't tracked, in either language.** The same-function alias tracking described above follows exactly one assignment hop within the function it occurs in. If that value is passed on — as a function parameter, through a closure, via a module-level variable — a field read from it afterward is not detected. Example: a Flask handler reads `data = request.get_json()` and calls `User.from_dict(data)`; a field read as `data['password']` *inside* `from_dict` is not caught, only reads inside the original handler function are.
- **Data sent to a third party via a raw HTTP call isn't attributed to that processor.** SDK-integration detection (above) is anchored to known package imports. A call like Python's `requests.post("https://api.some-provider.com/...", json={...})` or JS's `fetch("https://api.some-provider.com/...")` — bypassing a dedicated SDK entirely — is invisible to this detection today, in both languages, regardless of how sensitive the data it sends is.
- **Python support is based on one real-world corpus repository so far** (a Flask app; see `test-fixtures/golden-corpus/`), not the broader validation JS detection has had. Expect rougher edges on Flask codebases with unusual patterns.

## Network calls

Detection itself is fully local and offline — no code leaves your machine for pattern matching. Once detection completes, `scan` makes one batched network call to grade the confidence of what it found (field names and derived yes/no signals only, never source code), and, for scans that use Zod schemas as request validators, one additional call sending a small redacted code fragment. This runs on every scan regardless of tier and is unrelated to the separate, optional LLM-assisted (Layer 2) reasoning described above. See `PRODUCT_SPEC.md`'s "Static Analysis Depth" section for the precise wording.

## Secret handling

`src/engine/secretRedaction.ts` strips known secret-shaped values (API keys, connection strings, JWTs, private key blocks) out of any evidence string before it's stored or printed, and out of any code fragment before it's sent as part of the confidence-grading call above — enforced at the base layer, independent of whether the optional LLM-assisted (Layer 2) path is configured.

## Test fixtures

`test-fixtures/` contains a small Express+Stripe app, a Next.js app (pages + app router), an OpenAPI spec, and a GraphQL schema, used to validate detection end-to-end. Run `node dist/cli.js scan` from inside `test-fixtures/` to see it work.

## Accuracy corpus

`npm test` never touches the network. A separate, real-world accuracy check lives in `test-fixtures/golden-corpus/` — see its own README for what it measures and why it's not part of the default test run.

## License

[Business Source License 1.1](LICENSE) (BUSL-1.1) — source-available, not OSI-approved open source.

Free for any use, including internal use within a commercial organization of any size and as part of your own software development and compliance processes. The only restriction: you may not offer SrcLawyer, or a modified/derivative version of it, to third parties as a hosted or managed service, or embed it in a competing commercial product, without a separate commercial license from Mystique Technologies LLC (contact@mystique-technologies.com).

Each version converts to the Apache License 2.0 four years after its first public release.

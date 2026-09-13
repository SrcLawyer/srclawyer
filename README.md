# SrcLawyer

Static analysis engine that derives privacy policy documentation directly from source code, and keeps it in sync as the code changes.

> This is a Phase 1 scaffold: the CLI (`init`, `scan`), the Layer 1 static analysis engine — SDK/framework pattern detection, HTML/browser-API detection, and OpenAPI/GraphQL schema parsing — and markdown privacy policy generation. LLM-assisted reasoning and CI integration are not yet implemented.
>
> Scanning is manual-only (`srclawyer scan`, run on demand) — this is the free/solo tier's permanent behavior, not a placeholder. CI/CD integration (PR-triggered scans, a weekly backstop scan) is scoped for the paid/team tier only; see `PRODUCT_SPEC.md` Section 8.5.

## Usage

```bash
npm install
npm run build
node dist/cli.js init            # one-time: jurisdiction, markets, industry
node dist/cli.js scan            # analyze the codebase and write PRIVACY_POLICY.md
node dist/cli.js scan --json     # findings as JSON (still writes the policy file)
node dist/cli.js scan --out docs/privacy.md
```

During development, run directly from source with `npm run dev -- scan`.

## What `scan` does today

- **Known SDK integrations** (import/require detection): Stripe, SendGrid, Twilio, Google Analytics, Mixpanel, Auth0, Firebase, Cognito — each mapped to the data categories it typically processes (`src/rules/processorProfiles.ts`).
- **Request-body field collection** in Express (`req.body.x`, destructured `req.body`) and Next.js (both `pages/api` and the app router's `await request.json()`), classified against a field-name lexicon (`src/rules/dataCategoryLexicon.ts`).
- **OpenAPI/Swagger schemas** (`components.schemas.*.properties`) and **GraphQL SDL** type/input fields.
- **HTML forms and inline scripts** (`src/rules/htmlRules.ts`): native `<input>` elements classified by `type` (password/email/tel are unambiguous native signals) or by `id`/`name` against the lexicon; inline `<script>` blocks are extracted and run through the same SDK/framework/web-API rules as any other file.
- **Browser platform APIs** (`src/rules/webApiRules.ts`): `getUserMedia` (split into microphone and camera access), geolocation, and `localStorage`/`sessionStorage` writes classified by key name.
- Fields that can't be confidently classified (generic names like `data`, `payload`) are surfaced with `requiresReview: true` rather than silently guessed.
- **A field-name allowlist** (`src/rules/safeFieldNames.ts`) suppresses findings entirely for exact-match structural fields (`id`, `createdAt`, `status`, pagination params, etc.) so "needs review" stays a signal, not noise from routine boilerplate. Anything not on the allowlist keeps the existing classify-or-flag behavior above.
- **Unsupported language/framework detection** (`src/engine/languageDetection.ts`) runs at the start of every scan: it checks for Django (`manage.py`), Rails (`Gemfile` + `app/controllers`), gRPC (`.proto` files), and falls back to a file-count ratio for Python/Ruby/Go/Java/PHP/C# vs JS/TS/HTML. When it fires, a bordered warning appears at the top of the CLI output *and* at the top of the generated `PRIVACY_POLICY.md` (not just a log line easy to miss), the warning is included in `--json` output, and the process exits with code 1 so CI can't silently treat a scan of an unsupported codebase as a pass.
- **Generates a markdown privacy policy** (`src/policy/generatePolicy.ts`) in the same command: findings are grouped by data category, each clause cites the file:line that justified it, third-party processors get their own section, and anything flagged `requiresReview` is excluded from the body and listed separately under "Items Requiring Manual Review" instead of being guessed. The mandatory disclaimer (`src/policy/disclaimer.ts`) is always appended, unconditionally.

Every finding traces back to a file and line (`src/engine/types.ts#Finding`).

## Secret handling

`src/engine/secretRedaction.ts` strips known secret-shaped values (API keys, connection strings, JWTs, private key blocks) out of any evidence string before it's stored or printed — enforced at the base layer, independent of the LLM-assisted path that doesn't exist yet.

## Test fixtures

`test-fixtures/` contains a small Express+Stripe app, a Next.js app (pages + app router), an OpenAPI spec, and a GraphQL schema, used to validate detection end-to-end. Run `node dist/cli.js scan` from inside `test-fixtures/` to see it work.

## Accuracy corpus

`npm test` never touches the network. A separate, real-world accuracy check lives in `test-fixtures/golden-corpus/` — see its own README for what it measures and why it's not part of the default test run.

## License

[Business Source License 1.1](LICENSE) (BUSL-1.1) — source-available, not OSI-approved open source.

Free for any use, including internal use within a commercial organization of any size and as part of your own software development and compliance processes. The only restriction: you may not offer SrcLawyer, or a modified/derivative version of it, to third parties as a hosted or managed service, or embed it in a competing commercial product, without a separate commercial license from Mystique Technologies LLC (contact@mystique-technologies.com).

Each version converts to the Apache License 2.0 four years after its first public release.

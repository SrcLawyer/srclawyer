# Product Spec: AI-Native Legal Hardening Tool. The name will be SrcLawyer
### Working codename: "Semgrep for Legal Compliance"

---

## 1. Problem Statement

Developers ship products without privacy policies that match what their code actually does — either skipped entirely, copied from a competitor, or generated once via a questionnaire that goes stale the moment the codebase changes. This creates real legal exposure under GDPR, CCPA, and 20+ US state privacy laws. Existing tools (Termly, iubenda, Google Checks) are either manual/questionnaire-driven, one-time, or scoped to mobile app-store compliance specifically — none continuously derive compliance documentation directly from source code as it evolves.

## 2. Solution Summary

A static-analysis engine (with LLM-assisted reasoning for ambiguous cases) that reads a codebase's data-collection patterns and API integrations, then generates and continuously maintains a privacy policy — and eventually other legal disclaimers — automatically as the code changes. Modeled structurally on Semgrep: open-core static analysis tool, CI/CD-native, developer-first adoption.

## 3. Phase 1 Scope — Deliberately Narrow

- **Feature:** Privacy policy generation only (defer ToS, cookie policy, DSAR, accessibility, etc. to later phases)
- **Customer:** Solo developers and small teams/agencies (not enterprise compliance teams — that's Google Checks' territory)
- **Platform:** Web apps and APIs (not mobile-app-store-specific)
- **Goal:** Validate that the "continuous, code-derived, always-accurate" value prop is something this audience will actually adopt and pay for

## 4. Core Requirements

### 4.1 Analysis Engine (in priority order — cheapest/safest first)
1. **Static code analysis** — scan for data-collecting patterns: form fields, DB writes, API request/response schemas, type definitions
2. **Schema/documentation parsing** — OpenAPI/Swagger specs, GraphQL introspection (`__schema` query), gRPC reflection, existing SDK type definitions
3. **LLM-assisted contextual reasoning** — for ambiguous cases (generically-named API calls), reason from surrounding code, variable names, and downstream usage — never guesses silently on high-stakes items (e.g., children's data)
4. **Passive traffic observation (optional)** — lightweight proxy/middleware that observes the developer's own real test traffic; never initiates calls itself
5. **Sandboxed active verification (optional, explicit opt-in only)** — synthetic-value calls against developer-designated test/sandbox environments only; never production; never write/charge/delete-type operations by default

### 4.2 Onboarding Flow
- One-time setup step on first run (not a recurring questionnaire) — modeled on `npm init`
- Collects: legal entity location/jurisdiction, target markets/audience, industry vertical, children's-data flag
- **Pre-fill guesses where possible** (Stripe account country, README business info, domain TLD) — developer confirms/corrects rather than starting blank
- Writes answers to a config file (e.g. `.privacypolicy.yml`) — all subsequent automated scans read silently, no repeated interruption
- Follow-up questions triggered only by a detected material change (new processor, new region signal) — never a full re-ask

### 4.3 Output
- Generated privacy policy as a markdown file, versioned in the repo
- Each clause traceable back to the specific code/API call that justifies it
- **Delivery to the live site — Tier 1 only for v1:** generate the .md file + a ready-to-paste prompt for the developer's own coding assistant (Cursor/Claude Code) to insert it — e.g., *"Add this generated privacy policy to a /privacy-policy route and link it in the site footer: [content]"*
- Tier 2 (fixed/templated direct insertion) and Tier 3 (orchestrating another AI coding agent programmatically) are explicitly **out of scope for v1** — see Section 6

### 4.4 Continuous Re-scanning
- CI/CD integration (GitHub Action first) — re-runs on PR/merge
- Flags drift between generated policy and current code state
- This is the core differentiator vs. one-off ChatGPT/Claude generation — solves a discipline problem, not a capability problem

### 4.5 Legal Disclaimer (non-negotiable, always present)
- Every generated document must carry: *"This document was generated based on automated code analysis and does not constitute legal advice; consult an attorney to verify applicability to your specific circumstances."*
- Not removable at any tier — this protects the business, not a branding choice
- **Action item: real legal counsel review of this language before launch**

## 5. Delivery Mechanism

- Single package install (npm/pip-equivalent) that auto-detects project type and self-configures the CI hook on first run
- One command install + one short setup pass = practical floor for "simple as possible"
- True zero-config isn't realistic given the one-time jurisdiction questions, but interruption should happen exactly once

## 6. Explicit Non-Goals / Boundaries (v1)

- Does **not** write or modify application logic — strictly reads code, never edits it (beyond the optional Tier 2 fixed-snippet insertion, deferred)
- Does **not** call any live/production API endpoint under any circumstance
- Does **not** perform write/charge/delete-type operations even in sandbox mode by default
- Does **not** programmatically drive third-party AI coding agents (Tier 3) — keep this a hard boundary for v1 and revisit only with explicit legal/compliance review later
- Does **not** position itself as a general coding assistant — strictly compliance-scoped output

## 7. Business Model

- **Open-core.** Free/open: analysis engine, CLI, basic generation. Paid: hosted/managed CI service, curated & continuously-updated legal content (the real ongoing cost center), sandboxed dynamic verification, multi-client/agency dashboards, attribution removal.
- Rationale: trust matters more here than typical SaaS since the tool reads private source code to produce a binding legal document — open engine = auditable, no black-box trust required.
- Precedent model: Sentry, GitLab, Supabase, HashiCorp Vault.
- Optional attribution watermark (tier-gated, separate from the mandatory disclaimer).

## 8. Competitive Positioning

| | This tool | Google Checks | ChatGPT/Claude (manual) |
|---|---|---|---|
| Analyzes | Source code directly | Compiled running mobile app | Whatever's pasted in |
| Output | Publishable policy doc | Compliance report + app-store form | One-off policy text |
| Trigger | Continuous (CI/CD) | Manual submission | Manual, ad hoc |
| Platform | Any codebase | Mobile (Android/iOS) only | N/A |
| Audience | Solo devs / small teams | Enterprise compliance teams | Anyone, one-time |

## 8.5. Additional Phase 1 Design Decisions

### Licensing
**Business Source License 1.1** (not MIT/Apache) for the core engine. Rationale: standard permissive licenses allow a well-capitalized competitor to take the code, host it as a competing service, and keep any improvements proprietary — the exact pattern that led MongoDB and Elastic to change their own licenses after AWS did this to them. BSL closes that same loophole directly, by use rather than by copyleft obligation: the Additional Use Grant permits free use, modification, and self-hosting for any purpose — including internal use at a commercial organization of any size — but prohibits offering the Licensed Work, or a derivative of it, as a hosted/managed service to third parties, or embedding it in a competing commercial product, without a separate commercial license from Mystique Technologies LLC. Each version converts automatically to Apache License 2.0 four years after its first public release, so the source-available restriction is always time-boxed, not permanent — this is the same model MariaDB, CockroachDB, and Sentry use for the identical reason.

### Data Retention — Near-Zero, Stated Explicitly as a Trust Claim
- LLM-layer code snippets are processed transiently in memory only, discarded immediately after the API call — never logged in human-readable form, never retained "just in case"
- "Diff since last scan" need is met via **hashing, not raw code storage** — store a hash/fingerprint of the analyzed section plus its resulting classification (e.g., "this function collects an email address"), never the underlying code itself
- Any temporary debugging logs auto-expire within days, not months; not casually human-readable without a specific, logged access reason
- State plainly that LLM provider API tiers (not consumer chat products) do not train on submitted data by default
- Mirror Semgrep's own "by default, your code is never retained" as a headline trust claim in marketing/positioning, not just a ToS clause

### Secret/Credential Handling (non-negotiable, hard rule)
- Recognize known secret-shaped patterns (API keys, tokens, connection strings) and redact them **before** any analysis, logging, or transmission occurs
- Enforced in the open-source Layer 1 code itself so it's independently auditable
- The tool detects *that* a service like Stripe is integrated; it must never need or transmit the actual secret values encountered while scanning config/`.env` files

### Static Analysis Depth (Layer 1 — the free tier, and the actual product)
No-AI static analysis must be strong on its own, not a stripped-down teaser:
- Deep, maintained rule library for known SDKs (Stripe, SendGrid, Twilio, Google Analytics, Mixpanel, Auth0, Firebase, Cognito) and framework-idiomatic patterns (Next.js API routes, Django models, Rails ActiveRecord, Express handlers)
- Real data-flow analysis (tracing a value's movement through the code), not just line-by-line pattern matching
- Leverage existing type systems/schemas already in the codebase (TypeScript interfaces, Zod/Pydantic, GraphQL schemas, OpenAPI specs) as free, high-confidence signal
- Maintained knowledge base mapping known third-party services to their typical data categories and disclosure obligations — curation, not AI, is the real differentiator here
- Honest confidence scoring: when static analysis can't confidently resolve something, say so explicitly ("N items require deeper analysis") rather than guess — doubles as the cleanest upgrade path to paid tiers

**What actually stays local, precisely stated:** all code reading and pattern detection happens entirely on your machine, offline — no code ever leaves it for this part. Once detection is complete, the tool makes one batched network call per scan to grade how confident each finding is; that call sends only field names and derived yes/no signals (e.g. "was this name ambiguous," "how many similar fields are nearby"), never your source code. A small number of scans — those using Zod schemas as request validators — make one additional call, sending a small, redacted code fragment (never full files, never secrets, using the same redaction as everything else here). This is unrelated to, and unaffected by, the separate optional Layer 2 (AI-assisted) tier described below — it runs regardless of which LLM tier, if any, is configured, and it is not itself AI/LLM-based.

### Scan Triggers

**Free / solo tier: manual only.** `srclawyer scan` runs on demand and nothing else — no CI hook, no scheduled backstop, no file-watching. This is the current implemented behavior: the CLI exposes exactly two commands (`init`, `scan`), both invoked by hand, with no cron/schedule/webhook code anywhere in the engine.

**Paid / team tier: CI/CD integration** (not yet built — scoped here for when it is)
- Primary: on PR/before merge, filtered to files matching relevant patterns (API routes, form handlers, DB models, dependency manifests)
- Dependency-manifest changes (`package.json`, `requirements.txt`) always trigger a scan regardless of diff size — highest-signal, easiest-to-miss change type
- Weekly (not daily) periodic backstop scan, independent of the CI hook, to catch drift from hotfixes or bypassed CI checks
- Filter out pure UI/CSS, documentation, test-only, and comment-only diffs to avoid noise and unnecessary LLM cost
- Re-scanning is silent by default; only a **material change** (new data type, new processor, new region signal) surfaces to the developer as a proposed policy diff requiring explicit approval before the live document updates

### Monorepo Support (in scope for v1)
- Detect and traverse actual project boundaries within a repo (workspace configs: `package.json` workspaces, `lerna.json`, `nx.json`, or multiple manifest files in subdirectories)
- Aggregate findings from each sub-project into one unified policy rather than assuming a single flat codebase

### AI Cost Model / Tier Structure
1. **Free** — Layer 1 (static analysis) only, self-hosted, zero AI cost
2. **Bring-your-own-key** — unlocks Layer 2 (LLM reasoning), user supplies their own API key and pays their own AI bill directly to the provider; zero AI cost to the business; real upsell lever since most users will prefer paying for convenience over managing their own key/billing
3. **Managed/hosted** — Layer 2 included, zero setup, AI cost bundled into subscription price (Option A from delivery-mechanism discussion — the default path for "single import, fill in basic info, it just runs")

## 9. Known Risks / Open Questions

- Moat is modest and mostly non-technical (legal content curation, workflow embedding, underserved-niche focus) — not a hard technical moat
- Google could plausibly extend Checks toward source-code-level or non-mobile analysis
- Real liability exposure if generated policies are wrong/incomplete — legal counsel required before launch, not after
- Unvalidated: whether solo devs/small teams will actually pay vs. treat this as a nice-to-have — needs real user interviews before heavy build investment

## 10. Suggested Validation Step (before full build)

Talk to 5-8 developers or small teams who've shipped an app recently (bonus: AI-assisted) — ask how they actually handled their privacy policy (wrote one, skipped it, copied a competitor, used a generator). Confirms whether the code-analysis approach solves a felt pain or an inferred one.

---

## Handoff Note for Implementation

This spec is written for handoff to **Claude Code** (or an equivalent coding agent) when development begins — Cowork is better suited to the planning, research, and documentation work that produced this spec, not the implementation itself. Suggested first Claude Code session: scaffold the CLI + static analysis engine (Section 4.1, items 1-2 only) against a small set of test repos, before adding LLM-assisted reasoning or any dynamic verification.

# Vendored tree-sitter grammars

`tree-sitter-python.wasm` is vendored directly here rather than depended on via npm, deliberately.

**Why not depend on `tree-sitter-python` directly:** its npm package runs `"install": "node-gyp-build"`
on every install. That script uses a prebuilt native binary when one matches the current
platform/arch/Node ABI, but falls back to compiling from source (`node-gyp rebuild`, requiring a C
toolchain) when none matches — a real risk of `npm install srclawyer` failing outright on some
systems, for a capability (the native Node binding) this project never actually uses. We only need
the `.wasm` build the same package happens to also ship.

**Why not depend on `tree-sitter-wasms` instead** (a package of prebuilt, dependency-free `.wasm`
grammars for many languages, including Python): it has no risky install script, but as an npm
dependency it ships its *entire* ~52MB bundle (every language it carries) to every `srclawyer`
install, to use roughly 450KB of it.

**What's actually here:** `tree-sitter-python.wasm` extracted directly from the official
`tree-sitter-python` npm package, which ships it as a plain file alongside its (unused, by us) native
binding.

- Source: `tree-sitter-python@0.25.0` npm package, `tree-sitter-python.wasm`
- License: MIT (Copyright (c) 2016 Max Brunsfeld) — see `LICENSE` in this directory
- SHA-256: `16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47`
- Vendored: 2026-10-03

Parsed at runtime via `web-tree-sitter` (a real, zero-dependency npm dependency — the pure-WASM
tree-sitter runtime, distinct from the native-binding package above). Lives under `src/` rather than
the repo root specifically so it resolves at the same relative path (`../grammars/` from the loading
file) whether `pythonAstUtils.ts` runs directly from source (`npm run dev`, tests) or from its
compiled location (`npm run build` copies this directory to `dist/grammars/`, mirroring `src/`'s own
layout) — the same relative-depth trick doesn't work if the vendored copy sits at the repo root
instead.

To update: download the new version's npm tarball, extract `tree-sitter-python.wasm`, verify its
license hasn't changed, record the new SHA-256 and version above, and re-run `npm run build && npm test`
to confirm `web-tree-sitter`'s ABI is still compatible (`Language.load()` throws on a genuine
incompatibility rather than silently producing wrong results).

# Execution Log — markdown-lint extension (plan 029)

Simple-mode build. One phase, tasks T001–T012. Verb run via `node harness/cli/bin/harness.js` (AGENTS.md: not npx).

---

## T001 — Complete the dependency install; confirm local bins resolve ✅

- `npm install` → "up to date, audited 467 packages" (the prior interrupted install had in fact completed).
- Local bins resolve: `node_modules/.bin/markdownlint-cli2` (→ markdownlint-cli2 0.22.1) and `node_modules/.bin/remark` (→ remark-cli 13) both executable.
- `node -e "require('mermaid/package.json')"` → mermaid 11.15.0 resolves.
- `harness doctor --json` → 4 extension files, all `loaded`, 0 failed (arch-check, skills-check, validate-harness-flow, validate-harnessability).

**Done-When met.** No git ops; additive only.

---

## T002 — Scaffold via `harness new markdown-lint`; restructure to shell + lib/ ✅

- `harness new markdown-lint` → created `.harness/extensions/markdown-lint/{extension.ts,instructions.md}` (variant `minimal-ts`). Dogfooded the scaffolder.
- `harness doctor` → `markdown-lint: loaded`. Bare `harness markdown-lint --json` → `unconfigured` ("Implement run()…"). Done-When met.

---

## T003 — Pure libs: extract.ts + decision.ts (+ scope.ts) ✅

Wrote three pure libs under `lib/` (no `node:*`, synchronous, typed):
- `lib/extract.ts` — `extractMermaidFences(md, path)` → `{path,line,text}[]`; a fence state machine that tracks ALL fences so a ` ```mermaid ` *shown* inside a 4-backtick block is not mis-extracted (finding 02).
- `lib/decision.ts` — `decide(checks)` → warn-launch envelope (`unavailable→unconfigured/2`, `findings→degraded/0`, else `ok/0`) with aggregated totals + evidence counts (AC-03).
- `lib/scope.ts` — **DEVIATION (logged):** the plan put the scope ignores in the two tool configs; instead the frozen § Scope contract lives here as one typed, unit-tested `inScope()`/`filterInScope()` source. The shell filters `git ls-files '*.md'` through it, so markdownlint, remark, and the mermaid walk derive their file set from the SAME place — making AC-04 ("zero findings from excluded dirs") provable in one spot instead of re-asserted in two configs (the mermaid walk needs a code-side scope anyway). Configs (T007) carry RULES only.

**Empirical grounding captured before writing** (spikes, all from the repo root):
- markdownlint-cli2 0.22.1: accepts explicit file paths; findings → **stderr** (`path:L:C error MD…`), evidence → **stdout** (`Linting: N file(s)`); `Summary: N error(s)` parseable; exit 1=findings / 0=clean. Stock defaults are noisy (51 on README) → warn-launch + T009 tuning confirmed necessary.
- remark-validate-links 13.x: run from repo root (resolves the plugin from cwd `node_modules`, and shells `git remote -v`, so cwd MUST be the repo root); `--use remark-validate-links --frail --quiet <files>`; findings carry a `remark-validate-links:<rule>` label (distinguishes from a "Cannot process file" failure); good anchors pass; exit 1 on findings.
- mermaid 11.15.0: subprocess `.mjs` inside the repo; `parse(text,{suppressErrors:true})` → `{diagramType}` (valid) or `false` (invalid); one subprocess for all fences via stdin JSON; headless, no Chromium (AC-07).
- Loader = jiti for `.ts` (full transpile, resolves the relative-import graph + each ext's node_modules); `.mjs` runs as a plain `node` subprocess.

---

## T004 — Colocated unit tests ✅

`scope.test.ts` (33), `extract.test.ts` (10), `decision.test.ts` (5) = **48 tests pass** via the existing vitest glob (`../../.harness/extensions/**/*.test.ts`). Covers: include/ignore + ignore-beats-include (AC-04), all fence edge cases (nested/wrapped, tilde, CRLF, unterminated, attribute info-strings), and all four envelope states + precedence. One initial assertion was wrong (a nested `AGENTS.md` under `skills/**` is legitimately in scope) — fixed the test, not the code.

---

## T005 — `lib/mermaid-runner.mjs` subprocess ✅

Headless mermaid validator. Reads fences from `process.argv[2]` (JSON; the verb passes them there — `ctx.exec` has no stdin) or stdin (manual). `mermaid.parse(text,{suppressErrors:true})` → `{diagramType}`/`false`. Always exits 0; validity in the JSON. Verified: good→valid, bad→invalid, empty→[], all exit 0.

**DISCOVERY (significant): bare `mermaid.parse()` is NOT headless for real diagrams.** Any *labeled* diagram throws `DOMPurify.addHook is not a function` — mermaid sanitizes label text via DOMPurify, which needs a DOM. Trivial `A-->B` graphs skip sanitization, which is exactly why a label-less spike (and the plan's assumption) looked headless-clean. Over the repo's real diagrams this surfaced as **all 12 fences invalid** — a false-negative that would have shipped if untested on real content.
- **Fix**: the runner sets up **jsdom** (added as a devDependency) before importing mermaid — a pure-JS DOM, NOT a browser, so AC-07 ("no Chromium") still holds. After the shim: real labeled flowcharts/sequences → valid; broken/gibberish → invalid. (Node 24: `globalThis.navigator` is read-only — set `window`/`document`/`HTMLElement`/`SVGElement` only.)
- This is harness/research feedback (magic-wand candidate): the mermaid spike must use a *realistic labeled* diagram, never `A-->B`.

---

## T006 — `extension.ts` shell ✅

Thin shell (mirrors arch-check): `git ls-files '*.md' '*.markdown'` → `filterInScope()` → explicit file list shared by all three checks; runs them concurrently; aggregates via `decide()`. Loads cleanly (`doctor`), runs end-to-end. Honest envelope; `next_action` on every non-ok; never throws (try/catch backstop). Optional `--dir <path>` narrows the set. Findings 03/04/05 honoured: local bins (never `npx`), parse output not just exit code, argv arrays (no `bash -c`), remark check-only (no `--output`).

**Empirically grounded before writing** (spikes, all from repo root):
- markdownlint-cli2: explicit paths OK; findings → stderr, evidence (`Linting: N file(s)`) → stdout; `Summary: N error(s)` parseable; exit 1=findings/0=clean. Stock defaults very noisy (3130 over 64 files) → T009 tuning essential.
- remark-validate-links: **cwd MUST be repo root** — it resolves the plugin from cwd `node_modules` AND shells `git remote -v` (fails outside a git tree). Findings carry a `remark-validate-links:<rule>` label (distinguishes from a "Cannot process file" failure). `ctx.exec` defaults cwd=ctx.cwd → fine; the shell also preflights the bin/plugin/config.
- `ctx.exec` is shell-free (injection-safe) but has **no stdin** → mermaid fences pass as one argv arg (payload tiny: only 6 files / ~12 fences in scope).

First live run already caught a **real broken in-repo link** (`docs/how/architecture-conformance.md` → a nonexistent `../harness-presentations/...` path).

---

## T007 — Config (`.markdownlint-cli2.jsonc` + `.remarkrc.json`) ✅

- `.markdownlint-cli2.jsonc`: **rules only** (scope is owned in code by `lib/scope.ts`; `ignores` here are belt-and-suspenders for direct CLI use). Disabled rules each carry a one-line rationale.
- `.remarkrc.json`: `{ "plugins": ["remark-validate-links"] }`. The shell now loads the plugin from config (dropped the CLI `--use`) **and preflights `.remarkrc.json`** (arch-check pattern) so a missing config reports `unconfigured`, never a silent fake-pass.

---

## T009 — Tune to a clean warn-launch baseline ✅

Rules-only tuning (scope never widened). 3130 markdownlint findings → **7**; the residual is honest signal, not noise.

**Disabled (convention conflicts, each in the config with rationale):** MD013 line-length, MD060 + MD055 table style, MD033 inline-HTML, MD034 bare-urls, MD040 fenced-code-language, MD041 first-line-h1 (stylistic the repo rejects); MD012/MD022/MD031/MD032/MD028/MD009/MD047/MD036/MD038 (whitespace-hygiene **backlog** — widely violated; not mass-editing the shared tree now, re-enable per rule as docs are cleaned); MD056 table-column-count (false-positives on the assessment-report **template**'s `{{PLACEHOLDER}}` rows). **Refined (not disabled):** MD024 → `{ "siblings_only": true }` (changelogs repeat `### Features` per version).

**Recorded baseline** (`harness markdown-lint --json`, degraded/exit 0):
- markdownlint: **7** findings — all `MD001/heading-increment` (h2→h4 skips) in `harness-foundations/first-principles.md`. Real but deferred (warn-launch; not editing the shared tree).
- links: **1** finding — `docs/how/architecture-conformance.md:19` → missing `../harness-presentations/missing-layer-101/intro-to-harness.md` (real broken cross-repo link). Deferred (warn-launch).
- mermaid: **pass** — 12/12 fences valid.
- **AC-04 verified**: every finding path is in-scope (`harness-foundations/`, `docs/how/`); **zero** from excluded dirs (`docs/plans/**`, `.harness/**`, `agents/**`, `**/tasks/**`, …).

The 8 residual findings are enumerated above and surfaced live; left as warn-launch advisories (the user can fix or accept).

---

## T010 — Wire into `just fft` (+ npm script + CI) ✅

- `justfile`: new `lint-md` recipe (`node harness/cli/bin/harness.js markdown-lint`, AGENTS.md not-npx) appended → **`fft: fix format test lint-md`**. `just lint-md` green (degraded/exit 0).
- `package.json`: `"lint:md"` script. All 5 tools confirmed **devDependencies only** (markdownlint-cli2, mermaid, remark-cli, remark-validate-links, jsdom); `npm pack --dry-run` ships none of them (`files` = bin/dist/LICENSE) — finding 07 verified.
- `.github/workflows/ci.yml`: a `Markdown conformance (harness markdown-lint)` step mirroring the arch-check/skills-check warn-launch pattern (degraded → `::warning::`, exit 0; missing tool/crash still fails).
- **Full `just fft` NOT run destructively**: `fix`/`format` are biome `--write harness/cli`, and the tree currently has **other agents' uncommitted biome errors** (e.g. `harness/cli/test/services/flow/flow-chore.test.ts` noUnusedImports). Running `--write` would edit their in-progress files (shared-tree constraint). Validated the fft components non-destructively instead: `test` green (890), `lint-md` green (exit 0), and biome `--write` only touches `harness/cli` (biome ignores `.harness/extensions/**`, so it never sees this extension). The lint-md wiring is correct and green; full-loop green holds once the tree is biome-clean (an other-agent concern, not this change).

---

## T011 — `docs/how/extend-the-harness.md` mention ✅

Added a "worked example" paragraph under § Wrap, don't rebuild pointing at `harness markdown-lint` as the in-tree multi-tool exemplar. Re-ran the verb: the edit added no finding; the new directory link resolves.

## T012 — Dogfood retro ✅

`docs/retros/029-markdown-lint-extension.md` (under the ignored `docs/retros/**`). Captures 5 friction items (MH-029-01..05) + 5 follow-ups. Headlines: the mermaid/DOMPurify discovery (MH-029-01), `ctx.exec` has no stdin (FU-029-01 magic wand), extension TS is unchecked by `fft` (FU-029-02), and `fft`'s destructive `--write` is unsafe in a shared tree (FU-029-04).

---

## Phase complete — build (stage 6) ✅

All 12 tasks done. Final verification:
- **Unit tests**: 48 colocated (scope/extract/decision) pass; full suite 890 pass.
- **Loaded**: `harness doctor` → markdown-lint `loaded`, no `E144`; `harness help` lists it with 📖 (instructions). 5 extensions, 0 failed.
- **Live run**: `degraded`/exit 0; mermaid **pass** (12/12); **AC-04 verified** (zero findings from excluded dirs).
- **Live-count note**: the finding count tracks the working tree, so it drifts as other agents edit in-scope docs — observed it move 7→8 markdownlint mid-build when a concurrent edit added an `MD026` in `docs/guide/14-metrics-and-measures.md` (not ours). Snapshot at hand-off: 8 markdownlint + 1 link = 9, all in-scope, all warn-launch advisories.

**Acceptance**: AC-01✓ (loaded+📖) · AC-02✓ (three checks, one envelope) · AC-03✓ (ok/degraded/unconfigured honesty) · AC-04✓ (excluded dirs zero) · AC-05✓ (pure libs unit-tested, `just test` green) · AC-06◑ (`lint-md` wired into `fft` + green; full `fft` not run destructively — other agents' biome WIP) · AC-07✓ (headless mermaid via subprocess; jsdom shim, no Chromium).

**Scope additions over the plan (logged)**: `lib/scope.ts` (+test) as the single scope source; **jsdom** devDependency to make `mermaid.parse()` actually headless on labeled diagrams. Both strengthen the original intent; neither widens the frozen check scope.

---

## Review (stage 7) — APPROVE ✅

Companion/subagent review (`reviews/review.md`, verdict **APPROVE**): zero HIGH/CRITICAL across all five lenses; output-parsing paths independently verified against the real tools; argv-only `ctx.exec` (injection-safe), local bins (no `npx`), remark check-only confirmed; 48 unit tests meaningful, suite 890 green; tools correctly devDependencies (excluded from the published package). Two LOW advisories — both **fixed**:

- **F001** — `git ls-files` C-quotes non-ASCII filenames → silently under-scoped. **Fixed**: `git ls-files -z` + split on `\0` (raw NUL-delimited paths). Happy path unchanged (64 files); now robust to non-ASCII.
- **F002** — `--dir ./x` not normalized → matched 0 files → false `ok`. **Fixed**: route `--dir` through `normalizePath` (strips leading `./`). Verified: `--dir ./docs/how` and `--dir docs/how` both scope to 9 files.

Re-verified after the fixes: 48 unit tests pass, verb `loaded`. AC-06 soft spot (full `just fft` not run end-to-end) stands — wiring present + `just lint-md` green; blocked only by other agents' uncommitted biome errors in the shared tree, not by this change.

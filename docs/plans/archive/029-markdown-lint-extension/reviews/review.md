# Code Review: markdown-lint extension (plan 029, Simple Mode)

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/029-markdown-lint-extension/markdown-lint-extension-plan.md
**Spec**: same file § Business Specification (unified plan)
**Phase**: Simple Mode (one phase, tasks T001–T012)
**Date**: 2026-06-19
**Reviewer**: Automated (the review verb) + an independent code-review subagent
**Testing Approach**: Lightweight (Simple-mode default) — colocated vitest unit tests on the pure libs; the shell proven by running the verb + `harness doctor`

## A) Verdict

**APPROVE**

Zero HIGH/CRITICAL findings. The implementation is sound, well-documented, faithful to the plan's frozen § Scope contract and warn-launch posture, and matches the existing `arch-check`/`skills-check` extension patterns. Two **LOW** latent edge cases are recorded below as non-blocking advisories — each has a clean one-line fix and neither has any active impact in this repo today.

**Key failure areas**: none. (All five lenses clean: implementation, domain compliance, reinvention, testing, doctrine.)

## B) Summary

`harness markdown-lint` wraps three third-party tools — markdownlint-cli2 (style), remark-validate-links (in-repo links + heading anchors, check-only), and a headless `mermaid.parse()` subprocess (syntax, no Chromium) — behind one honest envelope, filtering `git ls-files '*.md' '*.markdown'` through a single frozen scope contract (`lib/scope.ts`) so all three checks share one file set (AC-04). The risk-carrying glue (scope globs, the mermaid fence state machine, the envelope decision) is isolated in pure, `node:*`-free libs and covered by **48 table-driven unit tests** (33 scope + 10 extract + 5 decision), all passing under `just test` (full suite 890 pass). Security is clean: every `ctx.exec` call uses argv arrays (no `bash -c`, no shell interpolation), local bins are invoked by path (never `npx`), and remark runs check-only (no `--output` file rewrite). Domain compliance is **N/A** — no `docs/domains/` registry exists, as the plan states; the work lives correctly within the `.harness/extensions/` boundary. The five new markdown tools are correctly `devDependencies` only (the published package `files` whitelist excludes `.harness/`, so consumers never receive the extension or need its tools).

## C) Checklist

**Testing Approach: Lightweight**

- [x] Core validation tests present (48 unit tests over the three pure libs)
- [x] Critical paths covered (fence extraction edge cases, glob/ignore precedence, all four envelope states + precedence)
- [x] Key verification points documented (execution.log.md records spikes + live `--json` runs per task)
- [x] Only in-scope files changed (15 plan-029 files; other agents' shared-tree changes excluded from this review)
- [x] Linters/type checks: `just test` green; **note**: the extension's own TS is not type-checked by `fft` (pre-existing harness gap, retro FU-029-02) — jiti load (`harness doctor` → `loaded`) + the 48 tests provide coverage
- [x] Domain compliance: N/A (no `docs/domains/` registry) — file placement verified under `.harness/extensions/markdown-lint/`
- [~] `just fft` end-to-end green: **partially verified** — wiring is correct and `just lint-md` is green, but the full `just fft` was deliberately not run because other agents' uncommitted biome errors are present in the shared working tree (see AC-06)

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | LOW | `.harness/extensions/markdown-lint/extension.ts:171,177` | correctness | `git ls-files` C-quotes non-ASCII filenames (`core.quotePath` default on); the quoted form fails the scope filter, so a non-ASCII-named authored doc is silently dropped from all three checks | Use `git ls-files -z` and split on `\0` (the `-z` form is unquoted, NUL-terminated), or pass `-c core.quotePath=false`. No such files exist today — latent. |
| F002 | LOW | `.harness/extensions/markdown-lint/extension.ts:178-179` | correctness | `--dir` is normalized for backslashes + trailing slashes but not a leading `./`; the file list is normalized without `./`, so `--dir ./docs/how` filters to an empty set and the verb returns `ok` over 0 files (false "all clean") | Run `dir` through the same `normalizePath` (strip a leading `./`) from `lib/scope.ts` before filtering. Footgun, not a live failure. |

No CRITICAL, HIGH, or MEDIUM findings.

## E) Detailed Findings

### E.1) Implementation Quality

Both the primary review and an independent code-review subagent (which verified the two fragile output-parsing paths against the **actually installed tools**, ran the mermaid runner in isolation, ran the 48 unit tests, and probed the scope/`--dir` logic against the real modules) found the implementation sound. Verified-correct axes:

- **Mermaid fence state machine (`lib/extract.ts`)** — correct backtick-count matching, tilde fences, the 4-backtick-wrapped `` ```mermaid `` example (not extracted), CommonMark info-string backtick rejection, 4-backtick body containing a 3-backtick line, unterminated-at-EOF (best-effort), and CRLF normalization. Tracks **all** fences so a shown-example mermaid block is skipped (finding 02).
- **`globToRegExp` / `inScope` (`lib/scope.ts`)** — probed against over/under-match traps (`docs/guideline` vs `docs/guide/**`, `reviews-summary.md` vs `**/reviews/**`, `previews` vs `reviews`, `README.mdx` anchoring, `**/`-zero-dir). The `(?:.*/)?` construction segment-aligns `**/` correctly; ignore correctly beats include.
- **Envelope decision (`lib/decision.ts`)** — `unavailable → unconfigured/exit 2` precedence beats `findings → degraded/exit 0`; totals sum findings exactly once; pass → ok with evidence counts.
- **markdownlint parsing (`extension.ts`)** — empirically verified against markdownlint-cli2 0.22.x real output: findings carry the severity word (`path:L:C error MDxxx`) so the regex matches; exit 1 on findings skips the pass branch; `Summary: N error(s)` drives the count. Exit code is **not** trusted alone (finding 03/06).
- **remark parsing (`extension.ts`)** — empirically verified: remark-validate-links sets `message.source = 'remark-validate-links:<ruleId>'`, so the `'remark-validate-links:'` stderr filter matches and the per-line count is accurate; the report goes to stderr; `--frail` (exit 1) + no `--output` (check-only) confirmed. A non-zero exit with no link findings is correctly reported as a processing failure (`unavailable`), not a finding.
- **Mermaid subprocess (`mermaid-runner.mjs`)** — runs headless via the jsdom DOM shim (pure JS, no Chromium — AC-07), silences console, always exits 0 with JSON on stdout (validity travels in the JSON), shell reads the last stdout line; bad-payload/load-error paths degrade to `unavailable`, never crash. Exits promptly (~0.68s — no event-loop hang).
- **Shell robustness** — `Promise.all` over three read-only checks (no shared mutable state); outer try/catch returns `ctx.error` (never throws); every `ctx` helper call matches the contract signature; every non-ok result carries a `next_action`.
- **ARG_MAX** — `JSON.stringify(fences)` as one argv arg and the file list as argv are well under the ~1 MB platform limit at the authored-docs scale; acknowledged in code comments. Non-issue here (would only matter if scope grew by orders of magnitude).

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | All sources under `.harness/extensions/markdown-lint/`; pure libs in `lib/`; colocated `*.test.ts` |
| Contract-only imports | ✅ | Imports `@ai-substrate/engineering-harness/contract` (type-only) — matches arch-check; no reach into core internals |
| Dependency direction | ✅ | Extension → contract types only; pure libs have no `node:*` imports; I/O only via `ctx` |
| Domain.md updated | N/A | No `docs/domains/` registry exists |
| Registry current | N/A | No `docs/domains/registry.md` |
| No orphan files | ✅ | Every changed file maps to the plan's § Domain Manifest |
| Map nodes current | N/A | No `docs/domains/domain-map.md` |
| Map edges current | N/A | No domain map |
| No circular business deps | N/A | No domain map |
| Concepts documented | N/A | No domain contracts (no registry) |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| `markdown-lint` verb (markdown/links/mermaid checks) | None — arch-check wraps dependency-cruiser; skills-check validates skills | n/a | proceed (new capability) |
| envelope-decision pure lib | Pattern mirrors `arch-check/mapping.ts` (intentional pattern reuse, not capability duplication) | n/a | proceed |

The extension **reuses the established pattern** (thin shell + pure unit-tested `lib/` + subprocess for the heavy import) without duplicating any existing capability. No reinvention.

### E.4) Testing & Evidence

**Coverage confidence**: 90%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-01 loaded + 📖 | 95% | execution.log.md: `harness doctor` → markdown-lint `loaded`, no `E144`; `harness help` lists it |
| AC-02 three checks, one envelope | 95% | `extension.ts` `Promise.all([mdl,links,mermaid])` → `decide()`; live `--json` run recorded |
| AC-03 envelope honesty | 100% | `decision.test.ts` proves all four states + precedence; live `degraded`/exit 0 run recorded |
| AC-04 excluded dirs zero | 95% | `scope.test.ts` (ignore-beats-include, 33 tests); exec log "AC-04 verified — zero from excluded dirs" |
| AC-05 pure logic unit-tested | 100% | 48 colocated tests pass; full suite 890 pass |
| AC-06 `just fft` green | 70% | wiring `fft: fix format test lint-md` present + `just lint-md` green; full `fft` NOT run end-to-end (other agents' uncommitted biome errors in the shared tree) |
| AC-07 headless mermaid | 100% | `mermaid-runner.mjs` run independently — valid/invalid classify, exits 0, no Chromium |

Tests are meaningful (real assertions over real markdown/mermaid fixtures, no mocks) — they pay rent rather than padding coverage.

### E.5) Doctrine Compliance

Aligned with `docs/project-rules/constitution.md` and `rules.md`/`idioms.md`:

- **P4 (CLI is the API)** ✅ — returns the stable envelope via `ctx` helpers.
- **P5 (Honesty over fake success)** ✅ — missing tool/config → `unconfigured` + `next_action`, exit 2.
- **P6 (Documented exit-code semantics)** ✅ — `instructions.md` outcome table documents 0/2/1.
- **P7 (Diagnostics prescribe the fix)** ✅ — every non-ok result carries a `next_action`.
- **P8 (Wrap, don't rebuild)** ✅ — wraps three real bins; only the glue is original.
- **P9 (Evidence over assertion)** ✅ — returns `totals` (filesLinted/linksFilesChecked/fencesParsed) + per-check `examined`; instructions explicitly state no durable files are written.
- **P10 (Dynamic, extension-owned verbs)** ✅ — the verb supplies its own name/summary/description/options; core hardcodes nothing.
- **P11 (Fast, repeatable local feedback)** ✅ — wired into `just fft` (warn-launch keeps it non-blocking).
- **rules.md §4 (runtime deps in `dependencies`)** ✅ — correctly **not** triggered: the five tools are dogfood-only `devDependencies`; `.harness/` is excluded from the published `files`, so consumers never need them.
- Pure libs carry **no `node:*` imports**; the heavy mermaid/jsdom import is isolated in the `.mjs` subprocess (matches the architecture's adapter-boundary discipline).

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-01 | Loaded verb + instructions.md | `harness doctor`/`help` (exec log) | 95% |
| AC-02 | Three checks, one aggregated envelope | `extension.ts` + live run | 95% |
| AC-03 | ok/degraded/unconfigured honesty | `decision.test.ts` + live run | 100% |
| AC-04 | Excluded dirs contribute zero findings | `scope.test.ts` + live run | 95% |
| AC-05 | Pure logic unit-tested, `just test` green | 48 tests + 890 suite | 100% |
| AC-06 | `just fft` invokes the verb and stays green | wiring + `just lint-md` green; full fft not run (shared tree) | 70% |
| AC-07 | Headless mermaid via subprocess | runner executed independently | 100% |

**Overall coverage confidence**: 90% (the single soft spot is AC-06's end-to-end `just fft` green, blocked by unrelated shared-tree breakage, not by this change).

## G) Commands Executed

```bash
# Inputs & scope
find docs/plans/029-markdown-lint-extension -type f
git --no-pager status --short ; git branch --show-current
find .harness/extensions/markdown-lint -type f

# Static review (read-only)
git --no-pager diff -- justfile .github/workflows/ci.yml docs/how/extend-the-harness.md package.json
ls docs/domains ; ls docs/project-rules ; ls .harness/extensions
node -e "require('./node_modules/remark-cli/package.json').version"        # 12.0.1 (matches ^12.0.1)
node -e "require('./node_modules/remark-validate-links/package.json').version"  # 13.1.0
node -e "p=require('./package.json'); p.files; '.harness' in files? -> false"

# Computed diff (scoped to plan 029, non-destructive: intent-to-add then reset)
git add -N <plan-029 paths>
git --no-pager diff -- <plan-029 paths> > docs/plans/029-markdown-lint-extension/reviews/_computed.diff
git reset -q -- <plan-029 paths>

# Independent code-review subagent additionally ran (read-only):
#   ./node_modules/.bin/markdownlint-cli2 <docs>   (verify finding-line + Summary parsing)
#   ./node_modules/.bin/remark --frail --quiet <docs>  (verify remark-validate-links: source label)
#   node .harness/extensions/markdown-lint/lib/mermaid-runner.mjs '<fences-json>'  (verify headless + exit 0)
#   node -e "<glob/scope/--dir probes against the real modules>"
```

> Per the review contract this verb is read-only and did **not** run `harness markdown-lint` itself; the runtime evidence is the execution log plus the independent agent's isolated tool runs.

## H) Handover Brief

> Copy this section to the implementing agent. It has context only on the work done before the review.

**Review result**: APPROVE

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/029-markdown-lint-extension/markdown-lint-extension-plan.md
**Spec**: same file § Business Specification
**Phase**: Simple Mode (tasks T001–T012)
**Tasks dossier**: inline in the plan (§ Implementation task table)
**Execution log**: /Users/jordanknight/substrate/harness-engineering/docs/plans/029-markdown-lint-extension/execution.log.md
**Review file**: /Users/jordanknight/substrate/harness-engineering/docs/plans/029-markdown-lint-extension/reviews/review.md
**Computed diff**: /Users/jordanknight/substrate/harness-engineering/docs/plans/029-markdown-lint-extension/reviews/_computed.diff

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/harness-engineering/.harness/extensions/markdown-lint/extension.ts | created | n/a | Optional: F001 + F002 one-line hardening |
| /Users/jordanknight/substrate/harness-engineering/.harness/extensions/markdown-lint/lib/scope.ts | created | n/a | none |
| /Users/jordanknight/substrate/harness-engineering/.harness/extensions/markdown-lint/lib/extract.ts | created | n/a | none |
| /Users/jordanknight/substrate/harness-engineering/.harness/extensions/markdown-lint/lib/decision.ts | created | n/a | none |
| /Users/jordanknight/substrate/harness-engineering/.harness/extensions/markdown-lint/lib/mermaid-runner.mjs | created | n/a | none |
| /Users/jordanknight/substrate/harness-engineering/.harness/extensions/markdown-lint/scope.test.ts | created | n/a | none (33 tests) |
| /Users/jordanknight/substrate/harness-engineering/.harness/extensions/markdown-lint/extract.test.ts | created | n/a | none (10 tests) |
| /Users/jordanknight/substrate/harness-engineering/.harness/extensions/markdown-lint/decision.test.ts | created | n/a | none (5 tests) |
| /Users/jordanknight/substrate/harness-engineering/.harness/extensions/markdown-lint/instructions.md | created | n/a | none |
| /Users/jordanknight/substrate/harness-engineering/.markdownlint-cli2.jsonc | created | n/a | none (rules-only, each disable rationaled) |
| /Users/jordanknight/substrate/harness-engineering/.remarkrc.json | created | n/a | none |
| /Users/jordanknight/substrate/harness-engineering/justfile | modified | n/a | none (`fft: fix format test lint-md`) |
| /Users/jordanknight/substrate/harness-engineering/package.json | modified | n/a | none (lint:md script + 5 devDeps) |
| /Users/jordanknight/substrate/harness-engineering/.github/workflows/ci.yml | modified | n/a | none (warn-launch CI step) |
| /Users/jordanknight/substrate/harness-engineering/docs/how/extend-the-harness.md | modified | n/a | none (worked-example paragraph) |

### Required Fixes (if REQUEST_CHANGES)

None — verdict is APPROVE. The two LOW advisories below are optional hardening, not required.

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| A1 (LOW, optional) | /Users/jordanknight/substrate/harness-engineering/.harness/extensions/markdown-lint/extension.ts:171,177 | `git ls-files -z` + split on `\0` (or `-c core.quotePath=false`) | A non-ASCII-named authored doc would otherwise be silently dropped from all three checks |
| A2 (LOW, optional) | /Users/jordanknight/substrate/harness-engineering/.harness/extensions/markdown-lint/extension.ts:178-179 | Run `--dir` through `normalizePath` (strip a leading `./`) before filtering | `--dir ./docs/how` otherwise checks 0 files and falsely reports `ok` |

### Domain Artifacts to Update (if any)

None — no `docs/domains/` registry exists.

### Handback

APPROVE, final phase: Implementation complete. The two LOW advisories are optional one-line hardening the implementer may fold into a follow-up commit or accept as latent (no impact in this repo today). AC-06's end-to-end `just fft` green should be re-confirmed once the shared working tree is biome-clean (an other-agent concern, not this change). Consider committing the plan-029 changes.

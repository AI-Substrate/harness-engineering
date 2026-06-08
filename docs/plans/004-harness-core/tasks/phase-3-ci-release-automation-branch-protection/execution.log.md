# Execution Log — Phase 3: CI, release automation, branch protection

**Plan**: ../../harness-core-plan.md
**Phase**: Phase 3 · CI, release automation, branch protection
**Started**: 2026-06-08
**Mode**: Full · Testing approach: standard (no agent harness) + live `code-review-companion` (Power-On-Mode)

## Pre-Phase Agent Harness Validation

| Stage | Status | Note |
|-------|--------|------|
| Boot / Interact / Observe | 🔴 UNAVAILABLE | No `docs/project-rules/engineering-harness.md` governance doc → no agent harness. Proceeding with standard testing (local command runs + `gh`-captured CI evidence). |

## Companion

- Slug: `code-review-companion` · Run: `2026-06-08T11-04-06-731Z-0c5a`
- Briefed once (type=briefing) with phase scope + hazards (F005 npx contract, check-name drift, forward-note slot-genericity, no npm publish, YAML correctness, staging discipline).
- minih AGENTS_README: https://github.com/AI-Substrate/minih/blob/main/AGENTS_README.md

## Environment facts (verified at phase start)

- Single **root** npm package (`harness-engineering`, v0.1.0); NO `harness/cli/package.json`.
- `package-lock.json` present + tracked → `npm ci` + `setup-node cache: npm` valid.
- Build → `harness/cli/dist`; vitest cwd = `harness/cli`; coverage → `harness/cli/coverage/lcov.info` (reporters `text-summary`,`lcov`).
- bin shebang present; `gh` token has **admin** on the repo (branch protection can apply live).
- YAML validated locally with PyYAML (no actionlint on PATH).

---

## Tasks

### T001 — `.github/workflows/ci.yml` core (in progress)

- Added `.github/workflows/ci.yml`: `on: pull_request` + `push: [main]`; `permissions: contents: read`; `concurrency` (cancel-in-progress); `build-test` job on Node 20/22 matrix (`fail-fast: false`) with steps checkout → setup-node (cache npm) → npm ci → biome check → build → tsc --noEmit → vitest --coverage → `npm audit --audit-level=high || true`.
- Added a stable **`ci-required`** gather job (`needs: [build-test]`, `if: always()`, fails if any needed job failed/cancelled) so branch protection (T005) references one matrix-independent check name. `ci-required` will gain `package-smoke` as a dependency in T003 (keeps every intermediate commit a valid workflow).
- YAML validated with PyYAML (the `KeyError: 'on'` is the PyYAML-1.1 boolean-key quirk, not a workflow error). Local CI mirror proven green: biome clean (52 files), `npm run build` OK, `tsc --noEmit` exit 0, **96 tests pass, 92.2% coverage** (text-summary prints → AC-14 partial).
- **Done-When met**: workflow parses; checkout precedes `npm ci`; each step runs green locally; `ci-required` gather job exists with a fixed name.

### T002 — coverage surfacing + lcov artifact (done)
- Added `Upload coverage (lcov)` step to `build-test` (`actions/upload-artifact@v4`, `if: always()`), artifact name `coverage-lcov-node${{ matrix.node }}` (per-matrix → no upload-v4 duplicate-name error), path `harness/cli/coverage/lcov.info`, `if-no-files-found: error` (fails the job if coverage didn't generate).
- text-summary already prints via the vitest reporter (`['text-summary','lcov']`) — no config change needed (AC-14).
- Verified locally: `harness/cli/coverage/lcov.info` present (9 KB). YAML re-validated.
- **Done-When met**: a CI run will show the coverage summary in the log and a downloadable `lcov.info` artifact.

### T003 — packaging / bin-symlink smoke job (F005 guard) (done)
- Added `package-smoke` job (`needs: [build-test]`): checkout → setup-node(20) → npm ci → build → **pack + install + invoke**. Packs the tarball, `npm install`s it into a clean temp project, and runs the installed `harness` bin **through its `node_modules/.bin/harness` symlink** — exactly the F005 path an ESM `isMain` guard would silently break.
- Updated `ci-required` to `needs: [build-test, package-smoke]` (now gates both).
- **Proven locally end-to-end before wiring**: `npm pack` → `npm install` into a temp project → `node_modules/.bin/harness -> ../harness-engineering/harness/cli/dist/index.js` → `harness --version` = `0.1.0` (exit 0), `harness doctor` exit 0 (from a non-git temp dir → degraded layers still map to 0). Generic invocation only (no slot-list assertion → forward-note compliant).
- **Done-When met**: job packs, installs from the tarball, and the installed `harness` bin runs (exit 0) — npx/bin-symlink contract proven.

### T004 — release automation (release-please) (done)
- `release-please-config.json`: `release-type: node`, `bump-minor-pre-major: true`, `include-component-in-tag: false` (→ clean `vX.Y.Z` tags for the spec's `npx github:…#vX.Y.Z` pin), `packages: { ".": {} }`.
- `.release-please-manifest.json`: `{ ".": "0.1.0" }` — verified == root `package.json` version.
- `.github/workflows/release.yml`: `on: push: [main]`; `permissions: contents:write + pull-requests:write`; steps checkout → `googleapis/release-please-action@v4` (config-file + manifest-file). **No npm publish step** (AC-15) — installs use npx-from-repo.
- JSON + YAML validated; version-match confirmed.
- **Done-When met**: workflow parses; config/manifest valid JSON with matching version; a conventional-commit push to `main` would open a release PR; no publish step.

### T005 — branch protection on main (applied live) (done)
- **Applied live** (admin confirmed) via `gh api -X PUT .../branches/main/protection`:
  `required_status_checks: { strict:false, contexts:["ci-required"] }`, `enforce_admins:false`, `required_pull_request_reviews:null`, `restrictions:null`.
- **Verified** via GET: required check `ci-required`, strict `false`, enforce_admins `false`, required_reviews `null`, force-pushes disabled.
- Design choices: **no required human review** + **enforce_admins:false** so the feature PR can still be merged in `/plan-8` (the `ci-required` check is the gate, not a second reviewer); `strict:false` avoids forcing rebases. AC-16 met: required CI must pass before merge.
- Documented the exact `gh api` apply + verify commands in `harness/cli/README.md` (new "Continuous Integration & Release" section).
- **Done-When met**: `gh api` returns protection with the `ci-required` check required; command documented in README.

### T006 — validate CI end-to-end on the PR (done)
- Pushed `feat/harness-cli-core`; opened **PR #1** → CI run **27110680201** triggered (`pull_request`).
- **`gh pr checks 1` — all pass**: `build-test (20)` ✓, `build-test (22)` ✓, `package-smoke` ✓, `ci-required` ✓.
- **Coverage in CI log** (AC-14): `96 passed`, `Statements 92.2% (201/218)`, `Branches 91.04%`, `Functions 94.59%`, `Lines 91.98%`.
- **Artifacts uploaded**: `coverage-lcov-node20` (2667 B), `coverage-lcov-node22` (2667 B).
- **Required-check name confirmed**: `ci-required` (matrix-independent) — matches what T005 protected; no drift.
- **Done-When met**: `gh pr checks` lists CI jobs completed; coverage summary in the log; lcov artifacts present.

## Discoveries & Learnings

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-08 | T001 | gotcha | PyYAML 1.1 parses bare `on:` as boolean `True` → `KeyError:'on'` when introspecting workflows locally. | Cosmetic only (GitHub parses `on` as a string key); read via `d.get('on', d.get(True))`. | execution.log T001 |
| 2026-06-08 | T003 | insight | `harness doctor` exits 0 even from a **non-git temp dir** (degraded layers → exit 0), so the smoke's exit-0 assertion is safe in CI. | Verified locally before wiring. | execution.log T003 |
| 2026-06-08 | T001/T005 | decision | Stable `ci-required` aggregation job (`if:always()` + `contains(needs.*.result,'failure')`) gives branch protection a matrix-independent required check. | Adopted from validation; confirmed green in CI. | ci.yml, T005 |
| 2026-06-08 | T006 | debt | GitHub advisory: `actions/checkout@v4`/`setup-node@v4`/`upload-artifact@v4` run on the deprecated Node 20 **action runtime** (forced to Node 24 from 2026-06-16). | Non-blocking warning; `@v4` is current major. Bump when v5 lands. | CI run 27110680201 annotations |

## Phase 3 Result — Acceptance Criteria

| AC | Status | Evidence |
|----|--------|----------|
| AC-13 (CI on PR+main: build+biome+test+coverage+audit) | ✅ | CI run 27110680201 — build-test 20/22 pass with all steps; triggers `pull_request` + `push:[main]`. |
| AC-14 (coverage reported) | ✅ | Coverage summary in job log (92.2% statements) + `coverage-lcov-node{20,22}` artifacts. |
| AC-15 (release-please configured, release-type node, semver, no publish) | ✅ | `release-please-config.json` + manifest (0.1.0) + `release.yml` (release-please-action@v4); no publish step. |
| AC-16 (main branch-protected, required CI before merge) | ✅ | `gh api .../branches/main/protection` → required check `ci-required`; documented in CLI README. |

**Build reconciliation**: 6 tasks (T001–T006) built across 5 commits + 1 live `gh api` action; companion reviewed every commit.

## Companion debrief (run 2026-06-08T11-04-06-731Z-0c5a)

- **Verdict**: APPROVE — **0 findings** across T001–T006 + final sweep. Every commit reviewed live (ackOf-linked summaries).
- **Findings reconciliation**: none to reconcile — clean phase.
- **MH-003 (companion catch, applied)**: the T006 evidence commit `b7c7af8` triggered a *newer* CI run than the documented `27110680201`. The companion verified the final HEAD run **27110754122** before approving. Confirmed here: `gh pr checks 1` for HEAD `b7c7af8` → build-test (20/22), package-smoke, ci-required **all pass** (run 27110754122). Evidence integrity intact.
- **Companion magicWand** (→ backlog candidate): a minih coordination summary endpoint returning run output path, project root, acked-task count, findings/questions/peer-update counts as JSON + schema validation in one command. Target: coordination (minih runtime, not this repo).
- **Difficulties logged**: MH-001 (MINIH_PROJECT_ROOT not in shell env), MH-002 (gh pager blocked; fixed with `GH_PAGER=cat`), MH-003 (timing — newer CI run; resolved). All minih-runtime, not harness-CLI issues.

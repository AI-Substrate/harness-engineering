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

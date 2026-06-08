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

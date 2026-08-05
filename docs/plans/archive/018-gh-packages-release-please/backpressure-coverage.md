# Backpressure Coverage — Publish to GitHub Packages (release-please)

**Spec**: [gh-packages-release-please-spec.md](./gh-packages-release-please-spec.md)
**Generated**: 2026-06-11
**Certainty**: Partial

> Advisory only — informs `plan-3`. Never blocks, never gates, no scores. (See eng-harness-2-backpressure.)

## Existing Sensors (inventory)

Discovered by globbing actual tooling (single root: `package.json` at repo root, CLI source under `harness/cli/`; no workspace manifest; no browser e2e).

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| **package-smoke** (the load-bearing one) | CI `package-smoke`: `npm pack` → `npm install --omit=dev <tgz>` → load a `.ts` extension fixture via jiti → assert `doctor`/`hello`/`boom`/`E143` | behaviour | `.github/workflows/ci.yml:125` |
| build (`gen:docs` + tsc) | `npm run build` / `just build` | behaviour + maintainability | root |
| typecheck | `npx tsc --noEmit -p harness/cli/tsconfig.json` (CI) | maintainability | `ci.yml` build-test |
| docs-drift guard | `npm run check:docs` (regenerates `docs-content.ts`, `git diff --exit-code`) | behaviour | root |
| unit/integration suite | `just test` → `cd harness/cli && vitest run --coverage` (incl. `templates.test.ts` import-string assertions + integration tests that **load `.harness/extensions` fixtures via jiti**) | behaviour | `harness/cli/vitest.config.ts` (= the governance **boot** command) |
| lint | `npx biome check harness/cli` | maintainability | root |
| arch-check | `node harness/cli/bin/harness.js arch-check` (dependency-cruiser) | architecture-fitness | `.dependency-cruiser.cjs` |

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail (ABSENT only) |
|--------------------------|----------------------|--------|------|----------------------------|
| AC-1 name/bin/exports correct after rename | build + tsc; package-smoke fixture imports the package by name | **EXISTS** | computational | — |
| AC-5 tarball has `dist` + deps; `--omit=dev` install resolves `commander`/`jiti` and `harness help` runs | **package-smoke** (already does pack→install→run under `--omit=dev`) | **EXISTS** | computational | — |
| AC-6 exhaustive rename; **no stale `harness-engineering/contract`**; `check:docs` green | check:docs + vitest (`templates.test.ts`) + tsc + package-smoke fixture compile | **EXISTS** | computational | — |
| AC-6 (cont.) — a stale specifier *slips past* the typed sites (e.g. a comment/doc) | a `grep -rn "harness-engineering/contract" == 0` CI check (excl. `docs/plans/**`) | **BUILDABLE** | computational | — |
| AC-6 repo's **own** `.harness/extensions/*` still load post-rename (self-reference resolution) | vitest integration tests + `harness doctor` (boot loads extensions) | **EXISTS** | computational | — |
| AC-2 `publishConfig.registry` + `repository` field correct | `npm publish --dry-run` asserting registry/name (AC-8) | **BUILDABLE** | computational | — |
| AC-3 / AC-4 release-please publishes on merge, **gated + authed** | **AC-11 branch-canary `workflow_dispatch`** (end-to-end publish) + first real release | **BUILDABLE** | computational | — |
| AC-8 dry-run asserts scoped name + `bin`/`dist` included | the dry-run step itself | **BUILDABLE** | computational | — |
| AC-9 no "no npm publish" copy remains | `grep` check over `release.yml`/README/spec | **BUILDABLE** | computational | — |
| AC-10 scope `@ai-substrate` == repo owner | trivial CI assertion (`package.json` name scope == owner) | **BUILDABLE** | computational | — |
| AC-11 canary publish works end-to-end (auth + registry acceptance) | the canary dispatch — once built it *is* the EXISTS sensor for the publish path | **BUILDABLE** | computational | — |
| Org infra: GITHUB_TOKEN allowed to publish packages; package↔repo link; visibility | none in-repo — org/Actions settings | **ABSENT** | human-judgement | not a repo sensor — globbed `.github/`, org settings live outside the repo; routed to the Preconditions block + manual verification |
| AC-10 install-doc **prose adequacy** (is the `.npmrc`/token guidance clear?) | — | **ABSENT** | inferential | reviewer/`plan-7` judgement — globbed for a docs-lint sensor: none |

## Certainty: Partial

The **install/rename correctness** — the highest-risk surface (a missed rename or a broken install) — is covered by **EXISTS** sensors: `package-smoke` already proves the exact pack→install→run path under `--omit=dev`, and `check:docs` + vitest + tsc catch the rename ripple. The **new publish-automation** criteria are **BUILDABLE** — their sensors (the AC-8 dry-run, the AC-11 canary, the AC-6 grep, the AC-10 scope check) are *specified in the spec but do not exist yet* → **Partial**. The only **ABSENT** rows are legitimately non-computational (org-level publish permissions = human-judgement; install-doc prose = inferential/`plan-7`).

## Recommended Phase 0: Establish Backpressure

> Routing note: every sensor below is **already specified in the spec's ACs** — so this is *not* a separate Phase 0 to insert, it's a flag for `plan-3` to **sequence the sensor-building early** (build the canary + dry-run + grep first, so the publish path is provable before the first real release is trusted). The canary (AC-11) is the keystone: it converts the entire publish path from BUILDABLE to EXISTS *before* merge.

| Sensor to build | Proves | Suggested form |
|-----------------|--------|----------------|
| Branch-canary `workflow_dispatch` publish (AC-11) | AC-3/AC-4/AC-11 + registry auth/acceptance, end-to-end, **pre-merge** | GitHub Actions `workflow_dispatch` job (unique `-canary.<run>` version, `canary` dist-tag) |
| `npm publish --dry-run` step (AC-8) | AC-2/AC-8 — scoped name + `bin`/`dist` packed | CI step against the GH Packages registry config |
| Stale-specifier grep gate (AC-6) | AC-6 — no `harness-engineering/contract` remains | one-line `grep -rn … == 0` CI check (excl. `docs/plans/**`) |
| Scope==owner assertion (AC-10) | AC-1/AC-10 — scope matches the org | trivial CI assert on `package.json` name |
| package-smoke fixture import update (AC-7) | AC-7 — existing install proof stays green under the new name | edit the `ci.yml` heredoc fixture import |

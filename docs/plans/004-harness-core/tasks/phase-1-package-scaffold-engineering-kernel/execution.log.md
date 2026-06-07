# Execution Log — Phase 1: Package scaffold + engineering kernel

**Plan**: [../../harness-core-plan.md](../../harness-core-plan.md)
**Phase**: Phase 1: Package scaffold + engineering kernel
**Mode**: Full · **Companion**: code-review-companion (Power-On-Mode), run `2026-06-08T08-17-59-139Z-9157`
**Started**: 2026-06-08

## Pre-Phase Agent Harness Validation

| Stage | Status | Note |
|-------|--------|------|
| Boot / Interact / Observe | 🔴 UNAVAILABLE | No `docs/project-rules/engineering-harness.md` (or legacy governance doc). Proceeding with standard vitest testing per plan. |

## Companion findings disposition

| Finding ID | ackOf (review-request) | Severity | Disposition | Notes |
|-----------|------------------------|----------|-------------|-------|
| _(none yet)_ | | | | |

---

## Task Log

### T001 — Root package.json + tsconfig (+ scaffold stub)
**Status**: ✅ complete

- Created repo-root `package.json`: `"type":"module"`, `bin.harness → ./harness/cli/dist/index.js`, `"prepare":"npm run build"`, `"build":"tsc -p harness/cli/tsconfig.json"`, `files:["harness/cli/dist","LICENSE"]`, `engines.node ">=20"`, scripts (`test`/`lint`/`format`/`fix`). `commander` in **`dependencies`** (runtime); build/test tools in `devDependencies`.
- Created `harness/cli/tsconfig.json` (`rootDir:src`, `outDir:dist`, `module:ESNext`, `moduleResolution:Bundler`, `target:ES2022`, `strict`, `declaration`, `verbatimModuleSyntax`).
- **Discovery (decision)**: `"prepare": "npm run build"` runs `tsc` on every `npm install`; with no source, the first install would fail (`TS18003: no inputs`). Added a minimal `harness/cli/src/index.ts` stub in T001 (replaced by the real entrypoint in T009) so the toolchain bootstraps. Logged below.
- **Discovery (decision)**: `npm install` reported **2 critical** advisories in `vitest <4.1.0` (`@vitest/coverage-v8` transitively) — the Vitest UI dev-server arbitrary-file advisory (GHSA-5xrq-8626-4rwp). Dev-only, but Phase 3 plans an `npm audit` gate, so bumped `vitest` + `@vitest/coverage-v8` from `^3.2` → **`^4.1.8`**. Re-audit: **0 vulnerabilities**. No migration cost (test surface is net-new).
- **Evidence**: `npm install` succeeded; `prepare`→`tsc` emitted `harness/cli/dist/index.js`; `node harness/cli/dist/index.js` → `harness CLI — scaffold`; `npm audit` → `found 0 vulnerabilities`.
- **AC**: AC-1, AC-2 (partial — full surface lands across the phase).

### T002 — Root biome.json
**Status**: ✅ complete

- Created `biome.json` (schema 2.4.16): formatter (2-space, lineWidth 100), linter recommended, `javascript.formatter` single quotes + semicolons + trailing commas, `assist.actions.source.organizeImports: on`, `files.includes` scoped to `harness/cli/**/*.ts` with `!**/dist/**` + `!**/node_modules/**`, `vcs.useIgnoreFile`.
- **Note**: Biome 2.x config keys differ from 1.x — `files.includes` (negated globs) replaces `files.ignore`; `organizeImports` lives under `assist.actions.source`.
- **Evidence**: `npx biome check harness/cli` → "Checked 1 file. No fixes applied." (config valid, scaffold clean).
- **AC**: AC-3 (biome portion).

### T003 — vitest.config.ts (coverage, report-only)
**Status**: ✅ complete

- Created `harness/cli/vitest.config.ts`: `include: ['test/**/*.test.ts']`, `passWithNoTests: true`, coverage provider `v8`, reporters `text-summary` + `lcov`, coverage `include: src/**/*.ts` (excludes the thin `src/index.ts`). **No thresholds** (R5 — report-only).
- devDeps already installed in T001 (`npm install`); vitest is `^4.1.8`.
- **Evidence**: `cd harness/cli && npx vitest run --coverage` → vitest 4.1.8, "No test files found, exiting with code 0", coverage summary printed. No threshold failure.
- **AC**: AC-3 (vitest portion).

### T004 — justfile fft loop (Stage 1 complete)
**Status**: ✅ complete

- Appended to the existing root `justfile` (skill-ops recipes preserved): `fix` (`npx biome check --write harness/cli`), `format` (`npx biome format --write harness/cli`), `test` (`cd harness/cli && npx vitest run --coverage`), `fft: fix format test` (just-native prerequisite chaining → runs in order).
- Working dirs explicit: biome from repo root (where `biome.json` is), vitest from `harness/cli` (where `vitest.config.ts` is).
- **Evidence**: `just --list` shows all four recipes; `just fft` → biome checked 2 files clean, formatted clean, vitest exited 0 with coverage summary. Green end-to-end.
- **AC**: AC-3, AC-5. **Stage 1 (package + toolchain) complete.**

### T005 — Clock adapter (port/system/fake) [Stage 2]
**Status**: ✅ complete

- `src/adapters/clock/clock-port.ts`: `Clock { nowIso(): string }`.
- `src/adapters/clock/system-clock.ts`: `SystemClock` (only place wall-clock time is read).
- `src/adapters/clock/fake-clock.ts`: `FakeClock` — fixed instant, `advance(ms)`, `set(instant)`, records `calls[]` (fakes over mocks). Default instant `2026-06-08T07:20:00.000Z`.
- `test/adapters/clock/fake-clock.test.ts`: 5 tests (determinism, call history, advance, set, SystemClock ISO shape). All Test-Doc commented.
- All relative imports use `.js` extensions; type-only imports use `import type` (verbatimModuleSyntax).
- **Evidence**: `just fft` green — 5/5 tests pass; **100% coverage** on the Clock files. Pulled ahead of the kernel because the envelope constructors take an injected `Clock` (Finding 04).
- **AC**: contributes to AC-4 (kernel determinism foundation).

### T006 — Kernel tests (RED) [Stage 3]
**Status**: ✅ complete (red as intended)

- `test/output/envelope.test.ts`: formatOk (ok + degraded/evidence/next_action), formatUnconfigured (required next_action, no data/error), formatError (code+message, next_action defaults to message, explicit override), field-presence rule (next_action present when status≠ok). Test-Doc commented; FakeClock for deterministic timestamps.
- `test/output/exit.test.ts`: `exitCodeFor` status→exit map (ok=0, degraded=0, unconfigured=2, error=1) + explicit "unconfigured is 2 never 0".
- **Evidence (RED)**: `vitest run` → 2 failed (envelope.js/exit.js "Cannot find module"), 1 passed (clock). This is the intended TDD red step; T007 turns it green.
- **AC**: AC-4 (tests-first portion).

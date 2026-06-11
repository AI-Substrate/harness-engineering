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
| F001 | T006 | HIGH | ✅ fixed in `dac64fa`, re-verified | dry-run unconfigured worked example (#4) was untested + `formatUnconfigured` couldn't carry `data`. Added `opts.data` + a dry-run test (exit 2). |
| F002 | T007 | HIGH | ✅ fixed in `dac64fa`, re-verified | `formatOk({status:'degraded'})` left `next_action` optional, violating the contract. Split out `formatDegraded` (requires `next_action`); removed degraded from `formatOk`. |

> Note: the in-flight log first called these F001a/F001b; the companion's canonical inbox IDs are **F001** (dry-run) and **F002** (degraded). Both map to the same fix commit `dac64fa`.

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

### T007 — Implement output kernel (GREEN) [Stage 3 complete]
**Status**: ✅ complete

- `src/output/envelope.ts`: `Status`, `Evidence`, `Envelope`, `formatOk`/`formatUnconfigured`/`formatError` (clock injected; conditional spread so unset fields are absent, not undefined).
- `src/output/error-codes.ts`: `ErrorCodes` table (E100/E108/E110/E120/E130) + `ErrorCode` type. Added `test/output/error-codes.test.ts` (table values + uniqueness/format) to document + cover the contract.
- `src/output/exit.ts`: `exitCodeFor` (ok=0, degraded=0, unconfigured=2, error=1) + `exitWithEnvelope` (single `process.exit`).
- `src/output/output-port.ts`: created with the `OutputPort { emit(env) }` interface here (exit.ts depends on it). **Minor split vs dossier** (which scoped output-port.ts to T008): the interface had to exist for exit.ts to compile; `selectMode` + renderers are added in T008.
- **Evidence**: `just fft` green — 18/18 tests pass; coverage 87.5% (remaining gap = `exitWithEnvelope`, covered in T008). T006 red → green.
- **AC**: AC-4 (envelope + exit policy).

### FIX (companion F001) — degraded + dry-run contract gaps
**Status**: ✅ fixed (both HIGH)

- **F001b**: added `formatDegraded(command, data, next_action, clock, {evidence?})` with `next_action` **required**; removed the `status:'degraded'` path from `formatOk` (now `ok`-only). Makes "next_action required when status≠ok" unbreakable by construction.
- **F001a**: `formatUnconfigured` now takes `opts.data` so it can represent the `run --dry-run` worked example (`data:{dry_run,slot,mapped_command}`); added a dry-run test asserting the full envelope + `exitCodeFor === 2`.
- Updated `test/output/envelope.test.ts` (degraded → `formatDegraded`, new dry-run test, field-presence uses `formatDegraded`).
- **Evidence**: `just fft` green — 19/19 tests; coverage 88%. Re-pinged companion to verify.

### T008 — OutputPort: selectMode + renderers [Stage 4 complete]
**Status**: ✅ complete

- `src/output/output-port.ts`: `OutputMode`, `Writers` (injected for testability), `processWriters` (real streams), `selectMode(flags, env, isTty)` with precedence flag → `HARNESS_JSON` env → TTY, `renderJson` (one parseable line → stdout), `renderHuman` (next_action → stderr, `"<cmd>: <status>"` summary → stdout), `createOutputPort(mode, writers)`.
- `test/output/output-port.test.ts` (11 tests): all 5 selectMode precedence cases; renderJson stdout-only; renderHuman stdout/stderr split; createOutputPort dispatch; **exitWithEnvelope** (spied process.exit → emits + exit 2).
- **Evidence**: `just fft` green — 30/30 tests; coverage **94.28%** (exitWithEnvelope now covered).
- **AC**: AC-4 (human/JSON renderers + mode selection). **Stage 4 complete.**

### T009 — Minimal entrypoint + smokes [Stage 5 — PHASE LANDED]
**Status**: ✅ complete

- `src/index.ts`: commander root, `-v, --version` (reads version from the repo-root `package.json` via `new URL('../../../package.json', import.meta.url)` — holds in dev + installed), root `.action()` prints an **orientation envelope** through the kernel (`formatOk` + `selectMode` + `createOutputPort`).
- **In-build fix**: first cut guarded orientation on `argv.slice(2).length===0`, so `harness --json` (a global flag, no subcommand) emitted nothing. Reworked to a commander root action + `jsonFlag(argv)` tri-state read → orientation fires for `harness`, `harness --json`, `harness --no-json`; commander still owns `--version`/`--help`.
- **Evidence**:
  - `npm run build` clean; `node dist/index.js --version` → `0.1.0`.
  - no-args (piped) → JSON envelope, exit 0; `--json` → JSON envelope; `--no-json` → `harness: ok` on **stdout**, `→ <next_action>` on **stderr** (contract split verified).
  - `npm pack --dry-run` lists `harness/cli/dist/index.js` (2.4kB) + LICENSE; `bin.harness` resolves.
  - `just fft` green — 30 tests, coverage 94%.
- **AC**: AC-1..AC-5 all satisfied. **Phase 1 LANDED.**

## Phase 1 Result

- **Acceptance**: AC-1 ✅ (root manifest/bin/prepare/files/engines), AC-2 ✅ (source under harness/cli, tsc src→dist), AC-3 ✅ (biome + vitest+coverage + justfile fft), AC-4 ✅ (output kernel envelope/renderers/exit policy, unit-tested), AC-5 ✅ (`just fft` green).
- **Tests**: 30 passing across 5 files; coverage 94.28% (index.ts excluded).
- **Companion**: 1 finding bundle (F001, 2×HIGH) raised + fixed inline + re-verified. All other commits approved.
- **Deviations logged**: scaffold stub in T001; vitest→^4 for security; output-port.ts interface created in T007; commander tri-state flag fix in T009.

## Companion Debrief (Power-On-Mode)

- **Run**: `code-review-companion` `2026-06-08T08-17-59-139Z-9157` (read-only). 10 review-requests, 2 HIGH findings, 0 questions.
- **Verdict**: APPROVE — final range sweep `09c2e4c..d9f6435` clean, no open findings. Confirmed: output contract matches workshop 001 (unconfigured exit 2, dry-run `data`, required `next_action` for degraded/error/unconfigured), `commander` is a runtime dependency, relative imports use `.js`, `process.exit` limited to `exit.ts`, scope within T001–T009.
- **Findings**: F001 + F002 (both HIGH, both resolved by `dac64fa`, re-verified).
- **Companion magicWand** (→ target **minih**, not this repo): "Expose one canonical merged report template in `minih check --template <slug>` so agents write exactly the schema that will be validated." Logged here as a minih follow-up candidate; not actioned in this plan.
- **Note**: `/plan-7-v2-code-review` is intentionally NOT run — the companion performed live review of every commit and the final range. Farewell envelope: `agents/code-review-companion/runs/<run>/output/report.json` (runtime artifact, gitignored).

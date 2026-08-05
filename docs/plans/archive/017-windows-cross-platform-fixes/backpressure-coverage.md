# Backpressure Coverage — windows-cross-platform-fixes

**Spec**: [windows-cross-platform-fixes-spec.md](./windows-cross-platform-fixes-spec.md)
**Generated**: 2026-06-10 (regenerated same day after the user ruled out any Windows CI executor)
**Certainty**: Partial

> Advisory only — informs `plan-3`. Never blocks, never gates, no scores. (See eng-harness-2-backpressure.)

**Constraint set by user decision 2026-06-10**: *no Windows server in CI — remove anything that needs it.* The original survey's keystone Phase-0 sensor (a `windows-latest` leg) is therefore off the table. The replacement proof strategy is **deterministic by construction**: the path logic being fixed is pure string-space code, so unit tests can feed it **Windows-shaped inputs** (backslash cwd `C:\repo`, mixed separators, `c:/` vs `C:/`, UNC, `../` escapes) on the existing ubuntu legs — any reintroduction of native `join` on a logical path leaks a backslash into an envelope assertion and fails deterministically. What this cannot prove (real fs + jiti + shell spawns *on actual Windows*) is explicitly routed to a one-off manual re-port verification, human-tier and accepted.

## Existing Sensors (inventory)

Filesystem-grounded (signature probes across root + `harness/cli` + `.harness/extensions`; no workspace manifest — single-package repo with root scripts):

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| vitest suite (380 tests; 47 files + 1 extension-colocated via two-level glob) | `npm test` → `cd harness/cli && vitest run --coverage` | behaviour | `harness/cli/vitest.config.ts` |
| tsc build + typecheck | `npm run build` / `npx tsc --noEmit -p harness/cli/tsconfig.json` | maintainability | root scripts; CI build-test |
| Biome lint | `npm run lint` | maintainability | `biome.json`; CI build-test |
| Docs drift guard | `npm run check:docs` (`git diff --exit-code` on generated bundle) | behaviour | root scripts; CI build-test |
| arch-check (dependency-cruiser, 7 rules @ warn) | `npx --no-install harness arch-check --json` | architecture-fitness | `.dependency-cruiser.cjs` + `.harness/extensions/arch-check/`; final CI build-test step |
| no-direct-node-io architecture test | inside vitest suite | architecture-fitness | `harness/cli/test/architecture/` |
| package-smoke (pack → consumer install → jiti runtime smoke) | CI job | behaviour (packaging) | `ci.yml:101+` — **currently RED** (TARBALL capture poisoned + unsatisfiable E143 grep; repair is AC-9) |
| doctor | `npx --no-install harness doctor --json` | behaviour (boot/health) | `.harness/engineering-harness.md` (corroborated: CLI verb exists) |
| ci-required aggregator | branch-protection gate over `[build-test, package-smoke]` | — | `ci.yml:81` |

**Executor coverage**: every sensor runs on **ubuntu-latest only** (`grep -ri windows .github/workflows/` → 0 hits) — and by user decision this stays so. The fakes-based test architecture is what makes that workable: `FakeFs`/`FakeProcess` take arbitrary strings, so Windows-shaped path behaviour is exercisable on Linux.

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail (required if ABSENT) |
|--------------------------|----------------------|--------|------|----------------------------------|
| AC-1 POSIX envelope shapes on any OS | unit assertions on literal `/` shapes **+ Windows-shaped cwd fixtures** (`FakeProcess.cwd() = 'C:\\repo'`) on ubuntu — backslash leak = deterministic fail | BUILDABLE | computational | — |
| AC-2 one construction pattern (5 services, no native join on surfaced paths) | same Windows-shaped cwd fixtures (native `join` against a backslash cwd leaks `\` into envelopes → caught on ubuntu); pattern conformance itself also reviewed | BUILDABLE | computational + inferential for the pattern | — |
| AC-3 `isWithin`/dedupe POSIX-space edge cases (drive-letter case, UNC, `../`) | new pure unit tests with Windows-shaped string inputs — run on ubuntu | BUILDABLE | computational | — |
| AC-4 FakeFs separator tolerance (`mkdirp` :51-53, `readdir` :41) | new pure unit tests (string inputs) — run on ubuntu | BUILDABLE | computational | — |
| AC-5 path-safe test assertions (`extensions.test.ts:91,:235`) | none deterministic on ubuntu — real-fs integration paths are POSIX there, so old and new forms both pass | ABSENT | inferential (code review) + human (manual re-port) | no Windows executor by user decision 2026-06-10; on ubuntu, `split('/')` on real absolute paths cannot fail — only a Windows fs run distinguishes the forms |
| AC-6 shell-free EPIPE test + Windows-safe npm guard | the rewritten test proves the EPIPE contract on ubuntu; the guard's *Windows* safety (npm.cmd) is not CI-provable | BUILDABLE (EPIPE) / manual residual (Windows spawn) | computational + human residual | — |
| AC-7 gen-docs stderr + cross-platform biome invocation | package-smoke mechanical check (captured value matches `*.tgz`) proves the stdout contract; the biome invocation's *Windows* behaviour is manual-residual | BUILDABLE | computational + human residual | — |
| AC-8 Windows-shape proof on ubuntu | **the Windows-shaped-input test set itself** — the sensor this plan builds in place of the CI leg | BUILDABLE | computational | — |
| AC-9 package-smoke green (pack capture + flat fixture) | CI job — sensor infrastructure EXISTS, currently red; repairs (npm pack `--json`, restore `legacy.ts` fixture) are in scope | EXISTS (broken → repair) | computational | — |
| AC-10 no Linux regression; arch-check stays `ok` | build-test matrix (Node 22/24) + arch-check CI step | EXISTS | computational | — |
| FM: jiti loads `.ts` from forward-slash drive-letter paths on real Windows | none — needs a Windows executor | ABSENT | human (manual re-port) | no Windows executor by user decision; reviewed `jiti-loader.ts:28-30` — only a real Windows run exercises jiti's resolver; fallback `pathToFileURL().href` documented in spec risks |
| FM: autocrlf CRLF poisoning of Windows checkouts at re-port | `.gitattributes` (`eol=lf`) — preventive config, no CI dependency | BUILDABLE | computational (preventive) | — |
| FM: architecture drift from adding `services/shared` path helper | arch-check (7 dependency-cruiser rules) | EXISTS | computational | — |
| FM (Non-Goal): `NodeExec` extensionless-bin spawns on Windows (`acts/skills.ts:136` npx, arch-check `extension.ts:57` depcruise) | none — runtime-only; FakeExec masks it in tests | ABSENT (explicitly out of scope per spec Non-Goals) | computational-possible, deferred | reviewed all real-spawn sites (`NodeExec` consumers); no executor exercises real spawns on Windows; follow-up with the NodeExec bin-resolution fix |

## Certainty: Partial

The core path-construction behaviour — the thing that caused ~33 of the 40 failures — is deterministically provable **on ubuntu** via pure-function tests and Windows-shaped cwd fixtures (BUILDABLE in scope); a bounded residual set (real-fs assertion forms, jiti on real Windows, shell spawns) is ABSENT by explicit user decision and routed to a one-off manual re-port check → Partial.

## Recommended Phase 0: Establish Backpressure

| Sensor to build | Proves | Suggested form |
|-----------------|--------|----------------|
| Pure POSIX-helper unit tests fed Windows-shaped string inputs (`C:/` vs `c:/`, UNC, mixed separators, `../` escapes) | AC-3, AC-4 | vitest unit tests (ubuntu) |
| **Windows-shaped cwd fixture set** — seed `FakeProcess.cwd()` with `C:\repo`-style backslash paths across discovery/record/scaffold/doctor/instructions service tests; assert clean-POSIX envelopes | AC-1, AC-2, AC-8 — the convention regression-sensor that replaces the CI leg | vitest unit tests (ubuntu) |
| package-smoke repair: `npm pack --json` capture + restore flat `legacy.ts` fixture + mechanical `*.tgz` assert | AC-7(a), AC-9 | CI script fix |
| `.gitattributes` with `eol=lf` for source | autocrlf failure mode on Windows checkouts (sensor-enabler for the manual re-port) | repo config |

**Removed from the original survey by user decision**: the minimal `windows-latest` CI job (and with it the `ci-required` update and `check:docs`-exclusion design). The manual re-port (dossier's `verify-port.ps1` flow) is now the only place the ABSENT rows get exercised — worth doing once after the fixes land, and recording the result in the execution log.

## How this differs from plan-3 G6 and plan-7

`plan-3` G6 checks that test *tasks exist*; `plan-7`/companion is the inferential eyeball tier (unchanged — AC-2's pattern conformance and AC-5's assertion forms now lean on it more, since the Windows executor is gone). This survey is the computational tier pulled forward: it says which sensor proves each criterion, which sensors must be built (the Windows-shaped-input test sets), and which rows are honestly manual by decision.

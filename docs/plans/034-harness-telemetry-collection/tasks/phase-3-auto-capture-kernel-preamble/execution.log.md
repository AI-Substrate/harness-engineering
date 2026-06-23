# Execution Log — Phase 3: Auto-capture kernel preamble

**Plan**: [harness-telemetry-collection-plan.md](../../harness-telemetry-collection-plan.md)
**Started**: 2026-06-23 · **Mode**: Full · **Companion**: code-review-companion (run `2026-06-23T09-34-42-872Z-8632`)
**Awareness**: built against the Done Contract (AC-01 invoked-once + help/version excluded + byte-identical output; AC-09 throwing-capture fail-safe) + the validated mechanics M-K1…M-K6 (env-pin, fail-safe wrapper, honest perf sensor). cli-kernel domain; `capture-service`/schema/adapters FROZEN (AC-12). No `docs/domains/` structure in this repo → no domain.md updates.

---

## T001 — testability seam + pure helpers
**Status**: ✅ done · **AC**: AC-01 (scaffold)

- Added two exported pure argv helpers to `src/app.ts` (alongside `jsonFlag`/`isExtensionsDisabled`): `deriveCommand(argv)` (M-K4 — first non-flag token ≥ idx 2, else `harness`; top-level only; boolean-global-safe) and `shouldCaptureForArgv(argv)` (M-K3 — excludes `-h`/`--help`/`-v`/`--version` + the `help` subcommand; argv-shape not semantic; `-h`/`-v`-anywhere caveat documented).
- Added `capture: (deps: CaptureDeps) => void` to `MainOverrides` (M-K1 seam) + a `type` import of `CaptureDeps`. Accessed via `Partial<MainOverrides>` like every other override (default binds `captureTelemetry` in T004). No wiring yet — `main()` unchanged.
- **Evidence**: 9/9 `app.test.ts` tests green (incl. 7 new helper cases covering bare/top-level/boolean-global skip + every exclusion + unknown-captures); `tsc --noEmit` clean; biome clean.

## T002 + T003 + T004 — composition-root wiring + fail-safety + the preamble
**Status**: ✅ done · **AC**: AC-01, AC-09

- **T002+T003 (tests, RED→GREEN)**: added `describe('main — telemetry capture preamble')` with a `runMain(argv, capture, extra)` harness (spies `process.exit`→`exit:N`, captures out/err/code). Cases: real command → 1 call, label `doctor`; **env-pin** (`calls[0].env === deps.env` EnvPort, `calls[0].adapters === coreTelemetryAdapters`); bare `harness` → label `harness`; unknown `bogus` → 1 call (by design); `--json doctor` → `doctor`; **5 display-only argv → 0 calls** (`it.each`); **pre-parse boundary exit → 0 calls** (throwing `proc.cwd` proves M-K2 placement). T003: a throwing capture (Error **and** non-Error) leaves stdout+stderr+exit identical to a no-op capture.
- **T004 (impl)**: thin preamble in `main()` after `validateVerbRegistry`, before the `parseAsync` try (`app.ts`). `if (shouldCaptureForArgv(argv))` → build `CaptureDeps` (**`env: deps.env`**, the EnvPort; `adapters: coreTelemetryAdapters`; `command: deriveCommand(argv)`) → `(overrides.capture ?? captureTelemetry)(deps)`, wrapped in a swallowing `try/catch` (M-K5). One delegation, no logic. Imports `captureTelemetry` + `coreTelemetryAdapters`.
- **Evidence**: 22/22 `app.test.ts` green; **full suite 1089/1089**; `tsc` clean; biome clean; dep-cruiser clean (104 modules — kernel→telemetry edge allowed); `capture-service`/schema/adapters untouched (AC-12).

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-23 | T003 | gotcha | The envelope `timestamp` is a live `SystemClock` value (doctor/orientation use `new SystemClock()`, not `deps.clock`), so two runs differ by ms independent of telemetry — a raw byte-compare fails spuriously. | `maskTs()` masks `"timestamp":"…"` before the AC-09 comparison, isolating telemetry's effect (the real claim) from inherent timestamp non-determinism. | T003 |

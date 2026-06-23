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

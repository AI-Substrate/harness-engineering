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

## T005 — zero output/exit drift + structural perf sensor
**Status**: ✅ done · **AC**: AC-01, AC-06 (guard), M-K6

- **Zero-drift (`app.test.ts`)**: `it.each(['doctor','flow','record'])` runs `main()` with the **real** `captureTelemetry` (a session-bearing `FakeEnv`) vs the same with `HARNESS_NO_TELEMETRY=1`; asserts `maskTs(on) === maskTs(off)` — telemetry on/off leaves stdout+stderr+exit identical.
- **Structural perf (`test/services/telemetry/capture-perf.test.ts`)**: (1) `vi.spyOn(fs,'readText')` → the transcript path is read **exactly 2×** per capture (M-K6.1 bounded read-count, the accepted M1 debt); (2) cursor-incremental — run 1 (cursor null → window `[0..8)`) yields tokens + advances the cursor to `8`, run 2 (cursor at `8`) yields **null** tokens (M-K6.2, no history re-count); (3) AC-06 PR-invisibility — every write lands under the self-ignoring `.harness/temp/` tree.
- **Evidence**: full suite **1095/1095**; `tsc` clean; biome clean; dep-cruiser clean (104 modules).

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-23 | T005 | gotcha | `FakeFs.readdir` doesn't list files written via `writeText`/`rename`, so `nextSeq` stays `1` and a 2nd capture overwrites `1.json` (real fs would increment). | Read the latest segment via the **rename history** (`latestSegment`) + assert the cursor watermark directly (`readCursor`) — quirk-independent. Not a product bug (fake limitation). | T005 |
| 2026-06-23 | T005 | decision | AC-06 root: `ensureTemp` writes `.harness/temp/.gitignore` (the parent temp dir), not under `telemetry/`. | Asserted writes land under `.harness/temp/` (the self-ignoring tree), not the narrower `telemetry/` — both buffer + `.gitignore` are PR-invisible there. | T005 |

## Phase 3 — COMPLETE
- **All tasks T001–T005 done**, every commit companion-reviewed. The capture-service is now **ambient**: a thin `main()` preamble fires `captureTelemetry` once per real command, help/version excluded, fail-safe, zero output/exit drift. Tests: **1095/1095 green** (+~25 Phase-3 tests across app + capture-perf). Gates: `no-direct-node-io`/`no-direct-exit` + dep-cruiser (104 modules) + `tsc` + biome all clean. `capture-service.ts` + segment schema + adapters **untouched** (AC-12 honoured).

### Deferred & Noteworthy (this phase)
| Tag | Item | Why it's fine for now |
|-----|------|----------------------|
| Noteworthy | Perf guarantee is **bounded read-count + windowed parse**, NOT bounded bytes — each capture reads+splits the full transcript twice (FsPort has no range read, M1). | Honest reshape of plan 3.4 (validation M-K6); plan §3.4 + coverage line corrected. The structural sensor still rejects an O(history) re-scan. |
| Noteworthy | AC-09 / zero-drift assert **stderr** too (beyond the plan's literal stdout+exit). | The banner decorator writes to stderr — the likeliest drift channel; deliberate strengthening (recorded in Discoveries). |
| Noteworthy | Unknown commands (`harness bogus` → E108) **do** capture (label = raw token); display-only excluded. | The trigger is the invocation, not successful dispatch — intended (M-K3), pinned by a test. |
| Noteworthy | AC-06 porcelain proof at the unit layer = "all writes under `.harness/temp/`" (FakeFs). | The real `git status --porcelain` proof lives at Phase-1 task 1.7; Phase 3 adds the structural equivalent so ambient (100%-frequency) capture can't regress PR-invisibility. |


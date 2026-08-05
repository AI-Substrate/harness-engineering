# Execution Log — Phase 1: Segment substrate & capture core

**Plan**: [harness-telemetry-collection-plan.md](../../harness-telemetry-collection-plan.md)
**Started**: 2026-06-23 · **Mode**: Full · **Companion**: code-review-companion (run `…905Z-5a24`)

---

## T001 + T002 — Segment counts-only contract + privacy-safe serializer
**Commit**: `5f02cbf` · **Status**: ✅ done · **AC**: AC-04, AC-12

- **RED**: wrote `test/services/telemetry/segment.test.ts` first (serializer absent → import fails).
- **GREEN**: `src/services/telemetry/segment.ts` — `Segment` type, `SegmentInput`, `serializeSegment(input, repoRoot)`, `SEGMENT_FIELD_KEYS` (18-field allowlist), `SEGMENT_SCHEMA_VERSION = "1.0"`; `segment.schema.json` (draft-07, `additionalProperties:false`, all 18 required).
- **Privacy mechanism (AC-04)**: serializer is an **allowlist by construction** — picks each field explicitly, never spreads `input`, so a planted secret/content in a non-allowlisted field is structurally unable to reach the output. `relativizePath` makes in-repo paths repo-relative and reduces out-of-repo absolute paths to basename (drops `/Users/…`).
- **Negative control**: planted `SUPER_SECRET_…` + `/Users/jordan/secrets/keys.env` → serialized JSON contains neither (control fails if the allowlist regresses to a spread).
- **Contract freeze (C4/F3)**: `segment-schema.test.ts` asserts schema property set **equals** `SEGMENT_FIELD_KEYS` (not subset), every field required, `additionalProperties:false`, `schema_version` const `1.0`; a frozen-snapshot version-freeze test makes silent field-set drift impossible.
- **Evidence**: 12/12 telemetry tests green; `tsc --noEmit` clean; biome clean.

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-23 | T001/T002 | Insight | Repo has no ajv; schema validation is hand-rolled (`flow-schema.ts`) | Used key-set **equality** + golden-every-field + version-freeze instead of a JSON-schema validator dependency | no new deps |
| 2026-06-23 | T002 | Noteworthy | `segment.schema.json` lives in `src/` as a data file (not TS-bundled like `schemas-content.ts`) | Read via fs in tests; cross-tool consumers read the file. Packaging/bundling is a Phase 4 concern | F3 |

## T003 — `segment` core record type + registry
**Commit**: `0f7a9c0` · **Status**: ✅ done · **AC**: AC-12

- `src/services/record/core-types/segment.ts` (mirrors `harness-change.ts`/`retro.ts`) + registered in `coreRecordTypes`.
- Test proves: 4-field record contract; template ships only the template-owned `schema_version`; `spliceProvenance` stamps all 7 keys exactly once (schema_version untouched); registry enumerates `segment` as core.
- **Evidence**: 15/15 (segment-record + registry) green; tsc clean; biome clean.

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-23 | T003 | Noteworthy | Installed `harness` binary (v0.5.0) is the published package — `harness record --list` does NOT show `segment` from working-tree source | Deterministic proof is the unit test (`buildRecordRegistry` includes segment); live CLI reflects it only after a package rebuild/release (out of Phase 1 scope) | — |

## T004 — HarnessAdapter capability seam + null-default
**Commit**: `2d0da32` · **Status**: ✅ done · **AC**: AC-12 (F1)

- `src/services/telemetry/adapters/harness-adapter.ts`: `HarnessAdapter` (handles/currentPosition?/extract), `HarnessSource`/`HarnessContext`, `HarnessCapabilities` (all nullable), `nullDefaultAdapter` (catch-all, all-null).
- Pulled into Phase 1 (F1) so Phase 2 implements Claude/Copilot adapters against the interface without editing capture-core. AC-12 proven: a future harness with only the null-default → schema-valid all-null segment.
- **Evidence**: 3/3 green; dep-cruise clean; tsc clean.

## T005 + T006 — capture-service + session cursor
**Commits**: `06a792f` · **Status**: ✅ done · **AC**: AC-01, AC-06, AC-12

- `capture-service.ts`: `detectHarness` (Copilot innermost), `computeWindow`, `captureTelemetry(deps: CaptureDeps)` (named entry the Phase-3 kernel calls). `cursor.ts`: read/write watermark, path sanitization.
- Buffer layout pinned (F2/F4): `.harness/temp/telemetry/<session>/<seq>.json` + `<session>.cursor`. Atomic temp+rename (mirror **flow-service**). Self-ignoring via shared `ensureTemp`.
- Designed edge no-ops (C3): zero-harness → no-op; missing source → empty window (segment still written); corrupt cursor → reset to session-start.
- **Evidence**: 17/17 green; arch tests pass (ports-only); dep-cruise clean (7 modules); tsc clean.

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-23 | T005 | Insight | Added `currentPosition?()` + `HarnessSource` to the adapter seam (the cursor needs the source extent before `extract`) | Extended the T004 interface (still Phase 1); null-default omits it → empty windows, which is correct for the adapterless Phase-1 path | F1 |
| 2026-06-23 | T006 | Noteworthy | FakeFs.readdir does not enumerate files written via writeText/rename (only mkdirp'd dirs) | `<seq>.json` via readdir is correct under NodeFs; tests read deterministic `1.json` paths and don't unit-test multi-capture-same-session | — |

## T007 + T008 + T009 — crash-safe cursor, buffer self-ignore, kill-switch + fail-safe
**Commits**: `6d1e8d5` (T007/T008), `d006459` (T009) · **Status**: ✅ done · **AC**: AC-01, AC-05, AC-06, AC-09

- T007: cursor crash-safety vs the synchronous FsPort (temp+rename; crash-before-rename leaves prior watermark intact; last-writer-wins). C2 redefinition.
- T008: real-git integration test — `git check-ignore` confirms the buffer self-ignores via nested `.harness/temp/.gitignore=*`, independent of repo-root .gitignore (+ not-over-broad control).
- T009: `HARNESS_NO_TELEMETRY=1` → zero side effects (asserted via FakeFs writes/mkdirs/renames empty); fail-safe try/catch so a throwing adapter never changes host exit.

## F001 fix — ../ traversal containment (companion finding, MEDIUM, AC-04)
**Commit**: `56a1033` · **Status**: ✅ resolved + companion-verified (APPROVE, 0 open)

- Companion F001: `relativizePath` passed an already-relative `../outside/x` through unchanged. Fix: resolve relative inputs against `repoRoot` before the `isWithin` check; out-of-repo (absolute or ..-climbing) → basename only. Regression test added.

## Phase 1 — COMPLETE
- **All tasks T001–T009 done.** Tests: **1038/1038 green** (8 telemetry test files, 41 telemetry tests). Gates: `no-direct-node-io` + `no-direct-exit` + dep-cruiser clean; `tsc --noEmit` clean; biome clean.
- **Companion review (code-review-companion, every commit)**: T003/T004/T005-6 APPROVE (0); T001/2 + T007-9 APPROVE_WITH_NOTES → 1 MEDIUM (F001), now fixed + verified. Final state: **0 open findings**. A separate post-hoc review pass is redundant (the flow's Graph knows).

### Deferred & Noteworthy (this phase)
| Tag | Item | Why it's fine for now |
|-----|------|----------------------|
| Noteworthy | Installed `harness` v0.5.0 doesn't show `segment` in `record --list` | Source + unit test correct; needs a package rebuild/release (not Phase 1) |
| Noteworthy | `segment.schema.json` is a data file in `src/` (not TS-bundled) | Packaging/bundling for cross-tool consumers is a Phase 4 concern |
| Deferred | Real adapters (Claude/Copilot), kernel preamble, GitWritePort/orphan-ref sync | By design — Phases 2/3/4. Phase 1 ships the substrate + seam only |
| Gate | **§T1 author governance** still unratified | Gates Phase 4 only; not Phases 1–3 |

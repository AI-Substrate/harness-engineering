# Execution Log — Phase 1: Session Export Foundation

**Plan**: ../../session-telemetry-dashboard-plan.md · **Started**: 2026-07-01

## Pre-flight discoveries (real-data recon, before T001)

- **On-disk spool layout**: `<repo>/.harness/temp/telemetry/<harness_session_id>/<seq>.json` = one serialized `Segment` per capture. Companions `<seq>.logs.jsonl` + `<seq>.metrics.jsonl` (pre-serialized OTLP) exist **in pairs** for flushed seqs (1881 each in the live buffer).
- **Real schema-version spread** (live buffer): v1.0=63, v1.1=102 (**no `event_stream`** — flat `skills`/`tools`/`bash_commands`/`tokens`/`models` view), v2.0=19063, v2.1=28, v2.2=289 (`event_stream`+`rollup`). → **T007 is a live concern, ~0.85% of real segments**, not hypothetical.
- **Crash seam confirmed**: `segmentToOtlpLogs` (`logs.ts:302`) AND `rollupToOtlpMetrics` (`metrics.ts:57` via `bounds(seg.event_stream)`) both iterate `event_stream` unguarded → a v1 segment throws in both. T007 normalizes-or-degrades before either.
- **Reuse found**: `session-evidence.ts` already has the read primitives — `telemetryDir(root)` (cursor.ts), the `<telDir>/<session>/<seq>.json` layout, corrupt-safe `JSON.parse` reads. Combine reuses this layout (reads ONE session subdir).
- **Design locked**: unify everything through the **event stream** (the substrate). Per seq: prefer `<seq>.logs.jsonl` companion (`otlpLogsToEvents`) → else segment `event_stream` (v1-normalized). Then build ONE merged `resourceLogs` (all logRecords, sorted by `harness.event.t`) + ONE forward-regenerated `resourceMetrics` (from `computeRollup(allEvents)`) — never invert metrics, never sum cumulative per-seq metrics.

## Tasks

### T001 — SessionExport type + schema ✅
- `session-export.ts`: `SessionExport` type (`identity`/`source`/`summary`/`signals{logs,metrics}`) + `SESSION_EXPORT_SCHEMA_VERSION = harness.session-export/v1`.
- `session-export.schema.json`: additive (`additionalProperties:true` + pinned `const` schema_version); `summary.tokens.subagent_tokens`/`grand_total` typed `oneOf integer|"unknown"` (AC-10). Typecheck clean.

### T002 — combine spec (test-first) ✅
- `session-export.test.ts` written before impl. Two out-of-order segments prove the merge re-sorts to ONE `resourceLogs` ordered by event time; real-corpus golden (`claude/2026-06-25-static-site`) proves it reads the actual on-disk shape.

### T003 — combineSession() impl ✅
- Design: **unify through the event stream**. Per seq → events from (priority) `.logs.jsonl` companion (`otlpLogsToEvents`) → segment `event_stream` → v1-normalize. Merge+sort all events → one synthetic session-segment → `segmentToOtlpLogs` (one merged logs) + `rollupToOtlpMetrics(computeRollup(all events))` (one derived metrics). **Never inverts metrics; never sums per-command cumulative metrics** (KF-02/KF-03). Ports imported type-only (P2) — arch-check confirms zero new violations.

### T004 — round-trip non-vacuity ✅
- `otlpLogsToEvents(merged logs)` `toEqual` the exact merged stream; `computeRollup(reconstruction).tokens.in === 150`. **Non-vacuity**: a mutated stream (`in:999`) is asserted `not.toEqual` + rollup `not.toBe(150)` — the equality discriminates.

### T005 — session save subcommand ✅
- `acts/telemetry.ts`: `telemetry session save <id> --source temp [--out] [--no-html]` (mirrors the `get` pattern). Writes `<id>.session.json`, emits Envelope + `evidence[]`. `--source git-ref` → honest "Phase 3" error; empty session → honest not-found (buffer never mutated). `--no-html` accepted (renderer is Phase 2).

### T006 — identity + degraded honesty ✅
- Identity lifts `harness`/`harness_version`/`branch`/`models[]` (first-seen) + `pij_session_id` from `captured_env.PIJ_SESSION_ID`. Subagent tokens → `"unknown"` (never 0) when any segment lacks them; `degraded[]` records it. Proven live: rich session lifted `models:[claude-opus-4-8]`, `pij_session_id:pij-1s7r0mw`, 24.4M tokens.

### T007 — v1 normalize-or-degrade ✅
- `normalizeV1ToEvents()`: a v1 (no-`event_stream`) segment → minimal stream (turn/skill/tools/harness events) stamped at the segment `timecode` (no fabricated timeline; counts preserved). `segment_schema_versions` records the v1 version; `degraded` gains `v1_segments`. Test proves the raw v1 segment WOULD throw `segmentToOtlpLogs` (the guard is load-bearing) and that combine tolerates it.

### T008 — LIVE SMOKE (real exports, eyeballed) ✅ — the phase's hard done-when
Ran the **real** `harness telemetry session save` against 3 diverse live sessions from `.harness/temp/telemetry/`:
- **v1-only** (`f552baaa`, 6× v1.1): status ok, `schema_versions {1.1:6}`, `degraded [subagent_tokens, v1_segments]` — the T007 path proven on real data, no crash.
- **companion-pair** (`67bce14c`, 16× v2.2): status ok, `degraded []`, combined via `.logs.jsonl` companions.
- **token-rich** identity: `harness=claude-code`, `harness_version 0.6.0`, `pij_session_id pij-1s7r0mw`, `models [claude-opus-4-8]`, tokens `total 24,408,986` — plausible, correct.
- **Inspection**: both artifacts **structure-valid** against every `required` key in the schema (top + identity/source/summary/tokens/signals); ONE `resourceLogs` + ONE `resourceMetrics` each; v1 flat counts survived into logs (skill×2, harness×4).
- **Privacy**: grep for `/Users/`, `/home/`, `jordanknight`, `jakkaj` in the artifact bodies → **clean**. (Artifacts written to the session scratchpad, never the repo.)

## Phase-complete summary ✅

All 8 tasks `[x]`. **Full telemetry suite: 423/423 pass (40 files).** `harness checks`: all hard gates green (tests, biome, typecheck, check:docs/flows/telemetry-fixtures/doctrine-parity, skills, windows). Two **pre-existing** warn-launch degradeds (arch-check on `sync-service.ts`, markdown-lint on authored docs) — **not** from Phase 1; `session-export.ts` imports all ports type-only.

**ACs met**: AC-01 (schema-valid export from temp) · AC-02 (3 shapes + v1/v2 without crashing; `segment_schema_versions`) · AC-10 (subagent "unknown" not 0; empty `plans_touched` tolerated). AC-03/04 (rollups) and AC-06/07 (HTML) are Phase 2; AC-08/09/11/12 are Phase 3.

**Deferred & Noteworthy**:
- *Noteworthy*: v1 normalization stamps synthesized events at the segment `timecode` (no per-event timeline exists in v1) — deliberate; wall-time for a v1-only session is ~0, counts preserved. `degraded:[v1_segments]` surfaces it.
- *Noteworthy*: `--no-html` flag accepted but inert in P1 (the render lands in Phase 2 task 2.6); surface kept stable now to avoid a later flag break.
- *Deferred*: none blocking. No TODO/FIXME/HACK left in the diff.

**Suggested commit**: `feat(telemetry-047): SessionExport combine + session save verb (Phase 1)`

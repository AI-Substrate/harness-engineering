# Phase 1: Implementation — Tasks (flow-056 file-write telemetry)

**Plan**: `docs/plans/056-file-write-telemetry/file-write-telemetry-plan.md` (Simple, CS-3, v1.1.0 — validated)
**Objective**: Ship a `file` telemetry event capturing per-file path + change-delta from tool payloads, end-to-end from adapter emission through OTLP to the report.
**Testing**: Hybrid — TDD for `file-delta`, serializer/schema, OTLP mapping; fixture tests for adapters; regen goldens last.

## Locked design decisions (D1–D5 — MUST honor)
- **D1** — full repo-relative paths travel.
- **D2** — out-of-repo writes → the literal `<external>` sentinel (a **net-new** confinement branch; do NOT reuse `relativizePath`, which leaks basename — `segment.ts:252-261`).
- **D3** — NO capture-time classification (no `file_kind`); test/source/config rubric is downstream.
- **D4** — deltas, not total file size (edits report lines/bytes changed).
- **D5** — deltas computed from the tool payload already parsed (Claude `Edit` old/new, `Write` content; Copilot `apply_patch` +/-; Copilot create/edit read `arguments` body **for counts only**). No stat, no file-content read.

## Tasks

| Status | ID | Task | Path(s) | Done When |
|--------|-----|------|---------|-----------|
| [x] | T001 | Define `FileEvent` (`kind:'file'`, `t`=capture-time, `path`, `change:'written'|'edited'`, `delta:{lines_added,lines_removed,bytes_added,bytes_removed}`); add `'file'` to `EventKind` + `EVENT_KINDS`; add to `Event` union; doc-comment states `t`=capture-time (excluded from rollup math like `artifact`) | `harness/cli/src/services/telemetry/events.ts` | Type compiles; `EVENT_KINDS` includes `'file'`; unit asserts closed set |
| [x] | T002 | **TDD**: pure `computeFileDelta(oldText,newText)` + `writtenDelta(content)` — line/byte add+remove counts (Write: all added; Edit: line-level add/remove) | `harness/cli/src/services/telemetry/file-delta.ts` (new) + test | new-file=full added/0 removed; edit adds+removes; empty→empty |
| [x] | T003 | **TDD**: serializer `case 'file'` + `segment.schema.json` mirror; **new** confinement branch (repo-relative else literal `<external>`; do NOT reuse `relativizePath`); allowlist-by-construction (no spread) | `harness/cli/src/services/telemetry/segment.ts`, `segment.schema.json` + test | AC-03 out-of-repo→`<external>` (not basename); AC-04 only allowlisted fields; schema validates |
| [x] | T004 | **TDD**: OTLP — add `harness.file.path/change/lines_added/lines_removed/bytes_added/bytes_removed` to `semconv.ts`; add **both** encode (`otlp/logs.ts` ~:148) and decode (~:322) `case 'file'`; update `harness-otlp.schema.json` frozen key-set in lockstep. `otlp/metrics.ts` intentionally untouched | `harness/cli/src/services/telemetry/otlp/{semconv.ts,logs.ts,harness-otlp.schema.json}` + test | AC-05 encode→decode round-trip + freeze test both green |
| [x] | T005 | Emit `file` events from **claude** adapter: `Write`→written (full `content`), `Edit`→edited (`old_string`/`new_string` delta), at parse site ~:309-312; dedup per path per window | `harness/cli/src/services/telemetry/adapters/claude-adapter.ts` + fixture test | Transcript fixture yields expected `file` events (AC-01, AC-02) |
| [x] | T006 | Emit `file` events from **copilot** adapter: `apply_patch` +/- → delta (`patchByCall`); `create`/`edit`/`str_replace` read `arguments.file_text`/`old_str`/`new_str` **for counts only** (privacy-safe); dedup | `harness/cli/src/services/telemetry/adapters/copilot-adapter.ts` + fixture test | Ledger fixture yields `file` events for apply_patch AND create/edit; copilot-vscode/cursor emit none (AC-07) |
| [x] | T007 | Exclude `'file'` from `rollup.ts` activity/gap/stage math (add to the `:190` filter beside `flow_log`/`artifact`/`mark`); add derived `authorship` aggregate (`files`,`lines_added`,`bytes_added`) as a pure function of `event_stream` | `harness/cli/src/services/telemetry/rollup.ts` + test | AC-06 a stream with `file` events yields byte-identical `rollup.activity`; aggregate derives |
| [x] | T008 | Report/insights: surface the per-file written set + deltas ("which files did agents write"); lightweight | `harness/cli/src/services/telemetry/report.ts`, `insights.ts`, `report.schema.json` | AC-08 report includes files + deltas; schema validates |
| [x] | T009 | Regenerate telemetry golden fixtures (`npm run gen:telemetry-fixtures`) then confirm `npm run check:telemetry-fixtures` green | telemetry fixture corpus | `check:telemetry-fixtures` passes with the new event present |
| [x] | T010 | Document the `file` event + `harness.file.*` attributes in the telemetry field reference | `docs/how/telemetry-field-reference.html` | Field reference lists the new event + attributes |

## Acceptance criteria (from plan)
AC-01 Write→one `file` event, change=written, delta=full content size (removed 0). AC-02 Edit→change=edited, delta=added+removed (not total). AC-03 out-of-repo→path=`<external>`. AC-04 serializer allowlist (no free text). AC-05 OTLP round-trip + freeze test green. AC-06 `file` excluded from `rollup.activity` (byte-identical). AC-07 vscode/cursor emit zero `file` events. AC-08 report surfaces files + deltas.

## End-of-work gate
Run `harness checks` (or `--quick` mid-iteration) — all sensors green before reporting done.

# Execution log — flow-replay-telemetry (Simple, one phase)

Plan: `flow-replay-telemetry-plan.md` · validated-with-fixes (V1–V4 folded in).

## Phase: Implement (flow_log) — 2026-06-25

Testing: lightweight unit (vitest + telemetry fakes). All tasks landed in one pass.

| Task | What landed | Evidence |
|---|---|---|
| T001 | `flow_log` event kind — `FlowLogEvent` + union + `EVENT_KINDS` | `events.ts`; tsc clean |
| T002 | schema: `flow_log` in kind enum + `op`/`edge_op` fields | `segment.schema.json`; schema test green |
| T003 | `serializeEvent` `flow_log` case — allowlist by construction | `segment.ts`; planted-secret test |
| T004 | pure projector `flowLogEvents(parsed, fromOffset) → {events,nextOffset}` | `flow-log.ts` (new); 10 unit tests |
| T005 | capture wiring — `flowCursorPathFor` per (session,plan), offset window, `readFlightPlan` (single read feeds snapshot + log), append flow_log last, persist offset | `capture-service.ts`, `cursor.ts` |
| T006 | rollup isolation — `computeRollup` filters `flow_log` before sort/gap/wall/stage | `rollup.ts`; AC-07 regression (wall_s=60 w/ days-old backfill) |
| T007 | tests — projection/offset/privacy/malformed + capture integration + rollup regression | `flow-log.test.ts` (10) |
| T008 | docs — `flow_log` row + replay framing + blind-spot bound | `telemetry.md`, `event-schema-v2*.md` |

**Proof**: `just build` clean · full suite **1284 passed** (10 new) · hard gates tests/skills-check/windows-check **ok** · arch-check clean for new code (only the pre-existing `sync-service` warn).

**AC status**: AC-01..07 all met (coverage map in plan).

### Deferred & Noteworthy
- **Noteworthy** — node-updated projects `node`(+`edge_op`) but **not** `fields[]` (the changed field-name list), per the plan's lean choice. `fields[]` is pure shape and safe; a one-line add if replay later wants "what changed". Not a gap.
- **Noteworthy** — `flow_log` markers are appended *after* the harness tail (not time-sorted into the window) to avoid shifting the prepended `flow`/`branch` head and the harness anchor; a replay consumer sorts the concatenated session timeline by `t`. Documented in `telemetry.md`.

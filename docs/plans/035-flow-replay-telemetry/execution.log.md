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

## Review fixes — 2026-06-25 (REQUEST_CHANGES → addressed)

| Finding | Sev | Disposition |
|---|---|---|
| F001 schema rejects `flow_log.node`/`type` | HIGH | **FIXED** — added `node`+`type` to `segment.schema.json` event props; new lockstep test serializes a full `flow_log` and asserts every key is schema-allowlisted (catches future serializer/schema drift). |
| F002 AC-04/AC-07 evidence gaps | MED | **FIXED** — added a two-plan-one-session independence test (separate `.flowcursor` offsets) + a full rollup-invariance test (every `activity` field + `flow_stage_time_s` unchanged by backfilled `flow_log`). |
| F003 G2 Constitution N/A wrong | MED | **FIXED** — `constitution.md` exists; G2 → PASS (P2 ports-only via injected FsPort, arch-check clean; counts-only privacy). |
| F004 tests lack Test Doc blocks | MED | **DECLINED (suite-wide)** — rules.md scopes Test Doc blocks to `test/unit/`+`test/integration/` (line 86); none of the 26 `test/services/telemetry/` siblings carry them. Matching siblings; a Test-Doc rollout is a suite-wide decision, not a one-file divergence. |
| F005 out-of-scope untracked doc | MED | **NOT OURS** — `detailed-system-overview.md`/`docs-content.ts` are a concurrent session's untracked files, never in this plan's commits; left untouched per the no-modify-concurrent-work rule. |
| F006 duplicate cursor helpers | LOW | **DECLINED** — `readFlowCursor` returns `0`-on-corrupt vs `readCursor`'s `null`-on-corrupt (different semantics by design); a forced merge would conflate them. |
| F007 task boxes unchecked | LOW | **FIXED** — task table marked [x]. |

Re-verify: `just build` clean · full suite **1287 passed** (+3 review-fix tests).

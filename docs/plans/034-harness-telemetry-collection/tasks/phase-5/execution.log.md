# Phase 5 — execution log (Event-stream v2, Amendment A2)

Mode: Full · Companion: `code-review-companion` (run `2026-06-24T06-21-00-876Z-3107`) · TDD-first · arch-check per task.

---

## Commit 1 — T5.1 + T5.2 + T5.3: event substrate + schema v2.0 + rollup engine

**What landed**
- `src/services/telemetry/events.ts` (new) — v2 event types (`prompt|turn|tools|skill|flow|harness|checks|command_exit|subagent|compaction|model|api_error`), `EVENT_KINDS`, `t_precision` honesty flag, `Rollup` types.
- `src/services/telemetry/rollup.ts` (new) — pure engine: `classifyGap` (agent/human/idle, `IDLE_CAP_S=300`), `collapseToolBursts` (`BURST_N_S=30`), `inferSkillStatuses`, `computeRollup` (gap → activity, flow-stage time, token sum, tool/skill/outcome tallies). No `node:*` import (hexagonal-clean).
- `src/services/telemetry/segment.ts` (mod) — `SEGMENT_SCHEMA_VERSION` → `2.0`; added `event_stream: Event[]` + `rollup: Rollup | null`; `serializeEvent` = per-kind allowlist (AC-15 privacy boundary); rollup **derived from the serialized events** so it can't drift (AC-16).
- `src/services/telemetry/segment.schema.json` (mod) — v2.0: `event_stream` items (`additionalProperties:false` over the field union) + `rollup` shape; `schema_version` const `2.0`.
- Tests: `events-rollup.test.ts` (new); migrated `segment.test.ts`, `segment-schema.test.ts`, `future-harness-adapter.test.ts` to v2.0 + extended the freeze snapshot and null-defaults.

**Evidence**
- `npx vitest run test/services/telemetry` → 159 passed.
- `npx vitest run` (full) → **1210 passed**.
- `harness arch-check` → degraded with **1 warn**, and that warn is **pre-existing Phase 4** (`sync-service.ts → git-write-port.ts` should be type-only). The new Phase-5 modules added **0** shape violations.

**Decisions**
- Stream field named **`event_stream`**, not `events` — the v1 `events` key (compactions/api_errors/local_commands) is kept as the compat view (task 5.2: "keep v1 counts"); renaming it would break v1 consumers. Design docs (`event-schema-v2*.md`) call it `events`; reconcile in 5.9.
- `rollup` is **never** taken from caller input — always derived in the serializer from `event_stream` → AC-16 "no drift" is structural.
- `SegmentInput` gained `event_stream?` only (no `rollup?`).

### Discoveries & Learnings
| # | Kind | Note | Tag |
|---|------|------|-----|
| D-501 | gotcha | Companion boot died on a `\| head -5` pipe (SIGPIPE). Boot minih backgrounded with NO truncating pipe. | — |
| D-502 | decision | v2 stream is `event_stream` (v1 `events` retained for compat) — diverges from the design-doc field name; 5.9 reconciles. | Noteworthy |
| D-503 | difficulty | arch-check reports a **pre-existing** Phase-4 warn: `sync-service.ts` imports `git-write-port.ts` non-type-only (`services-ports-type-only`). Not Phase-5; left for a scoped follow-up. | Noteworthy |

### Companion review — commit 1 (`7d33083`)
Companion `code-review-companion` (run `…3107`) reviewed `7d33083` and returned (in its farewell summary; its structured findings tripped minih's own findings-schema, so they arrived as prose, not inbox `finding` messages):
| Sev | Finding | Disposition |
|---|---|---|
| MEDIUM | v1 top-level count fields can contradict the derived `event_stream` rollup (AC-16 drift risk) | **Addressed by construction in 5.4**: adapters derive v1 counts + events from the same source; `claude-events.test.ts` asserts `rollup.tools == seg.tools` and `rollup.tokens == v1 token buckets`. Full cross-harness guarantee tracked into 5.4 (Copilot) / 5.9. |
| LOW | v2 schema still carries the old `$id` `segment-1.0.json` | **Fixed** in commit 2 → `segment-2.0.json` + a guard test (`$id tracks the schema version`). |
| magicWand | `MINIH_PROJECT_ROOT` not exposed to shell | **Ignored** — known planned minih fix (agent memory), not a Phase-5 finding. |

No HIGH/CRITICAL. Companion run idled out (~19min) after review → reboot a fresh run for commit 2.

---

## Commit 2 — T5.4 (Claude): adapter event emission + companion LOW fix

**What landed**
- `src/services/telemetry/event-builder.ts` (new) — shared `buildEventStream` (direct events + collapsed tool bursts + status-inferred skills, sorted by `t`).
- `src/services/telemetry/rollup.ts` (mod) — `collapseToolBursts` now collapses **same-name runs only** (no lossy `"mixed"`), so `rollup.tools` equals the v1 `tools` histogram (AC-16).
- `adapters/harness-adapter.ts` + `capture-service.ts` (mod) — `event_stream` added to `HarnessCapabilities` + threaded through `buildInput`.
- `adapters/claude-adapter.ts` (mod) — emits prompt / turn (dur+tokens+model) / tool-burst / skill (status) / subagent / compaction / harness events from a **timestamped** transcript; `null` when the source has no timestamps.
- `segment.schema.json` (mod) — `$id` → `segment-2.0.json` (companion LOW).
- Tests: `claude-events.test.ts` (new); `events-rollup.test.ts` burst test updated; `segment-schema.test.ts` `$id` guard added.

**Evidence**: `npx vitest run test/services/telemetry` → 166 passed; full suite → 1218 passed; arch-check → still only the 1 pre-existing P4 warn (0 new).

### Discoveries & Learnings
| # | Kind | Note | Tag |
|---|------|------|-----|
| D-504 | decision | Burst rule collapses **same-name runs only** (dropped the doc's lossy `"mixed"`) so `rollup.tools == v1 tools` (AC-16). | Noteworthy |
| D-505 | decision | Claude adapter emits events only when transcript lines carry `timestamp`; the Phase-2 fixture is timestamp-less, so a new timestamped fixture drives the test — Phase-2 untouched. | — |
| D-506 | decision | `flow` / `checks` / `command_exit` events deferred from 5.4 to 5.6/5.7 (they come from `the-flow.json` nav + command results, not the transcript). | Deferred |

Companion (run `…1dae`) reviewed `c2a0712` → **no findings** (clean).

---

## Commit 3 — T5.4 (Copilot): adapter event emission

**What landed** — `adapters/copilot-adapter.ts` (mod): emits prompt / turn / tool-burst / model / subagent / harness events from the timestamped `events.jsonl`. Turns pair `assistant.turn_start`/`turn_end` (dur_s) with **per-interaction tokens** attributed from the process-log `assistant_usage` blocks (so Σ turn tokens == the v1 aggregate, AC-16). `copilot-events.test.ts` (new).

**Evidence**: `npx vitest run test/services/telemetry` → 173 passed; full suite → 1225 passed; arch-check → 1 pre-existing P4 warn only.

### Discoveries & Learnings
| # | Kind | Note | Tag |
|---|------|------|-----|
| D-507 | decision | Copilot turn tokens attributed per `interaction_id` (process log) → the turn event of that interaction. When events carry no interaction ids (older format), per-turn tokens are omitted → rollup.tokens could under-count vs v1 (logged, edge case; fixture exercises the interaction path). | Noteworthy |
| D-508 | decision | Copilot skill events skipped (the adapter never parsed `skill.invoked`; v1 skills already null) — consistent with current counts; revisit if skills land in copilot counts. | Deferred |

### Companion review — commits c2a0712 + 5be03e5 (run `…1dae`)
| Sev | Finding | Disposition |
|---|---|---|
| **HIGH** | Copilot event emission missed tools whose name appears only on `execution_complete` (not `execution_start`) → `rollup.tools` would under-count vs v1 `tools` (AC-16 drift). | **Fixed** (commit 4): emit the tool-call event at the FIRST event carrying the name (start OR complete) — matches the v1 counts path exactly. Regression test added (name only on `execution_complete`). |
| MEDIUM | Design docs still described the lossy `"mixed"` tool-burst bucket removed by the same-name rule. | **Fixed** (commit 4): `event-schema-v2-detail.md` §4.2 + tools row updated to same-name-only + the AC-16 rationale. |

Real AC-16 bug caught by the companion — the value of live review. No HIGH/CRITICAL remain.

---

## Commit 4 — companion HIGH + MEDIUM fixes (Copilot tool-name + doc drift)

`copilot-adapter.ts` emits the tool-call event at whichever event first carries the name; `copilot-events.test.ts` gains a regression (name only on `execution_complete`); `event-schema-v2-detail.md` burst rule de-references `"mixed"`. 1226/1226 green; arch-check clean.

Companion (run `…4d43`) reviewed `610b872` → **no findings** (clean).

---

## Commit 5 — T5.5 (Cursor): bubble-anchored event stream

**What landed** — `adapters/cursor-adapter.ts` (mod): the transcript is untimed, so `readBubbleTimeline` reads the IDE-store bubbles (`createdAt` + `type` + `modelName`) and the adapter correlates windowed transcript turns to bubbles by conversation order (`countRole` for global indices). Emits prompt + turn (model, **no tokens**) timed to bubble `createdAt`; tools/skills/harness anchored to their turn — all flagged `t_precision: "anchored"`. `event-builder.ts` gained a `precision` option for the generated tool/skill events. `event_stream` is **null** when there are no timed bubbles (headless CLI session) — honest, never fabricated. `cursor-events.test.ts` (new).

**Evidence**: cursor tests 18 passed; full suite → 1231 passed; arch-check → 1 pre-existing P4 warn only.

### Discoveries & Learnings
| # | Kind | Note | Tag |
|---|------|------|-----|
| D-509 | decision | Cursor timeline is **bubble-anchored** (transcript↔bubble correlation by conversation order). All Cursor events carry `t_precision: "anchored"`; tokens stay null. Headless sessions (no bubbles) → `event_stream: null`. | Noteworthy |
| D-510 | gotcha | Cursor turn `dur_s` is `0` (bubbles give a start instant, not a span); the rollup's activity uses inter-event gaps, so working_ratio is still correct. | — |

---

## Commit 6 — T5.6: flow-stage events from `the-flow.json` nav

**What landed**
- `src/services/telemetry/flow-nav.ts` (new) — pure `flowEventFromFlightPlan(parsed, t)`: `flow`=`provenance.agent`, `stage`=`nav.now`, `status`=the `nav.now` node's lifecycle narrowed to `done|blocked|in_progress`; `t_precision:"anchored"`; `from` omitted; defensive → `null` on any unrecognised shape. No `node:*` (hexagonal-clean).
- `src/services/telemetry/capture-service.ts` (mod) — `withFlowEvent` reads the linked plan's `docs/plans/<id>/the-flow.json` via `FsPort`, builds the command-level flow event anchored to the window's first event, and **prepends** it so `computeRollup` attributes the window's gap-time to the current stage (`flow_stage_time_s`). Best-effort: no plan / no flight plan / malformed JSON / empty stream → stream unchanged.
- Tests: `flow-events.test.ts` (new) — the pure derivation (status mapping, harness-loop agent, null cases, no `from`) + the capture injection (prepend + stage attribution, no-plan, empty-stream, malformed-plan-never-breaks-capture).

**Evidence**: telemetry suite → 188 passed; full suite → **1241 passed**; `harness arch-check` → still only the 1 pre-existing P4 warn (`flow-nav.ts` added **0** shape violations).

**Decisions**
- Flow event is read from `the-flow.json` nav at capture, **never from command args** (AC-18 / §4.4) — a `harness flow nav <target>` drops the target as a param, so args are unreliable; the nav is the source of truth.
- One flow event per command window (a window sits at one stage), anchored to the window start. `from` is omitted — a single capture observes the current position, not the transition that reached it.
- Flow event injection lives in **capture-service**, not the adapters: the flight plan is the same regardless of harness, so all three adapters get stage attribution for free.

### Discoveries & Learnings
| # | Kind | Note | Tag |
|---|------|------|-----|
| D-511 | decision | Skill-status is **already wired** (`buildEventStream` → `inferSkillStatuses` in all 3 adapters). `lastSkillActive` stays an honest **false**: no adapter has a positive "skill still open at segment end" signal within a bounded per-command window, so a trailing skill serialises `completed` (we never fabricate `active`). The helper supports `active` for a future open-without-close signal. | Noteworthy |
| D-512 | decision | `flow.status` maps the `nav.now` **node's** lifecycle (`done|blocked` pass through; everything else → `in_progress`) rather than `nav.bag.status` — the node status is the per-stage truth; the bag is session-global. | — |

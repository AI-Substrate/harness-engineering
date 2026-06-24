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

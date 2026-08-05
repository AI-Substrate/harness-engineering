# Flow-replay telemetry — surface the flight-plan event log

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-25
**Status**: READY
**Spec source**: unified (this file)

> Design settled conversationally (research node done) — this is a focused,
> fix-sized change, written lean. No interactive clarification rounds.

## Business Specification

### Summary

Telemetry currently reads only a **snapshot** of `the-flow.json`'s `nav.now` per
command window — it never sees the flow's actual movement. Meanwhile the flight
plan already keeps a complete, timestamped, append-only **`events[]` audit log**
(every `cursor-moved` / `status-changed` / `node-created` / `node-updated` /
`created`, each with a real `fired_at`). This change **surfaces an allowlisted
projection of that log into the telemetry event stream**, windowed so each event
is emitted once, so a flow session can be roughly reconstructed — *which stages it
moved through, what completed, what was edited, and when*.

### Goals

- Emit the flight-plan event log as telemetry events with their **real `fired_at`**
  timestamps, so the stage journey + edits + timings are reconstructable.
- Capture **all** built-in event kinds (it's pure shape — node ids, statuses,
  from/to, edge ops — no free-form content to redact).
- Keep the existing `flow` snapshot as the **current-stage anchor** (the
  `branch`-field parallel: state where you are; the log marks the transitions).
- Window via a per-session watermark so events aren't re-emitted across captures.

### Non-Goals

- **No change to the `harness flow` command** — telemetry reads the log passively,
  the same posture as reading `nav.now` today.
- No rework of `flow_stage_time_s` to be log-driven yet (the snapshot still drives
  it; log-driven exact timing is a later refinement).
- No surfacing of free-form fields: manual-event `description`, custom-event
  `value`, comment text, `nav.intent`, `nav.bag` are never copied.

### Design decisions (locked in conversation)

| Decision | Choice |
|---|---|
| Source | `the-flow.json` `events[]` (the existing audit log), read at capture |
| Scope | **all** built-in event kinds, surfaced as their structural shape |
| Telemetry shape | one new kind `flow_log` with `op` + the event's structural fields (read from the source event's `details`) |
| Free-form | dropped by construction (allowlist per `op`; never the 2 free-form strings) |
| Windowing | **append-only array offset**, keyed per **(session, plan)**: `<session>.<planId>.flowcursor` stores the count of `events[]` already surfaced — emit `events[priorCount..]`. NOT a `fired_at` timestamp (V-finding 1: ms-resolution collisions silently drop/double-emit; V-finding 3: a single session cursor can't window two per-plan logs). |
| First capture (no offset) | surface the full history from offset 0 (it *is* the replay) — safe now that `flow_log` is rollup-isolated (below) |
| **Rollup isolation** | `flow_log` events are **pure replay markers** — `computeRollup` **excludes** them from gap / `wall_s` / `flow_stage_time_s` (V-finding 2: their real `fired_at` would otherwise re-sort into the stream and bill huge mis-attributed gaps, esp. on backfill). The existing `flow` snapshot keeps driving stage-time. |
| Snapshot | **kept** — the current-stage anchor, same call as `branch` vs branch-event |
| Replay blind spot (bounded) | `cursor-moved` fires only on a real move, so the **initial** stage (before the first move) is recoverable only via the first `cursor-moved.from`, and an advisory `nav set --next`-only flow leaves no journey. Documented in T007 so "no journey" isn't misread as "stayed put" (V-finding 4). |

### `flow_log` event shape (allowlist by construction)

```jsonc
{ "t": "<fired_at>", "t_precision": "anchored", "kind": "flow_log",
  "op": "cursor-moved | status-changed | node-created | node-updated | created",
  "node": "<id>?", "from": "<stage|status>?", "to": "<stage|status>?",
  "type": "<node type>?", "edge_op": "<splice-after|splice-before|…>?" }
```

Per-`op` field projection (everything else on the source event is dropped):

| source `op` | fields surfaced |
|---|---|
| `cursor-moved` | `from`, `to` (the stage move) |
| `status-changed` | `node`, `from`, `to` |
| `node-created` | `node`, `type` |
| `node-updated` | `node`, `edge_op?` (the `fields[]`/comment text are **not** copied) |
| `created` | — (presence only) |

### Acceptance Criteria

1. **AC-01** — A `cursor-moved` log entry surfaces as `{kind:flow_log, op:"cursor-moved", from, to, t:<fired_at>}`.
2. **AC-02** — `status-changed`, `node-created`, `node-updated`, `created` surface with their allowlisted fields and real `fired_at`.
3. **AC-03 (privacy)** — A manual event `description`, a custom `value`, and node comment text never appear in any serialized `flow_log` event (allowlist-by-construction; planted-secret test).
4. **AC-04 (windowing, collision-proof)** — Across two captures, each log entry is emitted exactly once even when several events share a `fired_at` millisecond; the per-(session,plan) `.flowcursor` advances by the count surfaced (array offset, not a timestamp). A session touching two plans windows each plan's log independently.
5. **AC-05 (anchor kept)** — The existing `flow` snapshot event is still emitted.
6. **AC-06 (best-effort)** — No flight plan / empty log / unparseable plan → zero `flow_log` events, no throw (capture never breaks).
7. **AC-07 (rollup isolation)** — `flow_log` events do not change `rollup.activity` (`wall_s`/`agent_working_s`/`idle_s`) or `flow_stage_time_s`: a segment with backfilled `flow_log` entries from an earlier time produces the *same* rollup numbers it would without them (regression test with a days-old `fired_at`).

### Testing Strategy

Lightweight unit tests (vitest, existing `FakeFs`/`FakeClock`). Pure projection is
table-tested; capture-service integration covers the watermark + dedup + the
planted-secret privacy control. No new mocks — reuse the telemetry fakes.

### Documentation Strategy

Update existing docs only: `docs/how/telemetry.md` (the event-stream section) and
the v2 schema docs under `docs/plans/034-…/` (add the `flow_log` kind + replay
framing). No new doc files.

### Complexity

**Score**: CS-2 (small). S=1 I=1 D=1 N=1 F=0 T=1. **Confidence**: 0.9.
Self-contained: one new pure source + a watermark (a proven pattern, copied from
`.branch`) + a serializer case + tests. No command changes, no consumer changes.

## Planning Seam
_Refinement opportunities still open — recorded as evidence; none gate:_
- Open Workshop Opportunities: none — design settled in conversation.

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | n | design done in conversation (research node) |
| workshops/*.md | n | — |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | no open clarifications — design locked |
| G2 | Constitution | PASS | `docs/project-rules/constitution.md` exists. P2 (Ports & Adapters / Hexagonal): the new code stays in `services/telemetry`, reads via the injected `FsPort` only — no `node:*`; `arch-check` confirms (only the pre-existing `sync-service` warn). Privacy: `flow_log` is counts/shape-only (allowlist by construction), upholding the telemetry privacy floor. No principle violated → no deviation ledger needed. |
| G3 | Architecture | PASS | ports-only preserved (no `node:*` in services); reads via injected `fs` |
| G4 | ADR Compliance | N/A | no accepted ADRs touched |
| G5 | Structure | PASS | all required sections present |
| G6 | Testing Alignment | PASS | unit tests per task; AC measurable |
| G7 | Domain Completeness | N/A | no domain registry; touches the telemetry service only |

### Summary

Add one new event kind (`flow_log`) and a pure projector that reads
`the-flow.json` `events[]` and emits an allowlisted, structural telemetry event per
log entry at its real `fired_at`. Wire it into the capture-service behind a
per-session `.flowcursor` watermark (mirroring the existing `.branch` mechanism)
so each entry is surfaced exactly once. The existing `flow` snapshot stays as the
current-stage anchor. No change to the flow command, the rollup engine, or any
consumer.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/telemetry/events.ts` | telemetry | contract | add `flow_log` kind to the Event union + EVENT_KINDS |
| `harness/cli/src/services/telemetry/segment.schema.json` | telemetry | contract | add `flow_log` to the kind enum + its fields |
| `harness/cli/src/services/telemetry/segment.ts` | telemetry | internal | `serializeEvent` case (allowlist) |
| `harness/cli/src/services/telemetry/flow-log.ts` | telemetry | internal | NEW — pure projector `flowLogEvents(parsed, sinceFiredAt)` |
| `harness/cli/src/services/telemetry/capture-service.ts` | telemetry | internal | `.flowcursor` read/write + compose into `event_stream`; advance after write |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | High | The log is **pure shape** — built-in events carry only `{from,to,node,type,fields,edge_op}`; comment text lives on the node, not the event. | Allowlist per `op`; drop only the 2 free-form fields (manual `description`, custom `value`). |
| 02 | High | `flow-nav.ts` already resolves the flight-plan path + parses it (`flightPlanPath`, `withFlowEvent`). | Reuse that path resolution; add the log projection beside the snapshot. |
| 03 | Medium | `.branch` watermark (read/write temp+rename, per-session) is the exact pattern for `.flowcursor`. | Copy `branchPathFor`/`readBranch`/`writeBranch` shape for the flow cursor. |
| 04 | High | Flow events are wall-clock (`fired_at`); `computeRollup` re-sorts the whole `event_stream` by `t` and bills gaps/`wall_s`/`flow_stage_time_s` (`rollup.ts:136,146,161`). A real (or backfilled) `fired_at` would re-sort in and fabricate huge mis-attributed gaps. | **Rollup-isolate `flow_log`** (T006): exclude it from gap/wall/stage; it stays in the stream for replay only. (Corrects an earlier "no straddle issue" assumption.) |
| 05 | High | The clock is ms-resolution (`new Date().toISOString()`) and one CLI call fires multiple events (`insertNode`), so `fired_at` collides — a timestamp watermark drops or double-emits at the boundary. | Window by **append-only array offset** per (session, plan), not a timestamp (T004/T005). |
| 06 | Low | First capture has no offset; the cursor is per-session but the log is per-plan. | Offset 0 surfaces full history (safe — rollup-isolated); key the cursor per (session, plan). |

### Implementation

**Objective**: Surface the flight-plan event log into telemetry, windowed, as the `flow_log` kind, keeping the snapshot anchor.
**Testing Approach**: Lightweight unit (vitest + existing telemetry fakes); table-test the projector, integration-test the watermark + privacy control.

#### Tasks

| Status | ID | Task | Path(s) | Done When | Notes |
|--------|-----|------|---------|-----------|-------|
| [x] | T001 | Add the `flow_log` event kind: union + `EVENT_KINDS` + the `FlowLogEvent` interface (`op` required; `node`/`from`/`to`/`type`/`edge_op` optional). | `…/telemetry/events.ts` | `flow_log` is a valid `Event`; tsc clean | shape per spec |
| [x] | T002 | Extend `segment.schema.json`: add `flow_log` to the event `kind` enum + add `op`/`edge_op` to the event field union (the other fields already exist). | `…/telemetry/segment.schema.json` | schema key-set test green | AC-01/02 |
| [x] | T003 | `serializeEvent` case for `flow_log` — allowlist by construction: pick `op` + only the present structural fields, never spread. Unknown `op` → `{t,kind,op}` skeleton. | `…/telemetry/segment.ts` | planted-secret test passes | AC-03 |
| [x] | T004 | NEW pure projector `flowLogEvents(parsed, fromOffset): { events: Event[]; nextOffset: number }` — slice `events[]` from `fromOffset` (append-only array; NOT a timestamp filter), map each `op` → a `flow_log` event (allowlisted fields from `details`, `t=fired_at`, `t_precision:"anchored"`), return the events + the new offset (= total `events[]` length); defensive → `{events:[], nextOffset:fromOffset}`. | `…/telemetry/flow-log.ts` (new) | table tests green | AC-01/02/04/06 |
| [x] | T005 | Wire into capture-service: `flowCursorPathFor(cwd, session, planId)` keyed per **(session, plan)** + `readFlowCursor`/`writeFlowCursor` (integer offset; temp+rename, mirror `.branch`); reuse `flightPlanPath` to read+parse once, call `flowLogEvents(parsed, priorOffset ?? 0)`, append the `flow_log` events to `event_stream`, write `nextOffset` after the buffer write. Keep `withFlowEvent` snapshot. | `…/telemetry/capture-service.ts` | AC-04/05 integration tests green | first capture (offset 0) surfaces full history |
| [x] | T006 | **Rollup isolation**: in `computeRollup`, skip `kind==='flow_log'` events when computing gaps, `wall_s`, and `flow_stage_time_s` (filter them out of the sorted `ev` used for gap/wall; they remain in `event_stream` for replay). The existing `flow` snapshot still drives stage-time. | `…/telemetry/rollup.ts` | AC-07 regression test green | V-finding 2 — the load-bearing fix |
| [x] | T007 | Tests: `flow-log.test.ts` (per-`op` projection, allowlist/privacy, offset window incl. **same-`fired_at` siblings**, empty/malformed) + capture-service (offset advance, dedup across 2 captures incl. ms-collision, two-plan independence, snapshot retained, no-plan no-op) + rollup regression (days-old `flow_log` ⇒ unchanged `wall_s`/`flow_stage_time_s`). | `…/test/services/telemetry/` | all green; full suite green | negative control: secret in `description`/`value` |
| [x] | T008 | Docs: add the `flow_log` kind + the replay framing to `docs/how/telemetry.md` and the `event-schema-v2*.md` kind tables; **document the replay blind spot** (initial stage recoverable only via first `cursor-moved.from`; advisory-nav-only flows leave no journey) so "no journey" ≠ "stayed put". | `docs/how/telemetry.md`, `docs/plans/034-…/event-schema-v2*.md` | kinds table lists `flow_log`; blind spot noted; markdown-lint not worsened | also clears the branch_changed/old-shape doc debt while in there |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T001, T004 | flow-log.test.ts (cursor-moved row) |
| AC-02 | T001, T004 | flow-log.test.ts (status/node rows) |
| AC-03 | T003, T007 | segment/flow-log planted-secret test |
| AC-04 | T004, T005, T007 | flow-log.test.ts (offset + same-`fired_at` siblings); capture-service.test.ts (2-capture dedup, two-plan independence) |
| AC-05 | T005, T007 | capture-service.test.ts (snapshot still present) |
| AC-06 | T004, T005 | flow-log.test.ts + capture (no-plan / malformed) |
| AC-07 | T006, T007 | rollup regression (days-old `flow_log` ⇒ unchanged numbers) |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| First-capture full-history backfill is large on a long-running flow | Low | Low | flow logs are small (tens/plan); rollup-isolated, so size is the only cost — knob if it bites |
| A future custom/manual event grows a new free-form field | Low | Med | allowlist-by-construction: unknown fields are never copied; unknown `op` → skeleton |
| Replay blind spot (initial stage / advisory-nav-only flows) read as "stayed put" | Med | Low | bound + document in T008; absence reads as unknown, not as no-movement |

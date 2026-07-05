# `harness telemetry mark` — peer self-attestation verb
**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-07-05
**Status**: READY
**Spec source**: unified (this file)

📚 Incorporates findings from research-dossier.md

## Business Specification

### Research Context

The dossier (`research-dossier.md`, 8 findings) established that the mechanisms the mark verb needs **already exist**: the telemetry segment carries a closed `event_stream: Event[]` union (F-03); plan 050's `artifact` event is the counts+enums closed-vocab template (F-04); and the annotation-vs-work distinction is already implemented as a rollup exclusion filter (`rollup.ts:187-189`) plus a `laneSemantics` attribution channel decoupled from cost (F-05). The one novel seam: every existing semantic event is *auto-derived* during passive capture — none is *agent-invoked* — so `mark` is a new pattern with no exact twin (F-04).

### Summary

Add a `harness telemetry mark` CLI verb: a peer's **counts-only self-attestation** emitted as a new semantic event onto its own session telemetry lane. It closes the reviewer lane-attribution hole — a read-only reviewer runs no harness command and may write no file, so its verdict never reaches its lane today. The verb is shape-guarded and generic (carries no flow vocabulary), so any peer can stamp any stage outcome; the flow/skill layer supplies the vocabulary as prose (the agent formats the call), keeping the one cross-platform surface the Node CLI already ships.

### Goals

- A peer can emit a structured, counts-only marker (`kind`, optional `verdict`, integer finding-count buckets) onto its own telemetry lane with one CLI call.
- The marker is **attribution-visible** to the fleet report (`get-fleet` / `laneSemantics`) and **cost-excluded** (never double-counts tokens).
- Inputs are **shape-guarded** (identifier slugs + integers) with **no free-text field** — leak-proof by construction, mirroring the `captured_env` value-shape-guard posture.
- The verb is **generic** — it carries no flow-stage vocabulary; the skill/flow layer owns which `kind`/`verdict` to emit, as prose the agent renders into the call.

### Non-Goals

- **The mechanical per-stage seam spine is explicitly deferred** (per the sequencing decision D-4): this plan ships the verb + ONE consumer proof (a reviewer-style verdict on its own lane), not the eng-harness-flow / the-flow auto-emit-at-every-seam wiring. That follows once consumption is proven.
- **No skill-side binary.** The flow-side "formatter" is prose, not a second cross-platform executable — out of scope here (and pending the separate the-flow-in-repo decision).
- No changes to how cost/tokens are computed; marks ride the *existing* exclusion mechanisms, they don't alter them.
- No free-text / prose capture, ever.

### Target Domains

No `docs/domains/registry.md` exists in this repo — domains are informal. This work is confined to the **telemetry** area (`harness/cli/src/services/telemetry/` + `harness/cli/src/acts/telemetry.ts`).

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| telemetry | existing | **modify** | Add a `MarkEvent` kind, the `mark` subverb, exclusion + attribution wiring |

### Testing Strategy

- **Approach**: Full TDD for the pure logic (guard, event serialize/schema-equality, rollup exclusion, laneSemantics read); lightweight for the commander wiring. Matches the telemetry suite's existing discipline (`segment-schema.test.ts` key-equality, adapter tests, fixture corpus).
- **Rationale**: the load-bearing correctness is in the closed-schema mirror + the cost-exclusion filter — both are exactly the kind of invariants a mutation-tested unit proves.
- **Focus Areas**: slug/value-shape guard accept/reject; segment↔schema key-set equality after the new kind; rollup contributes-zero for a mark event; laneSemantics surfaces the mark without touching cost.
- **Excluded**: no e2e harness spawn; the consumer proof is a fixture-driven unit test (a synthetic segment with a mark event through `get-fleet`/rollup), not a live fleet run.
- **Mock Usage**: **avoid mocks — real fixtures only** (telemetry corpus convention, plan 037).

### Documentation Strategy

- **Location**: `docs/how/telemetry.md` (exists) — add a `mark` section documenting the verb, the shape-guard contract, and the skill-prose (agent-formats, not a second binary) formatter contract. Regenerate `docs-content.ts` via `npm run gen:docs`.
- **Rationale**: telemetry's canonical how-doc; keeps the counts-only / annotation-vs-work contract discoverable.

### Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2 (touches events/segment/schema/rollup/fleet/acts/docs), I=1 (all within telemetry), D=1 (a new closed event kind), N=1 (agent-invoked emit is a new pattern but every mechanism exists), F=0, T=1 (schema-equality + exclusion invariants)
- **Confidence**: 0.85
- **Assumptions**: the write-own-marker-segment mechanism (D-2) is viable via the existing `sessionDirFor`/`nextSeq` path; the capture preamble's own segment for the `mark` command is harmless (both `tokens:null`).
- **Dependencies**: none external; builds only on live telemetry code.
- **Risks**: see Risks table.
- **Phases**: 1 (Simple).

### Acceptance Criteria

- **AC-01** — `harness telemetry mark --kind review --verdict fix-required --findings-critical 1` emits a segment on the caller's session lane carrying a `MarkEvent` (`kind`, `verdict`, count buckets), with segment `tokens: null`.
- **AC-02** — an invalid `--kind`/`--verdict` (uppercase, whitespace, prose, or > 32 chars) is rejected with an `unconfigured` outcome whose `next_action` names the allowed `^[a-z][a-z0-9-]{0,31}$` shape; no malformed marker is written.
- **AC-03** — a `MarkEvent` contributes **zero** to rollup gap/time/token math (it is in the `rollup.ts` exclusion list) and zero to fleet lane cost (segment `tokens: null`).
- **AC-04** — `get-fleet` / `laneSemantics` surfaces the mark on the **emitting peer's** lane as attribution — including a **mark-only lane** (a read-only reviewer with no artifact/flow events must NOT read `semantics_measured:false`) — distinct from other peers, with that lane's cost aggregation unchanged by the mark.
- **AC-05** — the `MarkEvent` has **no free-text field**: `kind`/`verdict` are shape-guarded slugs, counts are integers; the closed-vocab is enforced the way `ArtifactEvent` enforces its `counts`/`enums`.
- **AC-06** — `docs/how/telemetry.md` documents the verb + the skill-prose formatter contract; `docs-content.ts` is regenerated and `check:docs` is green.

### Risks & Assumptions

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| The `MarkEvent` kind is omitted from the `rollup.ts:187-189` exclusion list | Low | High (mark classified as work, corrupts gap/time) | AC-03 unit test asserts zero contribution — RED until the kind is added |
| `segment.ts` ↔ `segment.schema.json` key drift after adding the kind | Med | Med (CI break) | `segment-schema.test.ts` key-equality is the existing guard; bump `SEGMENT_SCHEMA_VERSION` 2.2→2.3 in lockstep |
| Double-segment (preamble + own marker) muddies counts | Low | Low | Both `tokens:null`; accept, or suppress `telemetry mark` argv from the capture preamble (`shouldCaptureForargv`) — decide in task T-005 |
| A mark-only lane reads `cost_measured:false` | Very low | Low | Theoretical — a peer that marks has also done captured inference; mark is additive. Note in docs, do not engineer around |

### Open Questions

None blocking. The four design decisions (D-1..D-4) are resolved below with leans baked in and surfaced for veto at report-ready.

### Workshop Opportunities

None — the design was settled in-conversation (this plan's `original-ask.md` records it) and grounded by the dossier. No `Spike/POC`: feasibility is proven (every mechanism exists in live code, F-01..F-08).

### Clarifications

#### Session 2026-07-05

Round 1 (orchestrator-chosen defaults under "keep it simple / report ready" — surfaced for veto):
- **Workflow Mode**: Simple (`--simple`).
- **Testing Strategy**: Full TDD for core logic / lightweight for wiring — matches telemetry suite norms.
- **Mock Usage**: Avoid mocks; real fixtures (plan 037 corpus convention).
- **Documentation Strategy**: `docs/how/telemetry.md` (existing).

**Design decisions (baked; veto at report-ready):**
- **D-1 — new `mark` event kind** (not overload `artifact`): a mark is not a changed file; copy `ArtifactEvent`'s closed `counts`/`enums` shape, not its kind.
- **D-2 — write-own-marker-segment**: the verb writes its own `<seq>.json` via `sessionDirFor`/`nextSeq` (self-contained, isolated to test); the preamble's own segment is accepted or the argv is suppressed (T-005).
- **D-3 — observe-style `unconfigured`/exit-2** surfacing for a bad slug (telemetry is best-effort, non-blocking) — not record's `E108`/exit-1.
- **D-4 — scope**: verb + one reviewer-verdict consumer proof; the mechanical seam spine is deferred (Non-Goal).

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved (design settled in-conversation + dossier-grounded)

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings + the four decisions |
| workshops/*.md | n | — (design settled in-conversation) |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No critical [NEEDS CLARIFICATION] markers; Round 1 defaults recorded |
| G2 | Constitution | PASS | Additive verb; reuses established telemetry patterns; no principle violated |
| G3 | Architecture | PASS | Same layer (services/telemetry + acts); no new dependency or boundary crossing |
| G4 | ADR Compliance | N/A | No `docs/adr/*.md` in repo |
| G5 | Structure | PASS | All required sections present + populated |
| G6 | Testing Alignment | PASS | TDD: test tasks precede impl; ACs are measurable |
| G7 | Domain Completeness | PASS | No domain registry; single informal domain (telemetry); manifest covers all touched files |

### Summary

Add a `MarkEvent` to the closed telemetry event union and a `harness telemetry mark` subverb that emits it — shape-guarded, counts-only, onto the caller's own session lane. Wire it into the existing annotation-vs-work machinery (rollup exclusion + laneSemantics attribution) so it is cost-excluded yet attribution-visible, and prove one consumer (a reviewer-style verdict landing on its own lane). Document the verb + the skill-prose formatter contract in `docs/how/telemetry.md`.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/telemetry/events.ts` | telemetry | contract | Add `MarkEvent` interface + `EventKind`/`EVENT_KINDS` member + closed count/verdict vocab |
| `harness/cli/src/services/telemetry/segment.ts` | telemetry | contract | `serializeEvent` case; `SEGMENT_SCHEMA_VERSION` 2.2→2.3 |
| `harness/cli/src/services/telemetry/segment.schema.json` | telemetry | contract | Mirror the new kind (key-equal per `segment-schema.test.ts`) |
| `harness/cli/src/services/telemetry/mark.ts` *(new)* | telemetry | internal | Slug/value-shape guard + `MarkEvent` builder; writes a marker segment via `serializeSegment` (`segment.ts:455`, fills `tokens:null` itself) + the seq helper |
| `harness/cli/src/services/telemetry/capture-service.ts` | telemetry | internal | Export `nextSeq` (private today `:215`) or add a small `writeSegmentFile(deps, cwd, sessionId, segment)` helper for `mark.ts` (the atomic write is inline in `captureTelemetry` `:663-686`) — per F2 |
| `harness/cli/src/acts/telemetry.ts` | telemetry | contract | Register `.command('mark')` (chained on the `telemetry` command `:493`, parallel to `sync`/`get-fleet`/`insights`/`sweep`) |
| `harness/cli/src/services/telemetry/rollup.ts` | telemetry | internal | Add `mark` to the `:188` exclusion filter (`e.kind !== 'flow_log' && e.kind !== 'artifact'`) |
| `harness/cli/src/services/telemetry/fleet-evidence.ts` | telemetry | **contract** | `laneSemantics` (`:469`) collects a `mark` dimension; amend the blind-guard (`:480`) so a mark-only lane isn't dropped; add a `mark` field to `FleetLaneSemantics` (`:112`) — **changes `get-fleet` output schema** — per F1 |
| `harness/cli/src/services/telemetry/fleet-export.schema.json` | telemetry | contract | Mirror the new `FleetLaneSemantics.mark` field in the `get-fleet` output schema — per F1 |
| `docs/how/telemetry.md` + `docs-content.ts` | telemetry | internal | Document verb + skill-prose contract + the F3 nuance (mark surfaces via `get-fleet` `.json`, not `telemetry report`/OTLP); `gen:docs` |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Annotation-vs-work already exists: `rollup.ts:188` excludes `artifact`/`flow_log`; `laneSemantics` (`fleet-evidence.ts:469`) is the attribution channel, decoupled from cost (F-05) | Add `mark` to the exclusion list; extend `laneSemantics` to read it — reuse the mechanism, don't invent |
| 06 | Critical | `laneSemantics` (`fleet-evidence.ts:474`) collects **only** `artifact` events and returns `blindLaneSemantics()` (`semantics_measured:false`) when a lane has 0 artifacts + no flow time (`:480`); `FleetLaneSemantics` (`:112`) has no mark field. A **read-only reviewer that only marks** would be dropped — the exact target case (critic F1) | T006 is a CONTRACT change: add a `mark` dimension + amend the blind-guard + mirror `fleet-export.schema.json`; T007 fixture must be a **mark-only** lane |
| 07 | High | `serializeSegment` (`segment.ts:455`) is exported and fills all `SEGMENT_REQUIRED_KEYS` defaults incl. `tokens:null` (`:476`); but there is **no exported segment-writer** — `nextSeq` is private (`:215`), the write is inline in `captureTelemetry` (`:663`) (critic F2) | AC-01's `tokens:null` is FREE via `serializeSegment`; T005 must export `nextSeq`/add `writeSegmentFile`. `readSegments` matches `^\d+\.json$` (`session-evidence.ts:185`) — the `.json` alone suffices, no OTLP sidecar |
| 02 | Critical | `event_stream` is a closed discriminated union; a new kind = 4 lockstep edits + schema-version bump (F-03) | T-002/T-003 touch `events.ts` + `segment.ts` serialize + `segment.schema.json` + version together; `segment-schema.test.ts` is the guard |
| 03 | High | The `artifact` event (050) is the counts+enums closed-vocab template; but all existing semantic events are auto-derived — `mark` is a new agent-invoked emit (F-04) | Copy `ArtifactEvent`'s closed-vocab shape (D-1); build the emit fresh via the capture path (D-2) |
| 04 | High | Cost never keys on `segment.command`; exclusion must be structural — `tokens:null` + non-`turn` event + rollup-excluded (F-06) | Mark segment carries `tokens:null`; AC-03 asserts zero contribution |
| 05 | Med | Reusable guard = `^[a-z][a-z0-9-]*$` slug family (`record-service.ts:26`) + `isIdShapedValue`/`ENV_VALUE_MAX_LEN` value-shape (`capture-service.ts:161-170`) (F-07) | Reuse the pattern (+`{0,31}` bound); `observe`-style `unconfigured` surfacing (D-3) |

### Implementation

**Objective**: Ship `harness telemetry mark` — a shape-guarded, counts-only, cost-excluded, attribution-visible peer self-attestation — plus one consumer proof and docs.
**Testing Approach**: Full TDD for guard / schema-equality / exclusion / laneSemantics; lightweight for commander wiring. Real fixtures, no mocks.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | **Test-first**: guard spec — valid slugs accepted, invalid (uppercase/space/prose/>32ch) rejected | telemetry | `harness/cli/test/services/telemetry/mark.test.ts` | RED: asserts `^[a-z][a-z0-9-]{0,31}$` accept/reject + integer-only counts | Per finding 05 |
| [ ] | T002 | **Test-first**: `MarkEvent` in the closed union + segment↔schema key-equality holds after the new kind; `SEGMENT_SCHEMA_VERSION` = 2.3 | telemetry | `events.ts`, `segment.ts`, `segment.schema.json`, `test/…/segment-schema.test.ts` | Add `MarkEvent` (kind `mark`; closed `verdict?`, `counts` int buckets — copy `ArtifactEvent` vocab shape); `serializeEvent` case; schema mirror; version bump; key-equality test GREEN | Per findings 02, 03; D-1 |
| [ ] | T003 | Implement the guard + `MarkEvent` builder (reuse `isIdShapedValue` posture; no free-text field) | telemetry | `harness/cli/src/services/telemetry/mark.ts` *(new)* | T001 GREEN; builder returns a validated `MarkEvent` or a shaped error | AC-05 |
| [ ] | T004 | **Test-first**: a `MarkEvent` contributes ZERO to rollup gap/time/token math | telemetry | `test/…/rollup.test.ts` | RED until `mark` added to the `rollup.ts:187-189` exclusion filter; then GREEN | AC-03; finding 01 |
| [ ] | T005 | Register `.command('mark')`; build the marker via `serializeSegment` (fills `tokens:null`); write the `<seq>.json` via an exported `nextSeq`/new `writeSegmentFile` helper; decide preamble-suppress vs accept | telemetry | `acts/telemetry.ts`, `mark.ts`, `capture-service.ts` (export helper) | `harness telemetry mark --kind review --verdict fix-required --findings-critical 1` writes a `<seq>.json` segment carrying the `MarkEvent`; bad slug → `unconfigured` + shape `next_action` | AC-01, AC-02; D-2, D-3; findings 06/07 |
| [ ] | T006 | **Contract change** (not a one-liner): extend `laneSemantics` to collect a `mark` dimension; amend the blind-guard (`:480`) so a mark-only lane is not dropped; add a `mark` field to `FleetLaneSemantics` + mirror `fleet-export.schema.json`; assert cost/tokens unchanged | telemetry | `fleet-evidence.ts`, `fleet-export.schema.json`, `test/…/fleet-evidence.test.ts` | A **mark-only** lane surfaces its mark in semantics (`semantics_measured:true`, not blind) with cost/tokens untouched; get-fleet output schema validates | AC-04; findings 01, 06 |
| [ ] | T007 | **Consumer proof**: fixture with a **mark-only reviewer lane** + a coder lane; the reviewer's mark surfaces on its own lane, distinct, cost-excluded | telemetry | `test/…/fleet-*.test.ts` (fixture-driven) | `get-fleet` over the fixture shows the mark on the reviewer lane only (not blind), coder lane unaffected, cost aggregation intact | AC-04; D-4 scope proof; finding 06 |
| [ ] | T008 | Document the verb + shape-guard + skill-prose (agent-formats, not a second binary) contract + the F3 nuance (mark surfaces via `get-fleet` `.json`, not `telemetry report`/OTLP); optionally add `kind !== 'mark'` to `report.ts` `viewOf` (`:368`) for timeline purity; regenerate docs | telemetry | `docs/how/telemetry.md`, `docs-content.ts`, `report.ts` (optional) | `npm run gen:docs` run; `harness checks` incl. `check:docs` green | AC-06; finding F3 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T005 | `harness telemetry mark …` emits a MarkEvent segment (`tokens:null`) |
| AC-02 | T001, T005 | guard reject test + `unconfigured` next_action |
| AC-03 | T004 | rollup zero-contribution test |
| AC-04 | T006, T007 | laneSemantics attribution + consumer-proof fixture |
| AC-05 | T001, T003 | closed-vocab guard, no free-text field |
| AC-06 | T008 | docs updated + `check:docs` green |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `laneSemantics` blind-guard drops a mark-only reviewer lane (`semantics_measured:false`) — the exact target case | **High if unaddressed** | **High** (breaks headline Promise) | T006 amends the `:480` guard + adds the mark dimension; T007 proves a mark-only lane surfaces |
| `mark` kind omitted from rollup exclusion | Low | High | T004 RED-first asserts it |
| segment↔schema key drift (both `segment.schema.json` and `fleet-export.schema.json`) | Med | Med | T002/T006 schema-mirror + `SEGMENT_SCHEMA_VERSION` bump |
| double-segment noise | Low | Low | both `tokens:null`; T005 decides suppress vs accept |

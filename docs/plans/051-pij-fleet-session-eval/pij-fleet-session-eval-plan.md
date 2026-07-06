# pij Fleet Session-Join Eval — FleetEvidence, get-fleet, scenario intent
**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-07-04
**Status**: READY
**Spec source**: unified (this file)

## Business Specification

### Research Context
📚 Incorporates findings from `research-dossier.md` (F-01..F-11) and the authoritative workshop `workshops/001-fleet-join-and-eval-design.md` (D1–D5, join spike PROVEN).

### Summary
A flow-pair fleet (orchestrator + pij coder(s) + reviewer) is currently invisible as a unit: telemetry captures each session separately and the only lookup is single-session. The join keys (`PIJ_PARENT_ID`/`PIJ_SESSION_ID`/`PIJ_HARNESS`) are already captured and synced. This plan builds the read-side fleet join — a `FleetEvidence` merge and a `harness telemetry get-fleet` verb — plus the scenario `intent` (reason/vibe) register, and validates it all against the already-captured plan-050 fleet (13 children, 99 segments). This is the substrate the fleet-vs-solo eval runs will stand on.

### Goals
- One CLI call turns a root pij id (+ optional roster) into a fleet evidence object with honest time/cost totals.
- Every measured scenario carries *why we measure it and its vibe* (`intent` field + register).
- The join validated on real history (the 050 fleet) before any live eval run is spent.

### Non-Goals
- The live `fleet-md-to-pdf` eval run and flow-eval fleet-mode scoring lanes (follow-on work, consumes this substrate).
- Fixing copilot token capture (`tokens: null`, dossier F-07) — separate work; this plan *marks* those lanes unmeasured.
- Grandchild recursion (workshop Q1 — contract reserves it; ships depth-1).
- Syncing/repairing the external repos' telemetry (osk old-harness data, dossier risk row).

### Target Domains
_No `docs/domains/` registry in this repo — informal mapping:_

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| telemetry (services/telemetry) | existing | **modify** | FleetEvidence merge + fleet export schema + get-fleet lookup |
| cli acts (acts/telemetry) | existing | **modify** | `telemetry get-fleet` verb wiring |
| flow-eval extension (.harness/extensions/flow-eval) | existing | **modify** | scaffold emits `intent`; scenario schema gains optional field |

### Testing Strategy
- **Approach**: Hybrid — unit tests (vitest) for the merge, diff, and time extraction against real-shaped fixtures; lightweight verification for act wiring and scaffold output.
- **Mock Usage**: real data/fixtures only (repo convention — the fixture corpus exists for this).
- **Focus Areas**: unmeasured-lane cost semantics (never zero-filled), orphan/unrostered diffs, OTLP timestamp extraction, schema closure.
- **Excluded**: live pij spawning; network.

### Documentation Strategy
- **Location**: `docs/how/telemetry.md` (§ fleet section) — repo convention.

### Complexity
- **Score**: CS-3 (medium) · **Breakdown**: S=1, I=1, D=1, N=1, F=0, T=1 · **Confidence**: 0.8
- **Assumptions**: OTLP `session.metrics.jsonl` timestamps are readable per session (spike T001 proves or adjusts).
- **Dependencies**: none new; reads existing capture output + flow-pair run ledgers.
- **Risks**: see § Risks.
- **Phases**: 1 (Simple).

### Acceptance Criteria
1. **AC-01** `harness telemetry get-fleet pij-4s10mb --json` (worktree: this repo) returns a FleetEvidence with ≥13 child lanes and per-lane `pij_id`/`harness`/`cost_measured`.
2. **AC-02** Copilot lanes report `cost_measured: false` and are **excluded** from `totals.cost` sums (never zero-added); `unmeasured_lanes` counts them; totals over measured lanes match the dossier spike (≈78.8M grand-total for the 050 fleet).
3. **AC-03** `totals.time` carries `wall_clock_s` (span union) and `active_s` (span sum) derived from OTLP metric timestamps (or segment timecodes fallback), non-null for the 050 fleet.
4. **AC-04** With `--roster <run.json>`, membership scopes to the roster and `orphans`/`unrostered` diffs are populated (D1); without it, scope is `env-tree`.
5. **AC-05** `flow-eval scaffold` emits `intent: {reason, vibe}` in the scenario skeleton; all existing `scenario.json` files still load (field optional).
6. **AC-06** The fleet-050-retrospective validation is recorded: get-fleet output over the real 050 fleet committed as evidence in this plan folder, discrepancies (if any) vs the spike explained.
7. **AC-07** Counts-only privacy holds: the fleet export schema is closed (`additionalProperties: false`), carries ids/counts/enums only, and a payload with an un-enumerated key fails validation (negative test).

### Risks & Assumptions
- DL-007 (flow-eval score's telemetry lookup diverges from `telemetry get`) — this plan routes fleet evidence exclusively through the session-evidence path (H-02).
- Parent pij ids span the orchestrator's life — un-rostered env-tree joins can conflate runs; roster scoping is the run-accurate mode (D1).

### Open Questions
_None blocking — workshop Q1 (recursion) and Q2 (external corpus snapshot) deliberately deferred._

### Workshop Opportunities
_All resolved — `workshops/001-fleet-join-and-eval-design.md` covers join model, contract, dimensions, scenario register, build order._

### Clarifications
#### Session 2026-07-04
- Q: Workflow Mode? → A: **Simple** (orchestrator decision; CS-3, single cohesive change, 050 precedent).
- Q: Testing Strategy? → A: **Hybrid** (unit for merge/time/diff; lightweight for wiring).
- Q: Mock Usage? → A: **Real data/fixtures only.**
- Q: Documentation? → A: **docs/how/telemetry.md.**

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved (WS1 Contract Ready).

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings (F-05/F-07/F-08, H-02) |
| workshops/001-fleet-join-and-eval-design.md | y | authoritative: D1–D5 contracts drive every task |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | no `[NEEDS CLARIFICATION]` markers; round-1 recorded |
| G2 | Constitution | PASS | acts thin / services pure / envelope contract respected |
| G3 | Architecture | PASS | new service module + act wiring follow the P2 split; no port changes |
| G4 | ADR Compliance | N/A | no `docs/adr/` directory |
| G5 | Structure | PASS | all required sections present |
| G6 | Testing Alignment | PASS | Hybrid: merge/time/diff tasks carry unit-test done-whens |
| G7 | Domain Completeness | PASS | no registry; informal manifest covers all files |

### Summary
Build the read-side fleet join as a pure service (`fleet-evidence.ts`) that enumerates sessions by `captured_env` join keys, merges N existing `SessionEvidence` objects into a `FleetEvidence` (workshop D2 contract), computes honest totals (D3: cost lower-bound with unmeasured lanes marked; time from OTLP timestamps), and reconciles against an optional flow-pair roster (D1). Expose it as `harness telemetry get-fleet`. Add the scenario `intent` field + register (D4). Validate everything against the already-captured 050 fleet (D5) — no live run spent.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/telemetry/fleet-evidence.ts` (NEW) | telemetry | internal | enumerate + merge + diff + totals |
| `harness/cli/src/services/telemetry/fleet-export.schema.json` (NEW) | telemetry | contract | closed counts-only export shape (AC-07) |
| `harness/cli/src/services/telemetry/session-evidence.ts` | telemetry | internal | export the per-session builder for reuse (read-only refactor) |
| `harness/cli/src/acts/telemetry.ts` | cli acts | internal | `get-fleet` verb wiring |
| `.harness/extensions/flow-eval/extension.ts` (+ scaffold template) | flow-eval | internal | scaffold emits `intent` |
| `harness/cli/test/services/telemetry/fleet-evidence.test.ts` (NEW) | telemetry | internal | unit tests incl. negative schema case |
| `docs/how/telemetry.md` | docs | internal | § fleet |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | No cohort primitive exists; only `getSessionEvidence(pijId)` 1:1 (dossier F-05) | FleetEvidence merges N of them — reuse, don't reimplement |
| 02 | Critical | Copilot lanes carry `tokens: null` (F-07) | `cost_measured:false`, excluded from sums, loudly counted (AC-02) |
| 03 | High | Segment `window` is event-index, not wall-clock (F-08) | Time from OTLP `session.metrics.jsonl` timestamps; timecode fallback (T001 spike proves) |
| 04 | High | DL-007: flow-eval score's own lookup diverges from `telemetry get` (H-02) | Route all fleet evidence through the session-evidence path |
| 05 | Medium | Parent id conflates runs across the orchestrator's life (D1) | roster scoping + orphan/unrostered diffs as first-class output |

### Implementation

**Objective**: One CLI call resolves a fleet's evidence with honest three-dimension totals, validated on the 050 fleet; scenarios carry their intent.
**Testing Approach**: Hybrid (per business half).

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | Spike (scratch): time extraction from OTLP `session.metrics.jsonl` + roster reconcile over the 050 fleet | telemetry | scratch only | go/no-go on timestamp source recorded in execution log; wall/active computed for ≥2 lanes; roster⇄tree diff printed | workshop D5 step ② |
| [ ] | T002 | `FleetEvidence` types + pure merge/diff/totals (D2 contract; D3 semantics; unmeasured lanes never zero-filled) + unit tests on real-shaped fixtures | telemetry | `fleet-evidence.ts`, `fleet-evidence.test.ts` | vitest green; AC-02 semantics asserted; orphan/unrostered diff asserted (AC-04) | reuse `getSessionEvidence` |
| [ ] | T003 | Closed export schema + `harness telemetry get-fleet <root-pij-id> [--roster <path>] [--worktree <p>] --json` wiring | telemetry, cli acts | `fleet-export.schema.json`, `acts/telemetry.ts` | AC-01 passes live on this repo; negative-key payload fails validation (AC-07) | envelope contract |
| [ ] | T004 | Scenario `intent` field: scaffold emits `{reason, vibe}`; optional in scenario load; fixture test proves old scenarios load | flow-eval | flow-eval extension + fixtures | AC-05 | non-breaking |
| [ ] | T005 | fleet-050-retrospective validation: run get-fleet on `pij-4s10mb` (+ roster from `.flow-pair/runs/`), commit evidence + register table update | telemetry | `docs/plans/051-.../evidence/fleet-050.json`, this plan § register | AC-06; totals reconcile with the dossier spike | zero live cost |
| [ ] | T006 | `docs/how/telemetry.md` § fleet + `just build` + `harness checks` green | docs | `docs/how/telemetry.md` | checks exit 0 (warn-launch degradeds tolerated) | |

#### Scenario Register (D4 — lives here per workshop)

| Scenario | Reason | Vibe | Stresses |
|---|---|---|---|
| `md-to-pdf-*` family (existing) | Solo baselines already laddered in the ledger — free comparators | Single agent, full harness conduct | quality |
| `fleet-050-retrospective` (T005) | Validate the join on history before spending a live run | Archaeology: the eval works on data we already have | cost, time |
| `fleet-md-to-pdf` (follow-on) | The direct fleet-vs-solo comparison on a laddered task | Orchestrator plans + verifies, workers build — a real team, not one model in three hats | all three |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T002, T003 | T003 done-when (live run) |
| AC-02 | T002 | T002 unit tests + T005 reconcile |
| AC-03 | T001, T002 | T002 tests; T005 live output |
| AC-04 | T002, T003 | T002 tests + T005 roster run |
| AC-05 | T004 | T004 fixture test |
| AC-06 | T005 | committed evidence file |
| AC-07 | T003 | negative schema test |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| OTLP metrics lack usable per-lane timestamps | Low-Med | AC-03 blocked | T001 spike first; timecode fallback documented honestly |
| Roster files vary across flow-pair versions | Med | AC-04 flaky | parse defensively; roster optional — env-tree always works |
| Schema drift vs frozen OTLP allowlist | Low | checks red | fleet export is a NEW read-side schema; capture pipeline untouched |

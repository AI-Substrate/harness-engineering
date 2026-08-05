# Fleet telemetry lane sources — close the 051 measurement gaps

**Status**: READY
**Mode**: Standard (2 phases) · **CS-3**
**Flow**: 052 · branch `feat/041-flow-conformance-eval`
**Inputs**: [original-ask.md](./original-ask.md) · [research-dossier.md](./research-dossier.md) (F-01..F-10, all live-verified) · pij scoping `~/pi-hacking/pij/docs/notes/telemetry-join-keys-scoping.md` · fix backlog = session observes DL-001..005, SUGG-001..004, INS-001

## Business Specification

### WHY
The 051 fleet debrief needed manual archaeology (`~/.copilot` shutdown ledgers, `~/.codex` rollouts, ref fetching) to recover 3 of 4 cost lanes, and its semantics section was hand-assembled from repo files. "How are other people meant to do this kind of analysis if it's all obfuscated and arcane?" — they can't. The fix: every lane source the archaeology used becomes a deterministic reader inside `get-fleet`, the capture-layer defects that blinded worker lanes get fixed, and the knowledge that was tribal becomes docs.

### WHAT
1. `telemetry get-fleet` reports **all** lanes it can reach — live temp segments, synced telemetry refs, Copilot shutdown ledgers, codex rollouts — each lane stamped with its `source`, joined via the pij registry (`~/.pij/<id>.json`, which already persists `harnessSessionId`; F-04). Billing units (AIC / token buckets) carried per lane.
2. The 050 artifact-semantics layer works on **worker lanes** too (F-07 investigated + fixed) and stops mis-classifying packet templates as reviews (F-08).
3. `FleetEvidence` gains a **semantic rollup** — findings by severity, verdict path, fix cycles, phases, workshop decisions, chore completion, stage times — aggregated from artifact/flow/skill events across lanes, with honest per-lane coverage flags (a lane with no artifact capture reports `semantics_measured: false`, never zeros).
4. `docs/how/telemetry.md` carries the **lane-source matrix**: per harness — where cost/semantic data lives, when it materializes, the join key, what is never available.

### Non-goals
- pij-side changes (`pij sessions --json`, harness-aware adopt, export sugar) — Jordan + pij-z4bt25's lane; this plan only READS `~/.pij`.
- flow-pair skill teardown edits (skills are authored in ~/github/tools) — this plan delivers the CLI capability + documented procedure; the skill edit rides the next skill-source pass.
- USD conversion inside the CLI — pricing stays an analysis-layer concern (pricing.json); the CLI emits raw billing units only.

### Honesty invariants (carried from 051)
Unmeasured is never zero-filled; every lane lists its `source` and `cost_measured`/`semantics_measured` flags; side-channel readers degrade to unmeasured on shape mismatch (vendor internals, unversioned); sweep extracts ids/counts/enums ONLY — no prose, no event bodies (counts-only posture).

## Implementation Plan

### Phase 1: Lane sources + capture fixes

| ✓ | id | task | area | deliverable | proves | backlog |
|---|----|------|------|-------------|--------|---------|
| [ ] | T001 | **Investigate F-07**: why the copilot worker lane emitted 0 artifact events (adapter vs plan-cursor init). Diagnose at source with the real 34524328 ref + a live copilot probe; fix if the cause is small, else document + carve a follow-on. Root cause note in execution log | services/telemetry/adapters | diagnosis + fix or explicit deferral | AC-05 | DL-004 |
| [ ] | T002 | **Fix F-08 packet false positive**: review classification must not fire on `*-packet.md` / rubric-line verdict lists (require the Findings/Verdict report shape). Regression fixtures from the REAL 050+051 packets (scrubbed) + the real review.phase-1.md still extracting FIX_REQUIRED | artifact-semantics.ts | classifier fix + fixtures | AC-04 | DL-005 |
| [ ] | T003 | **Copilot shutdown reader**: pure extractor over `~/.copilot/session-state/<id>/events.jsonl` → `{aic, token_buckets, api_duration_ms, code_changes_counts}` from `session.shutdown`; ports-only I/O; malformed → unmeasured. Scrubbed real fixture (coder 34524328 shape) | services/telemetry | `copilot-ledger.ts` + tests | AC-01..03 | SUGG-002 |
| [ ] | T004 | **codex rollout reader**: last `token_count` per rollout in `~/.codex/sessions/<date>/`, joined via pij descriptor `transcriptPath` when present, explicit roster mapping else | services/telemetry | `codex-ledger.ts` + tests | AC-01..03 | SUGG-003 |
| [ ] | T005 | **Refs reader**: `candidateRoots` (or a sibling source) enumerates `refs/harness-telemetry/*` rollups so flushed lanes stay visible; live-vs-ref dedupe by session id | fleet-evidence.ts | ref source + tests | AC-06 | SUGG-001, DL-001 |
| [ ] | T006 | **pij registry join port**: read `~/.pij/*.json` descriptors → `pijId ↔ harnessSessionId/harness/model/spawnedBy` map; absent dir → source unavailable, never an error | services/telemetry | `pij-registry.ts` + tests | AC-01 | DL-002, F-04 |
| [ ] | T007 | **Wire into get-fleet**: source precedence live→ref→ledger; `FleetLane` gains `source`, `billing {aic?, token_buckets?}`; closed schema extended + negative-key test; **golden test: the real 051 run resolves 4/4 lanes (coder 1,742.9 AIC · reviewer 298.5 AIC · validator 1,368,083 · orchestrator live)** — regenerate 051 evidence as proof | acts + fleet-evidence + schema | 4/4-lane get-fleet | AC-01..03, AC-06 | — |
| [ ] | T008 | **Lane-source matrix** in `docs/how/telemetry.md`: per harness — cost/semantic sources, materialization timing (shutdown-only!), join keys, never-available; + run-end sweep procedure (sync → snapshot before teardown); + F-10 billing conventions. Kills the tribal-knowledge class | docs | matrix section | AC-08 | INS-001, DL-003 (documented as pij-lane) |

### Phase 2: Fleet semantic rollup

| ✓ | id | task | area | deliverable | proves | backlog |
|---|----|------|------|-------------|--------|---------|
| [ ] | T009 | **Semantic rollup in FleetEvidence**: aggregate artifact/flow_log/skill events per lane + fleet-level — review findings by severity, verdict sequence (fix cycles = FIX_REQUIRED→APPROVE transitions), plan phases/CS, workshop decisions, chore completion, `flow_stage_time_s` — with per-lane `semantics_measured` flag | fleet-evidence.ts | semantics block + tests | AC-07 | SUGG-004 |
| [ ] | T010 | **Schema**: closed extension of fleet-export for the semantics block (ids/counts/enums only) + negative-key test | schema | validated export | AC-03, AC-07 | — |
| [ ] | T011 | **Golden reconcile**: run the rollup on the 051 fleet; diff against the debrief §05 hand-made table (1 CRITICAL · 1 fix cycle · 5 decisions · 9/11 nodes · …); discrepancies explained in evidence note; commit as 052 evidence | evidence | `evidence/fleet-051-semantics.json` + note | AC-07 | — |
| [ ] | T012 | **Docs**: `docs/how/telemetry.md` § fleet semantics — what a telemetry-only report can/cannot claim, per lane coverage | docs | section | AC-08 | — |

### Acceptance criteria

1. **AC-01** `get-fleet pij-4s10mb --roster …` on the real 051 run returns **4/4 lanes measured** with billing units matching the debrief's recovered numbers exactly.
2. **AC-02** Malformed/unexpected side-channel shapes degrade the lane to `cost_measured:false` (fixture-proven), never crash, never guess.
3. **AC-03** Sweep output is ids/counts/enums only; export schema stays closed (`additionalProperties:false`); negative-key test fails an un-enumerated field.
4. **AC-04** Packet fixtures classify as NOT-review (or a distinct `packet` type); the real 051 review fixture still yields `verdict: FIX_REQUIRED`, findings `{critical:1}`.
5. **AC-05** F-07 root cause documented in the execution log; fixed, or deferred with a named follow-on.
6. **AC-06** After `git fetch` of telemetry refs, ref-resident lanes appear as sessions (not orphans) with `source:"ref"`.
7. **AC-07** The semantic rollup over the 051 fleet reproduces the debrief §05 quality counts for instrumented lanes, and reports `semantics_measured:false` (never zeros) for blind lanes.
8. **AC-08** The lane-source matrix exists in `docs/how/telemetry.md` and names shutdown-only timing explicitly.

### Gates
G1 intent (original-ask verbatim) PASS · G2 research (live-verified dossier) PASS · G3 decisions (051 workshop D1–D5 inherited; honesty invariants restated) PASS · G4 workshop N/A (no open design contention — readers follow the proven archaeology; escalate to workshop if T001 diagnosis reveals design tension) · G5 tasks↔ACs mapped PASS · G6 test strategy (real scrubbed fixtures + golden 051 numbers) PASS · G7 completeness (backlog ids all mapped; DL-003 explicitly routed to pij lane) PASS

### Test strategy
Real-shaped scrubbed fixtures for every reader (the actual 051 session shapes); golden-number tests against the debrief's recovered values; negative fixtures for shape drift; ajv negative-key tests for both schema extensions. No mocks of vendor formats — fixtures ARE the captured formats.

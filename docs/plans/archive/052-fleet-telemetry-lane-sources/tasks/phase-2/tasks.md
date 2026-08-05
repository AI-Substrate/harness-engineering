# Phase 2: Fleet semantic rollup — tasks

**Plan**: [../../fleet-telemetry-lane-sources-plan.md](../../fleet-telemetry-lane-sources-plan.md) · **Dossier**: [../../research-dossier.md](../../research-dossier.md) (F-06, F-09)
**Owner**: flow-pair coder (delegated) · **Gate**: `harness checks` green + golden reconcile vs the 051 debrief §05

## Context brief

Phase 1 made cost visible on every lane; Phase 2 makes *quality/semantics* a fleet-level output. Today artifact/flow_log/skill events are captured per segment (F-06: verified live in claude lanes — review findings counts, verdict enums, plan phases, workshop decisions, chore/node transitions, `flow_stage_time_s`) but never aggregated per fleet run (F-09) — the 051 debrief's quality table was hand-assembled from repo files. This phase adds a **semantic rollup** to `FleetEvidence` so a telemetry-only consumer gets those counts per lane + fleet-wide, with honest coverage flags.

**Ground truth for the golden reconcile (T011)** — the hand-made §05 table in the 051 debrief (`scratch/evals/2026-07-04-051-fleet-run/001-fleet-run-report.html`, section 05; read-only reference). Key counts: **1 CRITICAL finding · 1 fix cycle (FIX_REQUIRED→APPROVE) · workshop decisions 5 (051 plan inherited D1–D5) · flow nodes 9/11 done at debrief time**. Discrepancies between rollup and debrief are EXPECTED where lanes were blind (copilot lanes had 0 artifact events pre-T001-fix; reviewer lane had no harness telemetry at all) — the deliverable is the diff **explained in an evidence note**, not forced agreement.

**Honesty invariants (unchanged)**: a lane with no artifact capture reports `semantics_measured:false` — NEVER zeros; ids/counts/enums only; closed schema.

**Key locations**: `fleet-evidence.ts` (extend the evidence model you fixed in F1), `artifact-semantics.ts` (event shapes you already know), `fleet-export.schema.json`, tests + fixtures under `harness/cli/test/services/telemetry/` (the 051 scrubbed fixtures from Phase 1 are your input corpus), `docs/how/telemetry.md`.

## Task table

| ✓ | id | task | proves |
|---|----|------|--------|
| [x] | T009 | **Semantic rollup in FleetEvidence**: aggregate artifact/flow_log/skill events per lane + fleet-level — review findings by severity, verdict sequence (fix cycles = FIX_REQUIRED→APPROVE transitions), plan phases/CS, workshop decisions, chore completion, `flow_stage_time_s` — with per-lane `semantics_measured` flag (false ≠ zeros) | AC-07 |
| [x] | T010 | **Schema**: closed extension of `fleet-export.schema.json` for the semantics block (ids/counts/enums only) + negative-key test failing an un-enumerated field | AC-03, AC-07 |
| [x] | T011 | **Golden reconcile**: run the rollup over the real 051 fleet (fixtures + live orchestrator segments); diff vs the debrief §05 counts above; write `evidence/fleet-051-semantics.json` + an evidence note explaining every discrepancy (blind-lane vs real mismatch) | AC-07 |
| [x] | T012 | **Docs**: `docs/how/telemetry.md` § fleet semantics — what a telemetry-only report can/cannot claim, per-lane coverage, the `semantics_measured` contract | AC-08 |

Keep this table and `execution.log.md` live as you go.

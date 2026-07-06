# Worker packet — 052 Phase 2: Fleet semantic rollup (d-002)

**Run**: 2026-07-04-052-lane-sources · **Delegation**: d-002 · **Role**: coder
**Orchestrator**: pij-4s10mb (report via `pij send pij-4s10mb "<report>"`)

## Mission

Implement **ALL of Phase 2 (T009–T012) in this one run**. You built Phase 1 (commits `6b2811ba`, `533ea8f9`) — this extends the same `FleetEvidence` surface with a semantic rollup. Work from:

- Task table + context brief (golden §05 counts, honesty contract): `docs/plans/052-fleet-telemetry-lane-sources/tasks/phase-2/tasks.md`
- Plan (AC-03, AC-07, AC-08; § Honesty invariants): `docs/plans/052-fleet-telemetry-lane-sources/fleet-telemetry-lane-sources-plan.md`
- Dossier F-06/F-09 (what the segments already carry): `docs/plans/052-fleet-telemetry-lane-sources/research-dossier.md`

Read all three FIRST. Order: T009 → T010 → T011 → T012.

## Hard requirements

1. **`semantics_measured:false` is never zeros** — a blind lane's semantic counts are absent/flagged, not `0`. Negative test proves a blind lane is distinguishable from a lane that measured zero findings.
2. **Golden reconcile (T011)**: rollup over the real 051 fleet; diff vs debrief §05 (1 CRITICAL · 1 fix cycle · 5 workshop decisions · 9/11 nodes); write `evidence/fleet-051-semantics.json` + a note explaining EVERY discrepancy. Do not tune the rollup to force agreement — blind-lane gaps are the honest answer.
3. **Closed schema** (T010): `additionalProperties:false` intact; negative-key test on the new semantics block.
4. **Counts/ids/enums only** — no prose from artifacts enters the export; extend the privacy posture tests if you add fixtures.
5. **Non-goals**: no pij-side changes, no USD in CLI, no flow-pair skill edits, no re-litigating Phase 1 (its golden tests must stay green untouched).
6. **Gate**: `just fix` + FULL `harness checks` green before reporting. Update task table + `execution.log.md`.
7. Commit on `feat/041-flow-conformance-eval`, explicit pathspecs in allowed paths only, `--no-verify`, prefix `feat(telemetry-052):`. NEVER `git add -A`.

## Allowed paths

- `harness/cli/src/services/telemetry/**` · `harness/cli/src/acts/**` (get-fleet wiring only)
- `harness/cli/test/services/telemetry/**`
- `docs/how/telemetry.md`
- `docs/plans/052-fleet-telemetry-lane-sources/tasks/phase-2/**` · `docs/plans/052-fleet-telemetry-lane-sources/evidence/**`

Read-only: `scratch/evals/2026-07-04-051-fleet-run/` (the debrief — reference, never modify), `~/.copilot`/`~/.codex`/`~/.pij`.

## Forbidden paths

- `.the-flow-state.json`, `the-flow.json`, `the-flow.md` (any plan dir)
- `docs/plans/034-*/**`, `docs/plans/037-*/**`, `docs/plans/041-*/experience-logs/**`, `scratch/**` (writes), `.flow-pair/**`, `prompt-lab/**`

## Report format (when done)

Tasks completed, golden reconcile result (matched counts + each discrepancy in one line), `harness checks` exit, files touched count, commit SHA(s), deferrals + why.

# Fix packet — 052 Phase 1 (d-001, FIX round 1)

**Role**: coder · **Report to**: `pij send pij-4s10mb` · **Base**: your commit `6b2811ba`
**Source**: reviewer verdict FIX_REQUIRED — full review at `docs/plans/052-fleet-telemetry-lane-sources/reviews/review.phase-1.md`

## The one blocking finding

**F1 · MAJOR — malformed side-channel ledgers become orphans instead of unmeasured lanes.**
`fleet-evidence.ts:433-454` (`buildLedgerLane`) returns `null` when a reader comes back `measured:false`, and `enrichOrphans` (`:559-573`) then leaves that rostered member in `orphans` — so `sessions[]` and `totals.cost.unmeasured_lanes` omit a known roster member whose ledger exists but is malformed. This contradicts the plan's honesty invariant AND your own `docs/how/telemetry.md:278-281` ("stays `cost_measured:false` … counted in `unmeasured_lanes`").

## Required fix (reviewer's smallest-fix, adopted)

1. In the fleet wiring, distinguish **source absent** (no descriptor / no side-channel file → orphan is correct) from **source present but malformed/unmeasured** (reader ran, returned `measured:false`).
2. For the malformed case, emit a roster-scoped lane: `source:"ledger"`, `cost_measured:false`, `tokens:{grand_total:0,output:0}`, no `billing`, empty evidence — so the member stays in `sessions[]` and increments `unmeasured_lanes`.
3. **Fleet-level negative test** (the reviewer will re-check this specifically): a rostered member with a malformed shutdown/rollout fixture appears in `sessions[]` with `cost_measured:false` AND `totals.cost.unmeasured_lanes` counts it. Make it non-vacuous — assert the lane is present, not merely that nothing crashed.
4. Confirm the schema still validates the new degraded-lane shape (closed schema unchanged).

## Scope

ONLY `fleet-evidence.ts` + its tests/fixtures + (if the wording now mismatches) `docs/how/telemetry.md`. Same allowed/forbidden paths as your original packet (`tasks/phase-1/coder-packet.md`). Amend nothing — new commit, prefix `fix(telemetry-052):`, explicit pathspecs, `--no-verify`. Gate: `just fix` + full `harness checks` green. Update `execution.log.md`.

Report: fix summary, the negative test name + what it asserts, checks exit, commit SHA.

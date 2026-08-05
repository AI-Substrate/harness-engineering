# Review — 052 Phase 2

**Commit**: `46a3ec9c`  
**Verdict**: FIX_REQUIRED

## Findings

### F1 · MAJOR · fleet-level semantics omits `plan_cs` even though T009/T011/docs claim plan phases/CS

**Files**: `harness/cli/src/services/telemetry/fleet-evidence.ts:210-234`, `harness/cli/src/services/telemetry/fleet-evidence.ts:497-564`, `harness/cli/src/services/telemetry/fleet-export.schema.json:216-238`, `harness/cli/test/services/telemetry/fleet-semantics-golden-051.test.ts:220-223`, `docs/plans/052-fleet-telemetry-lane-sources/evidence/fleet-051-semantics-note.md:26-30`

**Claim**: Phase 2's task table requires the fleet semantic rollup to aggregate "plan phases/CS" at the lane and fleet level. The docs also advertise the semantic block as carrying `plan_phases` + `plan_cs`, and the reconcile note claims the Plan row reproduces `plan_cs:3 · plan_phases:1`.

**Evidence**: `FleetLaneSemantics` includes `plan_cs`, but `FleetSemantics` has only `plan_phases`; `fleetSemantics(...)` never copies/aggregates `plan_cs`; the top-level `fleetSemantics` schema also lacks `plan_cs`. The golden test comment says "CS-3 · Simple · 1 phase" but only asserts `expect(s.plan_phases).toBe(1)`. The committed evidence JSON likewise has `plan_cs:3` only in the orchestrator lane, not in the fleet-level `fleet_semantics` block. A telemetry-only consumer reading the advertised fleet-level rollup cannot recover the plan CS.

**Smallest fix**: Add `plan_cs?: number | null` to `FleetSemantics`, aggregate it from measured lanes consistently with `plan_phases` (structural max/first non-null is fine if documented), add it to `fleet-export.schema.json`, assert it in the semantic unit and 051 golden tests, and regenerate `fleet-051-semantics.json` so the note's `plan_cs:3` claim is true at fleet level.

## Dimension notes

- **D0 mutation gate**: PASS. I temporarily changed `blindLaneSemantics()` so `semantics_measured:false` lanes emitted a zero `findings` block. The focused test failed non-vacuously at `fleet-semantics.test.ts:231`, flipping `expect(b.findings).toBeUndefined()`. This proves blind lanes remain distinguishable from measured-zero lanes.
- **Aggregation spot-check**: PASS. I temporarily changed `countFixCycles(...)` to always return `0`. The focused test failed at `fleet-semantics.test.ts:187`, flipping `expect(s.fix_cycles).toBe(1)`. This proves the fix-cycle aggregate is computed from event verdict transitions, not a constant.
- **F1-class blind-vs-zero check**: PASS for findings/verdict/fix-cycle semantics. Blind lanes carry `semantics_measured:false`, omit dimensions, and fleet-level `measured_lanes`/`blind_lanes` provides the denominator; the 051 golden asserts 1 measured and 3 blind lanes. No downstream zero-fill/conflation found there.
- **Golden reconcile honesty**: FAIL due F1 for the Plan CS part of the claimed match. The other named reconcile facts are evidenced by the rollup/tests: workshop decisions `4`, nodes `11`/done `11`, chores `0`, and absent review findings/verdicts/fix cycle for blind lanes.
- **Closed schema / counts-only**: PASS aside from the missing fleet-level `plan_cs` field. New semantics blocks are closed with `additionalProperties:false`; `verdictPath` is enum-gated; tests reject extra keys in lane semantics, fleet semantics, and findings. I found no title/body/prose leakage in the semantic export.
- **Phase 1 untouched**: PASS. `fleet-golden-051.test.ts` remains green, including the Phase 1 4/4 lane and degraded-ledger F1 tests.
- **Lane discipline**: PASS. The diff stays within telemetry src/tests/schema/act wiring, generated docs content, docs/how, and 052 task/evidence files.

## Checks observed

- `cd harness/cli && npx vitest run test/services/telemetry/fleet-semantics.test.ts test/services/telemetry/fleet-semantics-golden-051.test.ts test/services/telemetry/fleet-golden-051.test.ts --coverage=false`: passed 27/27 after restoring mutations.
- `node harness/cli/bin/harness.js checks`: exit 0, status `degraded`; hard gates ok (`tests`, `biome`, `typecheck`, `check:docs`, `check:flows`, `check:telemetry-fixtures`, `check:doctrine-parity`, `skills-check`, `windows-check`), warn-launch degraded gates remain `arch-check` and `markdown-lint`.

---

## Re-review — F1 fix

**Commit**: `dd415226`  
**Verdict**: APPROVE

The F1 fix is real. `FleetSemantics` now includes `plan_cs?: number | null`; `fleetSemantics(...)` aggregates it with the plan rollup as max non-null across measured lanes and emits it whenever a measured plan is present; the closed fleet schema includes `plan_cs`; the unit and 051 golden tests assert fleet-level `plan_cs: 3`; and the regenerated `fleet-051-semantics.json` now carries `"fleet_semantics": { ..., "plan_cs": 3, ... }`.

**Non-vacuity proof**: I temporarily mutated the aggregator to `out.plan_cs = null`. The cited assertions both failed for the expected reason:

- `fleet-semantics.test.ts:277`: `expect(s.plan_cs).toBe(3)` received `null`.
- `fleet-semantics-golden-051.test.ts:224`: `expect(s.plan_cs).toBe(3)` received `null`.

After restoring the source, `cd harness/cli && npx vitest run test/services/telemetry/fleet-semantics.test.ts test/services/telemetry/fleet-semantics-golden-051.test.ts test/services/telemetry/fleet-golden-051.test.ts --coverage=false --reporter=dot` passed 27/27. `node harness/cli/bin/harness.js checks` exited 0 with status `degraded`; hard gates are ok, with the same warn-launch degraded `arch-check` and `markdown-lint` gates.

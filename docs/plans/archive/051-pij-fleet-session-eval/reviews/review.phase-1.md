# Review — plan 051 phase 1

**Verdict**: FIX_REQUIRED

## Findings

### F1 · CRITICAL · roster scope is only labelled, not actually scoped

**File:line**: `harness/cli/src/services/telemetry/fleet-evidence.ts:284-323`, `harness/cli/test/services/telemetry/fleet-evidence.test.ts:255-266`, `harness/cli/test/services/telemetry/fleet-evidence.test.ts:316-321`

**Claim**: With `--roster`, AC-04 and workshop D1 require membership to scope to the roster while still reporting `unrostered`/`orphans` as diffs. The implementation builds `sessions` from every env-tree child first, then only attaches roles and reports `unrostered`; totals iterate over that unfiltered `sessions` list. The tests encode the same drift by expecting roster mode to retain all 3 env-tree lanes, including `pij-copilot`, while calling the case "scopes to the roster".

**Proof**: Workshop D1 says "env tree = superset, roster/time-window = run scope" and AC-04 says "membership scopes to the roster". The real roster-scoped evidence demonstrates the impact: `fleet-050-roster-scoped.json` reports `scope:"roster"` and `pij-g7t974` as the 051 coder, but its `sessions`/`totals` still include the 13 unrostered 050-era children, preserving the 78,814,658 historical measured cost in what is labelled as the 051 roster-scoped run. That contaminates cost/time for fleet-vs-solo evaluation.

**Smallest fix**: In `buildFleetEvidence`, keep `envTreeIds`/`childIds` for diffs, but when `roster` is present build `sessions` and all totals from the orchestrator lane plus only child ids in `roleOf`. Leave absent roster members in `orphans`; leave env-tree children absent from `roleOf` in `unrostered` only. Add a regression with a measured unrostered child so cost/time contamination fails, and update the existing roster tests to assert the unrostered child is not in `sessions`.

## Dim-0 evidence

**Mutation applied**: Changed `harness/cli/src/services/telemetry/fleet-evidence.ts:303` from `if (lane.cost_measured)` to `if (true)`, intentionally making the unmeasured copilot lane count as measured.

**Assertion that flipped RED**: `harness/cli/test/services/telemetry/fleet-evidence.test.ts:183` in `AC-02: copilot lane is cost_measured:false, EXCLUDED from totals (never zero-filled)` failed: `expect(fleet.totals.cost.measured_lanes).toBe(2)` received `3`.

**Restoration confirmed**: Restored the source; `npx vitest run test/services/telemetry/fleet-evidence.test.ts` passed 17/17. Pre/post SHA-256 matched for `fleet-evidence.ts` (`65ed0cabfc6062b97b4ecfbe47f4379f5ab8ea0cfd2845b889baff97dbe3365b`) and `fleet-evidence.test.ts` (`f8e8a851f7d283477760e4bed8f6673a1a571b7f91c3a12e1962d2ea4394288c`).

## Checks run

- `cd harness/cli && npx vitest run test/services/telemetry/` — 61 files / 696 tests passed.
- `cd harness/cli && npx vitest run ../../.harness/extensions/flow-eval/scenario.test.ts ../../.harness/extensions/flow-eval/extension.test.ts` — 52 tests passed.

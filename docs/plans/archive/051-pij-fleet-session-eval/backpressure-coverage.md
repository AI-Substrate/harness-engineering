# Backpressure Coverage — pij fleet session-join eval

**Spec**: [pij-fleet-session-eval-plan.md](./pij-fleet-session-eval-plan.md) (unified plan — business half)
**Generated**: 2026-07-04
**Certainty**: Strong

> Advisory only. Never blocks, never gates, no scores. (Advisory backpressure survey.)

## Existing Sensors (inventory)

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| unit/component tests + coverage | `cd harness/cli && npx vitest run` (composed by `harness checks`) | behaviour | `harness/cli/test/**` |
| quality gate (CI-identical) | `harness checks` | behaviour + maintainability | `.harness/extensions/checks/` |
| typecheck / biome | via `harness checks` | maintainability | root |
| schema-closure precedent | ajv negative-key tests (plan 050 `artifact-semantics.test.ts`) | data/contract | `harness/cli/test/services/telemetry/` |
| telemetry fixture corpus | `fixtures/real/**` + `check:telemetry-fixtures` drift guard | data/contract | root |
| arch rules | `harness arch-check` (warn-launch) | architecture-fitness | `.dependency-cruiser.cjs` |
| real captured fleet | `.harness/temp/telemetry/` (13-child 050 fleet) + synced refs | behaviour (integration evidence) | this repo |

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail |
|--------------------------|----------------------|--------|------|-------------|
| AC-01 get-fleet resolves the 050 fleet | vitest integration test over real-shaped fixtures + live T005 run | EXISTS | computational | — |
| AC-02 unmeasured lanes never zero-filled | vitest unit assertions (T002) | EXISTS | computational | — |
| AC-03 wall/active time from OTLP timestamps | vitest (T002) after T001 spike proves the source | EXISTS | computational | — |
| AC-04 roster scoping + orphan/unrostered diffs | vitest (T002) + T005 roster run | EXISTS | computational | — |
| AC-05 scaffold emits intent; old scenarios load | vitest fixture test in flow-eval extension | EXISTS | computational | — |
| AC-06 fleet-050 evidence committed | git presence + human read of the reconcile note | — | human-judgement | — (legitimately judged) |
| AC-07 closed schema, negative key fails | ajv negative test (050 precedent pattern) | EXISTS | computational | — |
| Arch drift (service/act split) | `harness arch-check` | EXISTS | computational | — |

## Certainty: Strong

Every behaviour/architecture criterion has an EXISTS sensor (vitest + checks + ajv precedent + arch-check); the one human-judgement row (AC-06 evidence reconcile) is legitimately inferential.

## Suggested "done when" lines (advisory)

| For criterion | Suggested line | Backed by |
|---------------|----------------|-----------|
| whole phase | done when `harness checks` exits 0 (hard gates green) | EXISTS |
| AC-07 | done when the ajv negative-key test is RED-able by mutation (un-close the schema → test fails) | EXISTS |

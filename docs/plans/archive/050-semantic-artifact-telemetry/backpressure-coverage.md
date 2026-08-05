# Backpressure Coverage — semantic-artifact-telemetry

**Spec**: [semantic-artifact-telemetry-plan.md](./semantic-artifact-telemetry-plan.md) (unified plan, `## Business Specification`)
**Generated**: 2026-07-04
**Certainty**: Strong

> Advisory only. Never blocks, never gates, no scores.

## Existing Sensors (inventory)

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| vitest + coverage | `harness checks` (composes `vitest run --coverage`) | behaviour | `harness/cli/test/` (`vitest` configs at root) |
| typecheck | `harness checks` (tsc gate) | maintainability | root |
| biome | `harness checks` / `just fix` | maintainability | root |
| telemetry fixture drift guard | `harness checks` → `check:telemetry-fixtures` | behaviour / contract | root scripts |
| OTLP frozen-schema test + round-trip | `vitest` — `reconstruction.test.ts` ("every kind round-trips") + frozen-schema test | contract | `harness/cli/test/services/telemetry/` |
| segment schema validation in tests | `vitest` — schema-validated sample segments | contract | `harness/cli/test/services/telemetry/` |
| arch-check (dependency-cruiser) | `harness arch-check` (warn-launch in checks) | architecture-fitness | `.dependency-cruiser.cjs` |

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail |
|--------------------------|----------------------|--------|------|-------------|
| AC-01 review change → artifact event with counts | new integration case in `capture-service.test.ts` (T005), run by vitest | EXISTS | computational | — |
| AC-02 per-type extraction counts | per-extractor fixture tests (T005), vitest | EXISTS | computational | — |
| AC-03 time-series snapshots across windows | two-window test case (T005), vitest | EXISTS | computational | — |
| AC-04 defensive parse / guarded read never fails capture | garbage-input + missing/oversized-file cases (T005), vitest | EXISTS | computational | — |
| AC-05 privacy: no free text; enum construction gate | privacy-shape test (T005) + fixture privacy scan (`fixture-privacy-scan.test.ts` pattern) | EXISTS | computational | — |
| AC-06 whole gate green | `harness checks` (the CI command) | EXISTS | computational | — |
| AC-07 pipeline round-trip (serializer + OTLP) | `reconstruction.test.ts` "every kind round-trips" + frozen-schema test | EXISTS | computational | — |
| Failure mode: grammar drift zeroes counts silently | per-extractor fixture tests catch total breaks; partial drift is inferential (insights n-drop, later plan) | EXISTS (partial-drift residue inferential) | computational / inferential | — |
| Failure mode: rollup wall/gap skew from capture-time `t` | rollup exclusion asserted in T005 (events-rollup.test.ts pattern) | EXISTS | computational | — |

## Certainty: Strong

Every behaviour/architecture criterion (AC-01..07) is provable by sensors that already exist in the repo's gate — the new tests ride the existing vitest + checks + frozen-schema infrastructure; nothing needs to be built first. (No Recommended Phase 0.)

## Suggested "done when" lines (advisory)

| For criterion | Suggested line | Backed by |
|---------------|----------------|-----------|
| whole plan | done when `just build && harness checks` exits 0 with the new tests present | EXISTS |
| AC-07 | done when `reconstruction.test.ts` passes with `artifact` in EVENT_KINDS | EXISTS |

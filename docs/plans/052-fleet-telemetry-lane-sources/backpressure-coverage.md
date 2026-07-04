# Backpressure Coverage — fleet telemetry lane sources (052)

**Spec**: [fleet-telemetry-lane-sources-plan.md](./fleet-telemetry-lane-sources-plan.md) § Business Specification
**Generated**: 2026-07-04
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores. (Advisory backpressure survey.)

## Existing Sensors (inventory)

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| full sensor gate | `harness checks` (typecheck→lint→test→smoke→pkg-audit→snapshots) | behaviour + maintainability | root |
| telemetry unit suite | `cd harness/cli && npx vitest run test/services/telemetry/` | behaviour | `harness/cli/` (60+ files incl. `artifact-semantics.test.ts`, `fleet-evidence.test.ts`, `copilot-adapter.test.ts`) |
| closed-schema validation | ajv against `fleet-export.schema.json` etc. (`additionalProperties:false`) + existing negative-key test pattern | data/contract | `harness/cli/src/services/telemetry/*.schema.json` |
| scrubbed fixture corpus + privacy scan | `fixture-privacy-scan.test.ts`, `test/services/telemetry/fixtures/` | data/privacy | `harness/cli/test/` |
| lint/format | `just fix` → biome (CI gates on `biome check`) | maintainability | root + `.github/workflows/ci.yml` |
| CI PR gate | `.github/workflows/ci.yml` (rename-guard, build-test 22/24, package-smoke) | behaviour | `.github/` |

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail |
|---|---|---|---|---|
| AC-01 4/4 lanes at exact debrief numbers | golden-number vitest over real 051 scrubbed fixtures (T007) | BUILDABLE | computational | — |
| AC-02 malformed side-channel → `cost_measured:false`, never crash | negative fixtures per reader (T003/T004) | BUILDABLE | computational | — |
| AC-03 counts-only export, closed schema | existing ajv negative-key pattern extended to new fields | EXISTS (pattern) / BUILDABLE (new fields) | computational | — |
| AC-04 packet classifies NOT-review; real review still FIX_REQUIRED | `artifact-semantics.test.ts` + new real-packet fixtures (T002) | BUILDABLE | computational | — |
| AC-05 F-07 root cause documented | execution-log record; the *fix* (if small) gets a copilot-adapter test | ABSENT (the diagnosis itself) / BUILDABLE (the fix) | inferential → computational | diagnosis is investigation by nature; existing `copilot-adapter.test.ts` + real ref 34524328 are the evidence base |
| AC-06 ref-resident lanes appear with `source:"ref"` | `fleet-evidence.test.ts` extension with a ref-shaped fixture (T005) | BUILDABLE | computational | — |
| AC-07 rollup reproduces debrief §05 counts; blind lanes `semantics_measured:false` | golden reconcile test vs committed 051 evidence (T009–T011) | BUILDABLE | computational | — |
| AC-08 lane-source matrix exists in docs | file-existence + review; no content sensor | ABSENT | human-judgement | docs prose isn't machine-provable; globbed `docs/how/telemetry.md` — exists, extended by T008 |
| Vendor format drift (risk) | negative-shape fixtures degrade to unmeasured (AC-02 sensor) | BUILDABLE | computational | — |
| Privacy leak via side-channel prose (risk) | `fixture-privacy-scan.test.ts` pattern applied to new fixtures | EXISTS (pattern) | computational | — |

## Certainty: Partial

Every behaviour/architecture AC is BUILDABLE within plan scope (the readers and their golden tests ARE the deliverables); the two non-computational rows (F-07 diagnosis, docs prose) are legitimately inferential/human. No Phase 0 needed — the sensors land inside P1/P2 tasks themselves.

## Suggested "done when" lines (advisory)

| For criterion | Suggested line | Backed by |
|---|---|---|
| AC-01 | done when the T007 golden test pins 1,742.9 AIC / 298.5 AIC / 1,368,083 / live and `harness checks` is green | BUILDABLE |
| AC-04 | done when packet fixtures assert non-review AND the real review fixture still yields FIX_REQUIRED `{critical:1}` | BUILDABLE |

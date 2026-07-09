# Backpressure Coverage — dont-apologise-fix

**Spec**: [dont-apologise-fix-plan.md](./dont-apologise-fix-plan.md) (unified plan — ACs in `### Acceptance Criteria`)
**Generated**: 2026-07-09
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores.

## Existing Sensors (inventory)

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| Full unit+integration suite (175 files, 2230 tests, run live this session) | `just test` | behaviour | `harness/cli/` |
| Doctrine-parity guard | in suite (`test/services/doctrine-parity/`) | architecture-fitness | `harness/cli/` |
| Retro-template pinning test | in suite (`test/services/record/retro-template.test.ts`) | behaviour (contract) | `harness/cli/` |
| Hexagonal conformance | `npx harness arch-check --json` | architecture-fitness | `.harness/extensions/arch-check/` |
| Lint/format/typecheck | `just fix` · `npm run build` | maintainability | root |
| Docs drift guard | `npm run check:docs` | maintainability | root |
| skills-check | `harness skills-check` | maintainability (skill structure) | `.harness/extensions/` |
| flow-eval runner (two-axis scorer) | `harness flow-eval` | behaviour (flow conformance) | `.harness/extensions/flow-eval/` |
| Health/doctor | `harness doctor --json` | behaviour | CLI core |
| CI (build-test + package-smoke) | `.github/workflows/ci.yml` | all | root |

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail |
|--------------------------|----------------------|--------|------|-------------|
| AC-01/AC-07 directive present, codes purged (prose presence) | T017 grep assertions | BUILDABLE | computational | — |
| AC-02 posture line reaches orient (phase-1 AND expander observe-2) | create+orient fixture (T017) | BUILDABLE | computational | — |
| AC-03 narrowed rule consistent across 4 sites | four-site grep (T017) + parity guard (EXISTS, covers the shared block only) | BUILDABLE | computational | — |
| AC-04 dispositions incl. declined in record | T001/T002 vitest + T014 scenario assertion | BUILDABLE | computational | — |
| AC-05 telemetry wire path + privacy negatives | T003 round-trip + negative snapshot tests | BUILDABLE | computational | — |
| AC-06 insight generators LLM-free | T005 vitest over cohort fixture | BUILDABLE | computational | — |
| AC-08 drain reads as recommendation-led conversation | — (prose quality) | ABSENT | inferential / human-judgement | not sensor-provable by design; flow-eval judged fields + human review carry it (matches repo's declared gap: "skill prose has no deterministic sensor") |
| AC-09 planted-friction scenario green | flow-eval runner EXISTS; scenario itself | BUILDABLE | computational | — |
| AC-10 runbook queries execute + baselines | running the runbook (T015) | BUILDABLE | computational | — |
| AC-11 net-new prose ≤ ~40 lines | diff line count (T017) | BUILDABLE | computational | — |
| FM: parity-block one-sided edit | doctrine-parity test | EXISTS | computational | — |
| FM: schema-mirror drift (events ↔ segment.schema) | suite schema tests (pattern EXISTS); new-key mirror assertions | BUILDABLE | computational | — |

## Certainty: Partial

Every behaviour/architecture criterion is computationally provable, but most sensors are BUILDABLE within the plan's own tasks rather than EXISTS today; the two standing guards (parity, suite) already cover the riskiest failure modes → Partial.

## Recommended Phase 0: Establish Backpressure

Not needed as a separate phase — **every BUILDABLE sensor above is already a plan task** (T001–T005 tests, T014 scenario, T017 sweep). Building them in-line IS this plan's Phase 0; a separate table would duplicate the task list.

## Suggested "done when" lines (advisory)

| For criterion | Suggested line | Backed by |
|---------------|----------------|-----------|
| AC-08 (the one ABSENT row) | done when the flow-eval scenario's judged drain-format fields are reviewed by a human alongside the scored markers | thin — inferential by design |

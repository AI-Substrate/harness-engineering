# Backpressure Coverage — harness retro insights (058)

**Spec**: [harness-retro-insights-plan.md](./harness-retro-insights-plan.md) (unified plan — Business Specification half)
**Generated**: 2026-07-12
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores. (Advisory backpressure survey.)

## Existing Sensors (inventory)

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| Unit+integration suite (vitest+coverage) | `just test` | behaviour | root justfile → `harness/cli` |
| Composite quality gate | `harness checks` | behaviour+maintainability | `.harness/extensions/checks/` |
| Architecture tests (single exit site, no `node:fs` in services) | in `just test` (`test/architecture/`) | architecture-fitness | `harness/cli/test/` |
| Hexagonal conformance | `harness arch-check` | architecture-fitness | `.dependency-cruiser.cjs` + extension |
| Lint/format | `just fix` (biome) | maintainability | root |
| Type build | `npm run build` (tsc) | maintainability | root |
| Docs drift guard | `npm run check:docs` | behaviour (docs) | `scripts/gen-docs.mjs` |
| Skill frontmatter validity | `harness skills-check` | behaviour (skills) | `.harness/extensions/skills-check/` |
| Doctrine parity guard | `check:doctrine-parity` (warn-launch) | behaviour (doctrine) | `scripts/doctrine-parity.mjs` |
| CI (build-test + package-smoke) | `.github/workflows/ci.yml` | all | root |

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail |
|--------------------------|----------------------|--------|------|-------------|
| AC-01 envelope + `members[]` provenance | new engine/act vitest suites (tasks 1.4–1.6) | BUILDABLE | computational | — |
| AC-02 scope filters + legacy paths | new reader/act suites (1.2, 1.6) | BUILDABLE | computational | — |
| AC-03 determinism (byte-identical minus `generated_at`) | dedicated determinism test (1.4) | BUILDABLE | computational | — |
| AC-04 tolerant parsing, skip counters | reader suite + live-corpus run (1.2, 1.8) | BUILDABLE | computational | — |
| AC-05 ranking + two-signal leverage | engine suite (1.4) | BUILDABLE | computational | — |
| AC-06 `repeatedly_deferred` | engine suite w/ deferred-streak fixture (1.1, 1.4) | BUILDABLE | computational | — |
| AC-07 read-only (no writes, status untouched) | act suite asserting zero `fs.writeText` (1.6) | BUILDABLE | computational | — |
| AC-08 buffer advisory never merged | act suite (1.6) | BUILDABLE | computational | — |
| AC-09 harvest consumes verb; view/ops preserved | grep assertions + `skills-check` (2.1) | BUILDABLE | computational | — |
| AC-09b "narration restates, never computes" at runtime | — (future flow-eval scenario could probe it) | ABSENT | inferential | agent-runtime behaviour; no static check can prove a future narration — globbed `live-testing/scenarios/*` for an existing retro-insights scenario: no match |
| AC-10 router additive; frozen sections byte-unchanged | grep assertions on hook/manifest sections (2.3) | BUILDABLE | computational | — |
| AC-11 no dangling compound-value refs | `grep -r "compound-value" skills/` (2.2) | BUILDABLE | computational | — |
| AC-12 docs discoverable | `check:docs` + `skills-check` | EXISTS | computational | — |
| New code obeys hexagonal boundaries (G3) | `harness arch-check` + architecture tests | EXISTS | computational | — |

## Certainty: Partial

12 of 14 behaviour/architecture rows are BUILDABLE sensors the plan itself builds test-first (tasks 1.2/1.4 write the failing suites before implementation); 2 are EXISTS today; the single ABSENT row (runtime narration discipline) is legitimately inferential → Partial.

## Recommended Phase 0: Establish Backpressure

No separate Phase 0 is needed: **the plan's TDD ordering already IS the Phase 0** — tasks 1.2 and 1.4 build the failing sensors (reader + engine suites) before any implementation lands, which is exactly what a Phase 0 would prescribe. Listed for the record:

| Sensor to build | Proves | Suggested form |
|-----------------|--------|----------------|
| reader suite (task 1.2) | AC-02, AC-04 | vitest, FakeFs fixture corpus |
| engine suite (task 1.4) | AC-01, AC-03, AC-05, AC-06 | vitest, hand-built inputs |
| act suite (task 1.6) | AC-01, AC-07, AC-08 | vitest, FakeFs |
| grep assertion set (tasks 2.1–2.3) | AC-09, AC-10, AC-11 | shell one-liners recorded in execution log |

## Suggested "done when" lines (advisory)

| For criterion | Suggested line | Backed by |
|---------------|----------------|-----------|
| AC-09b narration discipline | done when a flow-eval scenario scores a harvest run and the judged lane confirms every narrated number appears in the verb's JSON | thin — needs follow-up (a `live-testing/scenarios/retro-insights` scenario; natural post-ship candidate) |

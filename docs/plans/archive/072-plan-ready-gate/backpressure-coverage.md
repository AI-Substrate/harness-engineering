# Backpressure Coverage — Plan Readiness Gate (`harness plan ready`)

**Plan**: [plan-ready-gate-plan.md](./plan-ready-gate-plan.md)
**Basis (plan SHA-256)**: `3fad7869fc9b2340fc4926004aaebe69024e1cf44a0ec1a30bdcf265a322c275`
**Generated**: 2026-08-05
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores. (Advisory backpressure survey.)
> Selection, not enforcement: nothing here executes at phase end — the proof lines
> below are what the plan's owner folds into each criterion's "done when".

## Existing Sensors (inventory)

| Sensor | Paved command | Dimension | Found in |
|--------|---------------|-----------|----------|
| Unit + integration suite (vitest) | `just test` | behaviour | root recipe → `harness/cli/vitest.config.ts` |
| Mandated quality gate | `harness checks` | behaviour + maintainability | core verb (composes tests/biome/typecheck/docs) |
| Architecture tests | (in suite) `harness/cli/test/architecture/` | architecture-fitness | `harness/cli/test/architecture/` — incl. `dd-core-isolation.test.ts` |
| Hexagonal conformance | `npx harness arch-check --json` | architecture-fitness | `.dependency-cruiser.cjs` (7 committed rules; warn-launch) |
| Lint/format | `just fix` | maintainability | root `justfile` |
| Type build | `npm run build` | maintainability | root |
| Docs drift guard | `npm run check:docs` | maintainability | root |
| CI | `.github/workflows/ci.yml` | behaviour (PR gate) | root |

## Coverage Matrix

| Criterion / failure mode | Phase | Selected proof | Status | Tier | Probe trail |
|--------------------------|-------|----------------|--------|------|-------------|
| AC-01 ready verdict + exit 0 | 1 | EXTEND→RUN: add the happy-path case to `test/services/dd/plan/ready.test.ts`; then `just test` | EXTEND | computational | — |
| AC-02 unclaimed criteria named by address | 1 | EXTEND→RUN: add the unclaimed-criterion case; then `just test` | EXTEND | computational | — |
| **AC-03 zero criteria → can't-tell, never ready** | 1 | EXTEND→RUN: commit the empty-scaffold fixture (T005) and assert NOT ready; then `just test` | EXTEND | computational | — |
| AC-04 decline + receipt reads satisfied | 1 | EXTEND→RUN: fixture flight plan, chore `skipped` + decision comment; then `just test` | EXTEND | computational | — |
| AC-05 skipped without receipt reads unsatisfied | 1 | EXTEND→RUN: same fixture minus the comment; then `just test` | EXTEND | computational | — |
| AC-06 no flight plan → can't-tell | 1 | EXTEND→RUN: fixture with plan document only; then `just test` | EXTEND | computational | — |
| AC-07 `--strict` exit polarity | 1 | EXTEND→RUN: assert the exit code both ways; then `just test` | EXTEND | computational | — |
| AC-08 read-only (no writes) | 1 | EXTEND→RUN: byte-compare fixture before/after **with a positive control** proving the before-state is non-trivial; then `just test` | EXTEND | computational | — |
| **Failure mode: `semantics.ts` gets modified** (finding 03 — per-AC pressure coverage creeps in) | 1 | EXTEND→RUN: architecture-style guard test asserting `services/dd/plan/semantics.ts` is byte-unchanged against a committed digest; then `just test` | EXTEND | computational | — |
| **Failure mode: the vacuity guard is never proven against bad input** | 1 | BUILD→RUN: none available — this is the T005-ordering discipline (fixture must FAIL pre-guard), which no sensor enforces; the execution log records the observed failure | ABSENT | inferential | globbed `**/vitest.*.config.*`, `**/*.spec.*`, `harness/cli/test/architecture/**`, `.dependency-cruiser.cjs` across root + `harness/cli` — nothing enforces "this test failed before that commit" |
| Docs land and stay in sync (T009) | 1 | RUN: `npm run check:docs` | EXISTS | computational | — |

## Proof Plan (selected)

### Phase 1: Implementation

| Proves | Mode | Proof line |
|--------|------|------------|
| AC-01…AC-08 | EXTEND→RUN | add the eight cases to `test/services/dd/plan/ready.test.ts`; then `just test` |
| `semantics.ts` stays unmodified (finding 03) | EXTEND→RUN | add a digest guard beside `test/architecture/dd-core-isolation.test.ts`; then `just test` |
| Docs in sync | RUN | `npm run check:docs` |
| Whole-gate green | RUN | `harness checks` |

## Certainty: Partial

Counts (behaviour/architecture rows): **1 RUN · 9 EXTEND · 0 BUILD · 1 ABSENT**
Recommended next move (per-task lookup, advisory): **propose the extension(s) first — the cheapest move, landing in a proven home.**

Every behaviour criterion is provable by adding cases to a suite that already exists and already runs in CI — no new sensor, no new command. The single `ABSENT` row is not about the feature's behaviour but about the *discipline* of proving the vacuity guard against pre-guard code, which no repo sensor can enforce.

## Recommended Phase 0: Establish Backpressure (build or extend)

| Sensor to build/extend | Proves | Suggested form | Paved command it strengthens/exposes |
|------------------------|--------|----------------|--------------------------------------|
| extend the vitest suite | AC-01…AC-08 | new spec file `test/services/dd/plan/ready.test.ts` with the eight cases + the empty-scaffold fixture | `just test` (same command, stronger) |
| extend the architecture tests | `semantics.ts` remains a read-only dependency (finding 03) | digest/byte guard beside `dd-core-isolation.test.ts` | `just test` (same command, stronger) |

## Closing Verdict

Here is how we will know this is actually done, in plain terms.

The command we are building answers one question — *is this plan ready to start work?* — and almost everything it promises can be checked by machine. The repo already has the checker: one test suite, already wired into CI, already run by habit. Nothing new has to be invented. Every promise in this plan becomes provable by adding cases to that suite and running the command everyone already runs.

**One thing I already did, automatically:** I wrote the how-to-prove-it commands into this file, next to the plan, so whoever picks this up later can see exactly which command proves which promise — even after this conversation is gone.

**One thing I'd like your OK on:** teaching that existing suite two new things. First, the eight behaviour cases. Second — and this is the one that matters — a guard that the file holding the existing plan-checking rules is never quietly edited by this work. That file deliberately leaves backpressure out of its calculations, and the easiest way for this feature to go wrong is to "helpfully" change that. A guard makes the mistake impossible rather than merely discouraged. Same command, made smarter.

There is one promise no command can keep for us, and I want to name it rather than bury it. The whole point of this feature is refusing to call an empty plan ready — and the way we prove that guard works is to write the test *first*, watch it fail against the code that lacks the guard, and only then build the guard. Nothing in this repo can enforce that ordering. If someone writes the guard first and the test second, the test passes on the day it is written and we learn nothing. That stays a human discipline, recorded in the execution log.

And if the checks ever pass while a person looks at the result and says it is not ready — the checks are wrong, and we fix the checks first, then the code. That way the same miss can never slip through twice.

**In summary:** the commands will prove all eight acceptance criteria and that the existing rules file stays untouched, using the test suite and CI that already exist. What stays human is the ordering discipline — writing the empty-plan test before the guard it proves, and observing it fail. The recommended next move for this task is to propose the extensions first, since they land in a proven home. What I would like your OK on is adding those two extensions to the existing suite as part of Phase 1.

# Backpressure Coverage — dd consume-upgrade

**Plan**: [plan.dd.json](../plan.dd.json) (dd-native)
**Basis (plan SHA-256)**: b37369d36f1646a9b06dd45054d5fcaa358d4e2a19c8cab6795850386c8d6834
**Generated**: 2026-08-09
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores.
> Selection, not enforcement — the proof lines are what the tasks stage folds into
> each task's `done_when`, with `pressure` links to the dd rows.
>
> **This survey's row data is dd-native**: [backpressure.dd.json](./backpressure.dd.json)
> (`#rows`, ids `bp-0001..bp-000e`) — authored so `done_when[].pressure` can link real
> rows instead of the literal `not-applicable`. The plan's `meta.backpressure` now
> links there. This file is the human survey narrative over those rows.

## Existing Sensors (inventory — filesystem-grounded, root + harness/cli probed)

| Sensor | Paved command | Dimension | Found in |
|--------|---------------|-----------|----------|
| typecheck+build | `just build` | maintainability | root justfile |
| vitest suite (incl. 6-file architecture suite) | `just test` | behaviour + architecture | root → harness/cli vitest |
| **semantics byte-pin** (`FROZEN_DIGEST`) | `just test` (dd-plan-semantics-frozen.test.ts) | architecture-fitness | harness/cli/test/architecture |
| biome fix/format | `just fix` | maintainability | root |
| markdown lint | `just lint-md` | maintainability | root |
| windows-path family check | `just windows-check` | behaviour | root |
| dd plan validate (dogfood) | `node harness/cli/bin/harness.js plan validate <plan>` | behaviour | harness CLI in-tree |
| CI (build+biome+tests+coverage+audit) | `.github/workflows/ci.yml` | all (PR gate) | .github |

No live sensor daemon (`harness sensors --json` → degraded, none registered) — the paved
recipes above are the working sensor set. Governance doc corroborates; filesystem won.

## Coverage Matrix

Full matrix lives in [backpressure.dd.json#rows](./backpressure.dd.json) — summary by mode:

| Mode | Rows | Which |
|------|------|-------|
| RUN (EXISTS) | 7 | bp-0001 dep pin · bp-0002 import sweep · bp-0003 build+test · bp-0007 deletion grep-zero · bp-0009 docs exist+lint · bp-000a guard-site comments · bp-000b dogfood pair |
| EXTEND→RUN | 3 | bp-0008 doctor dd-absent unit case · bp-000d falsifier tests + deliberate FROZEN_DIGEST update · bp-000e promote the POC probe trio into a vitest integration spec |
| BUILD→RUN | 1 | bp-0006 fork-drain check script (`scripts/dd-drain-check`) |
| ABSENT (honest) | 3 | bp-0004 prediction-ordering (evidentiary, review reads git log) · bp-0005 cross-repo verdict delivery · bp-000c ledger judgement (assist: `grep -c OPEN` = 0) |

Probe trails for the ABSENT rows are recorded on the rows themselves.

## Proof Plan (selected)

### Phase 1 (ph-1d68)
| Proves | Mode | Proof line |
|--------|------|------------|
| ac-0001 | RUN | `(cd harness/cli && npm ls @ai-substrate/dd)` shows `git+…#<full sha>` |
| ac-0003 | RUN | `just build && just test` |
| ac-000b | RUN | `node harness/cli/bin/harness.js flow orient --path docs/plans/080-dd-consume-upgrade/the-flow.json && node harness/cli/bin/harness.js plan validate docs/plans/080-dd-consume-upgrade/plan.dd.json` |
| D7/A-2 re-pin class | EXTEND→RUN | promote POC probe trio → vitest integration spec; then `just test` |

### Phase 2 (ph-1633)
| Proves | Mode | Proof line |
|--------|------|------------|
| ac-0002 | RUN | `git grep -n "services/dd\|acts/dd" -- <the 4 files>` → zero |
| semantics drift | EXTEND→RUN | falsifier test per primitive **before** implementation; FROZEN_DIGEST updated deliberately; then `just test` |
| ac-0004 / ac-0005 | — | human review (report + git-log order; pij receipt) — no fake proof line |

### Phase 3 (ph-08e2)
| Proves | Mode | Proof line |
|--------|------|------------|
| ac-0006 | BUILD→RUN | build `scripts/dd-drain-check.mjs`; then run it green |
| ac-0007 | RUN | `test ! -d …/services/dd && test ! -d …/acts/dd && git grep …` → zero |
| ac-0008 | EXTEND→RUN | doctor unit case (dd-CLI-absent via fake process port); then `just test` |
| ac-0009 | RUN | `test -f docs/how/consuming-dd.md && just lint-md` |
| ac-000a | RUN | `git grep -l "D-4"` over the two guard files |
| ac-000c | — | human ledger review (assist: `grep -c OPEN assets/dogfood-ledger.md` → 0) |

## Certainty: Partial

Counts (behaviour/architecture rows): **7 RUN · 3 EXTEND · 1 BUILD · 3 ABSENT**
Recommended next move (per-task lookup): the EXTEND gaps land as named tasks inside their
phases (the falsifier tests ARE phase 2's TDD mandate; the probe-trio promotion is a
phase-1 task; the doctor case a phase-3 task) — **no separate Phase 0 needed**: every
gap already has a scheduled home in this plan.

Rationale: every machine-checkable criterion has a selected proof; the three ABSENT rows
are genuinely evidentiary/human (trial-report ordering, cross-repo delivery, ledger
judgement) and are routed to review with named evidence, not left to inference.

## Recommended Phase 0: Establish Backpressure

Routing trigger fires (1 BUILD + 3 EXTEND) but **all four gaps are already scheduled
inside the plan's own phases** (see Proof Plan) — a separate Phase 0 would duplicate
them. Table therefore names the in-plan home instead of new work:

| Sensor to build/extend | Proves | Form | Home |
|------------------------|--------|------|------|
| POC probe trio → vitest integration spec | bp-000e re-pin regressions | test spec against installed package | phase 1 task |
| falsifier suite + FROZEN_DIGEST discipline | bp-000d semantics drift | TDD tests + deliberate pin update | phase 2 tasks (testing_strategy mandate) |
| `scripts/dd-drain-check.mjs` | bp-0006 drain checklist | data-check script, shas named | phase 3 task |
| doctor dd-absent unit case | bp-0008 doctor warning | unit test via fake process port | phase 3 task |

## Closing Verdict

How will we know this work is actually done? Most of it, a machine will tell us. One
thing I already did, automatically: I wrote the exact proof command for every promise
into the coverage rows — the dependency pin, the import sweep, the build-and-test bar,
the deletion grep, the dogfood pair — so when those commands pass, those promises are
kept with no judgement calls, and whoever picks this up later sees the commands where
the work lives, even after this conversation is gone.

Four promises need small additions before they're machine-checked, and all four already
have a home in the plan: a test that re-runs our install probes on every re-pin (phase
1), the falsifier tests that phase 2's testing strategy already mandates — plus one
discipline note: the repo deliberately byte-pins the semantics file, so phase 2 must
update that pin on purpose, with the reason in the commit, because the pin exists to
forbid silent edits, not edits — a small drain-check script before anything is deleted
(phase 3), and a doctor test for the missing-dd warning (phase 3). If any check later
passes while a human says the work is wrong, we fix the check first, then the code —
that's how the mistake becomes impossible to repeat.

Three things no command can judge, and I'm naming them rather than pretending: whether
the trial report's prediction genuinely predates the trial (a reviewer reads the git
history), whether dd received our verdict (a message receipt), and whether the
remediation ledger truly closed with no silent workarounds (a human reads the ledger).

**In summary:** the commands will prove the dependency, the rewire, the deletion, and
the dogfood loop end to end; human judgement remains on exactly three evidentiary calls,
each named with its evidence. The recommended next move is to proceed straight to task
expansion — every proof gap already has a scheduled home in a phase, so no Phase 0 is
needed. The one approval I'd like: fold these proof lines into the tasks' done-when
assertions as their `pressure` links when the tasks stage runs — that's the step that
makes this survey binding instead of advisory.

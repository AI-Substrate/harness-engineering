# Code Review: Round-3 trial: plan semantics on public primitives

**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/plan.dd.json`  
**Phase**: Phase 2: Round-3 trial: plan semantics on public primitives  
**Date**: 2026-08-09  
**Reviewer**: Copilot independent reviewer  
**Review scope**: Remediation commits `622f0840` and `4fe34c81` after the round-1 rejection at `294a545b`.

## A) Verdict

**APPROVE**

Both blocking findings are resolved. The canonical acceptance-criterion state now agrees
with the task's genuine `satisfies` relation and with the dogfood evidence; the test oracle
type query now has a real type-only binding that an independent positive/negative typecheck
proves.

## B) Summary

`ac-0002` is now checked, earned by the prior review's 95% full-zero evidence and the
ledger's pre-recorded resolution path. The re-run returns `ok` for `flow orient`, `flow
rail`, and `plan validate`, the latter with zero errors, warnings, and contradictions.
`dw-0014`'s retained checked state is therefore true and records its earlier false state
without concealing it.

The only source rider is the exact sanctioned `persistSibling` documentation correction:
seven comment lines replace five comment lines; no executable code moved. The F002 import is
type-only, and the target integration suite still passes.

## C) Checklist

- [x] F001 canonical state and dogfood receipt agree at `4fe34c81`
- [x] F002 is a real type-only oracle binding, proven by a positive and negative typecheck
- [x] Comment rider exactly matches the supplied packet and is comment-only
- [x] `biome check` is clean for both changed source files and the cited builder-rels file
- [x] The remediation range changes only the two remedies, their generated document
  siblings, and execution evidence
- [x] Original trial evidence remains valid: frozen fork, public boundary, goldens, and
  falsifiers passed in the round-1 review

## D) Findings Table

| Severity | Count | Status |
|----------|------:|--------|
| Critical | 0 | None |
| High | 0 | F001 resolved |
| Medium | 0 | None |
| Low | 0 | F002 resolved |

## E) Resolution Evidence

| Former finding | Resolution | Independent evidence |
|----------------|------------|----------------------|
| F001 HIGH | `ac-0002` is checked in `plan.dd.json`; generated plan and task siblings match; `dw-0014` records the false-then-true arc. | `plan validate` returned `ok`, `error: 0`, `warn: 0`, `contradictions: 0`; `flow orient` and `flow rail` returned `ok`. |
| F002 LOW | `readPlanReadiness as forkReadPlanReadiness` is imported with a type-only specifier from the fork oracle. | The temporary probe typechecked the live test. Its identical negative control at `4fe34c81^` failed at `:99:29` with TS2304 for `forkReadPlanReadiness`. |
| Sanctioned rider | The new `persistSibling` text says rollback is attempted and verified, not guaranteed, and directs callers to `next_action`. | The exact replacement matches `scratch/dd-080-acts-flow-236-rider.md`; diff is 7 additions / 5 deletions, all within the doc comment. |

No public dd symbol was copied and no fenced fork tree moved in the original reviewed
range. The reshape ruling remains correctly applied.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| ac-0002 | Full-zero imports | Original four-survivor grep; checked only after its evidence earned the state. | 100% |
| ac-0003 | Build and suite green | Full suite passed in round 1; the remediation adds a type-only import and a comment, whose target test and direct typecheck pass. | 100% |
| ac-0004 | Dated, falsifiable OQ-2 trial | Original prediction, RED-first falsifiers, literal goldens, and honest 1-7 / 8-9 split. | 95% |
| ac-000b | Phase-boundary dogfood | Re-run at `4fe34c81`: orient, rail, and validate all return `ok`. | 100% |
| ac-000c | No silent workarounds | `dw-0015` remains deliberately unchecked for human-tier ledger judgment. | N/A |

## G) Commands Executed

```bash
git diff --check 294a545b..4fe34c81
git diff --name-status 294a545b..4fe34c81
git diff --unified=60 294a545b..4fe34c81 -- harness/cli/src/acts/flow.ts \
  harness/cli/test/integration/plan-semantics-falsifiers.int.test.ts
node harness/cli/bin/harness.js flow orient --path docs/plans/080-dd-consume-upgrade/the-flow.json
node harness/cli/bin/harness.js flow rail --path docs/plans/080-dd-consume-upgrade/the-flow.json
node harness/cli/bin/harness.js plan validate docs/plans/080-dd-consume-upgrade/plan.dd.json
cd harness/cli && npx vitest run test/integration/plan-semantics-falsifiers.int.test.ts
cd harness/cli && npx biome check src/acts/flow.ts \
  test/integration/plan-semantics-falsifiers.int.test.ts \
  test/services/dd/schema/builder-rels.test.ts
```

The F002 probe used a temporary tsconfig that includes the target test, then a temporary
same-directory copy of its pre-fix parent. The live test passed; the parent copy failed at
`test/integration/.plan-semantics-falsifiers.f002-negative.*.ts:99:29` with TS2304. Both
temporary files were removed after the proof.

## H) Handover Brief

**Review result**: APPROVE  
**Finding counts**: `0/0/0/0` (Critical/High/Medium/Low)  
**Review file**: `docs/plans/080-dd-consume-upgrade/assets/tasks/phase-2/reviews/review.round-3-trial.md`

The round-1 rejection is superseded by this approval. No further Phase 2 remediation is
required from this review.

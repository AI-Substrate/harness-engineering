# Code Review: Fork drain, deletion, and surface cleanup

**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/plan.dd.json`  
**Phase**: Phase 3: Fork drain, deletion, and surface cleanup  
**Date**: 2026-08-09  
**Reviewer**: pij-modern-caribou (independent)  
**Testing approach**: Hybrid

## A) Verdict

**APPROVE**

Round-two remediation at `1e9414b4` resolves both release-facing findings. The consumer
guide now names only the retired `harness dd *` surface as removed, while the live
standalone command validates the plan successfully. The required provenance disclosure
is present in the tracked, committed composed PR body rather than in the generic
criteria-table fragment; that is the correct plan-specific home.

## B) Summary

The original deletion, migration, and goldens controls remain sound. Re-review confirms
the standalone `dd` route returns `status: ok` with zero errors and warnings; the
removed `harness dd` route returns E108. `assets/pr-body.md` is tracked and carries the
criteria fragment, both accepted degradations, the full physical-to-logical deletion
mapping (`7d112d26`, `2b5a07af`, `237ab2e1`, `430f1511`), and the preserved checklist
ancestry proof. The full suite passes: 294 files / 4,493 tests.

## C) Checklist

- [x] Deletion fence, legacy-import, temporal-verb, and golden-conversion controls inspected
- [x] `just build`, final `just test`, typecheck, targeted behavior tests, and `biome ci` run
- [x] Doctor/dd-CLI, plan-new, D-4, command-surface, and complete-plan controls inspected
- [x] Consumer command documentation is internally consistent
- [x] Required deletion-provenance mapping reaches the committed composed PR body
- [x] Domain compliance: N/A (domains off)

## D) Findings Table

No open findings.

## E) Detailed Findings

### E.1) F001 remediated - retired and working CLI surfaces distinguished

`1e9414b4` corrects all three casualties: two statements in
`docs/how/consuming-dd.md` now say `harness dd *` was removed, and
`docs/how/dd/README.md` correctly calls its reference the complete `dd` command family.
The CLI anchor remains stable. Live controls confirm both directions:

```bash
node_modules/.bin/dd validate docs/plans/080-dd-consume-upgrade/plan.dd.json --json
# status: ok; error: 0; warn: 0

node harness/cli/bin/harness.js dd validate docs/plans/080-dd-consume-upgrade/plan.dd.json
# E108
```

### E.2) F002 remediated - provenance reaches a committed composed PR body

`63df292d` adds the tracked `assets/pr-body.md` as the plan's composed PR body. It
includes the generic acceptance-criteria fragment plus both accepted degradations and
the required provenance mapping: 261 deletions in `7d112d26`, two generator scripts in
`2b5a07af`, logical deletion commit `237ab2e1`, the 22/10 split's `430f1511`, and
checklist ancestry `8e9d1ecf -> 7d112d26`.

```bash
node harness/cli/bin/harness.js plan pr-body \
  docs/plans/080-dd-consume-upgrade/plan.dd.json --heading "Acceptance criteria" --json
```

still correctly emits only that reusable criteria-table fragment. Its own `--heading`
composition contract makes a generic, plan-specific disclosure feature the wrong
abstraction and a needless new public surface. The committed composed body is durable:
shipping reads a named, tracked file rather than relying on PM memory, while the generic
renderer retains its documented scope. No history was rewritten.

## F) Coverage Map

| Area | Evidence | Confidence |
| --- | --- | --- |
| Checklist/deletion order | ancestry control; committed checklist and ledger records | High |
| Fork removal and consumer migration | post-build tree absence and repo-wide import grep | High |
| Temporal verb removal | former `harness dd validate` returns E108; standalone `dd validate` returns ok | High |
| Goldens conversion | deletion-range inspection; literal-backed falsifier suite | High |
| Doctor and plan-new riders | targeted tests plus source/control inspection | High |
| Complete plan and dogfood | `flow orient`, `flow rail`, `plan validate --complete` all ok | High |
| Consumer CLI guide | corrected guide plus live working/removed command controls | High |
| Provenance disclosure | tracked composed PR body carries full accepted mapping | High |

## G) Commands Executed

```bash
just build
just test
npx biome ci .
npx tsc --noEmit -p harness/cli/tsconfig.json
node harness/cli/bin/harness.js flow orient --path docs/plans/080-dd-consume-upgrade/the-flow.json
node harness/cli/bin/harness.js flow rail --path docs/plans/080-dd-consume-upgrade/the-flow.json
node harness/cli/bin/harness.js plan validate docs/plans/080-dd-consume-upgrade/plan.dd.json --complete
node_modules/.bin/dd validate docs/plans/080-dd-consume-upgrade/plan.dd.json --json
node harness/cli/bin/harness.js dd validate docs/plans/080-dd-consume-upgrade/plan.dd.json
node harness/cli/bin/harness.js plan pr-body docs/plans/080-dd-consume-upgrade/plan.dd.json --heading "Acceptance criteria" --json
just test
```

## H) Handover Brief

**Review result**: APPROVE
**Review file**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/assets/tasks/phase-3/reviews/review.fork-drain-deletion-cleanup.md`

The Phase 3 deletion cleanup is approved. The committed composed PR body carries the
accepted provenance disclosure without broadening the generic `plan pr-body` fragment.

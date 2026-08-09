# Code Review: Fork drain, deletion, and surface cleanup

**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/plan.dd.json`  
**Phase**: Phase 3: Fork drain, deletion, and surface cleanup  
**Date**: 2026-08-09  
**Reviewer**: pij-modern-caribou (independent)  
**Testing approach**: Hybrid

## A) Verdict

**REJECT**

The deletion and runtime migration are sound, but the new consumer guide contradicts
the shipped command surface twice, and the required deletion-provenance mapping does
not reach the generated PR body.

## B) Summary

The fork trees are absent after `just build`; no legacy relative imports remain in
production or tests apart from explicitly historical/commentary references. The
checklist precedes the physical deletion (`8e9d1ecf` is an ancestor of `7d112d26`), the
22/10 generated-markdown split is represented by `237ab2e1` and `430f1511`, and the
golden/falsifier conversion remains literal-backed. The final plan gate is clean
(`error: 0`, `warn: 0`, `open: 0`, `orphans: 0`, `contradictions: 0`), and the full suite
passed on the final retry (294 files / 4,493 tests). The two findings are release-facing
documentation and disclosure failures, not a reason to revisit the accepted provenance
ruling or the two Jordan-ruled degradations.

## C) Checklist

- [x] Deletion fence, legacy-import, temporal-verb, and golden-conversion controls inspected
- [x] `just build`, final `just test`, typecheck, targeted behavior tests, and `biome ci` run
- [x] Doctor/dd-CLI, plan-new, D-4, command-surface, and complete-plan controls inspected
- [ ] Consumer command documentation is internally consistent
- [ ] Required deletion-provenance mapping reaches generated PR-body output
- [x] Domain compliance: N/A (domains off)

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
| --- | --- | --- | --- | --- | --- |
| F001 | HIGH | `docs/how/consuming-dd.md:8-10,124-127` | correctness/docs | The guide says the working standalone `node_modules/.bin/dd` verb family was removed and that its `validate` command is gone. | Say that **`harness dd *`** was removed; retain `node_modules/.bin/dd <verb>` as the current standalone route. |
| F002 | HIGH | `docs/plans/080-dd-consume-upgrade/assets/dogfood-ledger.md:86-98`; generated `plan pr-body` output | traceability | The accepted physical-to-logical deletion mapping is recorded in the ledger and execution log but is absent from the generated PR body. | Wire a tested provenance/disclosure section into the PR-body source so it names `7d112d26`, `2b5a07af`, and logical commit `237ab2e1`. |

## E) Detailed Findings

### E.1) F001 - standalone CLI described as deleted

The introduction claims Plan 080 removed the "`node_modules/.bin/dd *` verb family" and
that `node_modules/.bin/dd validate` is gone. The CLI section repeats the same false
claim. Both conflict with the next paragraph's own prescription and with the live
control:

```bash
node_modules/.bin/dd validate docs/plans/080-dd-consume-upgrade/plan.dd.json --json
# status: ok; error: 0; warn: 0
```

This reverses the intended migration: a reader is told that the only currently safe,
runnable command no longer exists. Replace both statements with the retired
`harness dd *` surface; no behavior change is needed.

### E.2) F002 - provenance does not reach the PR body

The ruled mapping is correctly present in the ledger: 261 deletions in `7d112d26`, two
scripts in `2b5a07af`, and logical deletion commit `237ab2e1`. The requirement is that
this mapping also reaches the PR body. A direct render:

```bash
node harness/cli/bin/harness.js plan pr-body \
  docs/plans/080-dd-consume-upgrade/plan.dd.json --json
```

produces only the generic acceptance-criteria table. It contains none of those commit
identifiers or the provenance disclosure. Add the disclosure to an input the PR-body
renderer consumes and pin it with a renderer-output test; do not rewrite the accepted
commit history.

## F) Coverage Map

| Area | Evidence | Confidence |
| --- | --- | --- |
| Checklist/deletion order | ancestry control; committed checklist and ledger records | High |
| Fork removal and consumer migration | post-build tree absence and repo-wide import grep | High |
| Temporal verb removal | former `harness dd validate` returns E108; standalone `dd validate` returns ok | High |
| Goldens conversion | deletion-range inspection; literal-backed falsifier suite | High |
| Doctor and plan-new riders | targeted tests plus source/control inspection | High |
| Complete plan and dogfood | `flow orient`, `flow rail`, `plan validate --complete` all ok | High |
| Consumer CLI guide | contradicted by live standalone validation | Blocked by F001 |
| Provenance disclosure | ledger exists; generated PR body omits required mapping | Blocked by F002 |

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
node harness/cli/bin/harness.js plan pr-body docs/plans/080-dd-consume-upgrade/plan.dd.json --json
```

## H) Handover Brief

**Review result**: REJECT  
**Review file**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/assets/tasks/phase-3/reviews/review.fork-drain-deletion-cleanup.md`

Fix F001 by correcting the two mistaken command-surface statements in
`docs/how/consuming-dd.md`. Fix F002 by making the accepted deletion-provenance mapping
a tested part of the generated PR body. Re-run this phase review after both fixes; do not
rewrite commit history or alter the shared unowned ledger edit.

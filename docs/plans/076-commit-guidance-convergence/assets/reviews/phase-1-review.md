# Code Review: Phase 1 - Converge the managed block on the mode union

**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/docs/plans/076-commit-guidance-convergence/plan.dd.md`  
**Spec**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/docs/plans/076-commit-guidance-convergence/plan.dd.md`  
**Phase**: Phase 1: Converge the managed block on the mode union  
**Date**: 2026-08-07  
**Reviewer**: Cross-model reviewer  
**Testing Approach**: TDD / targeted regression evidence

## A) Verdict

**CHANGES**

The new named-pipe entry is correct, but the shared `buffered` outcome still
promises a recovery command to Windows readers for both `file-buffered` and
`harness-buffered`. `telemetry-nudge` refuses unconditionally on win32. This
violates ac-0004's requirement not to claim more than the code delivers and is
the same misleading-recovery defect this plan sets out to remove.

**Key failure areas**:

- **Implementation**: The outcome model folds platform-dependent recovery into
  an unconditional buffered remedy.
- **Contract**: The type guard proves mode-map coverage, not promise correctness;
  the advertised `nudge` datum is not rendered or otherwise enforced.

## B) Summary

The change correctly makes a missing or extra `CommitMode` map key fail
TypeScript, renders the two CLI guidance surfaces from one renderer, preserves
the managed fences, and leaves `commit-service.ts` untouched. The two-level
outcome design is a reasonable way to give the two buffered modes one shared
promise, and removing the instructions page's third enumeration was required
to eliminate local drift. The shared promise is nevertheless false on Windows:
the nudge's win32 guard runs before any replay branch and refuses without
draining a buffer. The phase must distinguish or qualify that recovery before
the outcome contract can be approved.

## C) Checklist

**Testing Approach: TDD / targeted regression evidence**

- [x] Core validation tests present
- [x] Current four-mode totality and both rendered surfaces covered
- [x] Historical managed block migration is non-tautological
- [x] Managed fence and outside-content idempotency covered
- [ ] Windows buffered recovery truthfully represented
- [x] Only in-scope implementation files changed
- [x] `commit-service.ts` has a zero-line diff
- [x] Domain compliance N/A (domains off)

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
| --- | --- | --- | --- | --- | --- |
| F001 | HIGH | `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/harness/cli/src/services/instructions/commit-guidance.ts:58-66` | correctness | The shared buffered remedy directs win32 readers to a nudge that refuses. | Make recovery platform-aware or state that it is unavailable on Windows. |
| F002 | MEDIUM | `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/harness/cli/src/services/instructions/commit-guidance.ts:25-124` | contract | Totality guards map keys only; `nudge` is dead data and a new mode may compile with an incorrect collapsed outcome. | Render/derive nudge advice from structured data, and narrow the stated guarantee to exhaustive declaration. |
| F003 | LOW | `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/docs/how/gitai-collector.md:382-388` | documentation | A separate two-outcome prose summary remains stale and contradicts the four-mode implementation. | Converge it on the CLI guidance or explicitly scope the plan claim to the two CLI surfaces. |
| F004 | LOW | `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/docs/plans/076-commit-guidance-convergence/plan.dd.md` | evidence | The ac-0006 receipt calls the AGENTS diff 11 lines; it is 6 added plus 3 removed. | Correct the evidence count. |

## E) Detailed Findings

### E.1) Implementation Quality

#### F001 - buffered recovery is false on Windows

`COMMIT_OUTCOMES.buffered` says the named recovery command can be run from an
unsandboxed shell. That outcome covers `file-buffered` and `harness-buffered`.
`runNudge()` returns `unsupported-platform` for every win32 host at
`nudge.ts:785-795`, before replay or socket handling. An unconfigured target
also returns `non-af-unix` before that at `nudge.ts:764-770`. Thus an
unsandboxed shell cannot make the prescribed command drain either Windows
buffer. The named-pipe outcome's "Do NOT run" wording is correct, but it does
not repair the two other Windows-reachable modes.

#### F002 - totality is not semantic validation

`as const satisfies Record<CommitMode, CommitOutcomeGuidance>` correctly
requires exactly one map entry for each current mode. It does not make the
entry's `outcome` correct, its `when` truthful, or any prose non-empty:
pointing a future mode at `buffered` compiles. `CommitOutcome.nudge` suggests a
second guard, but `commitOutcomeLines()` renders only `label`, `promise`, and
`remedy`; the nudge value can disagree with rendered prose without a compiler
or test failure. The type-level claim should be limited to exhaustive
declaration unless the outcome data is made executable/derived.

### E.2) Domain Compliance

| Check | Status | Details |
| --- | --- | --- |
| File placement | N/A | Domains are off for this repository. |
| Contract-only imports | N/A | Domains are off for this repository. |
| Dependency direction | N/A | Domains are off for this repository. |
| Domain.md updated | N/A | Domains are off for this repository. |
| Registry current | N/A | Domains are off for this repository. |
| No orphan files | N/A | Domains are off for this repository. |
| Map nodes current | N/A | Domains are off for this repository. |
| Map edges current | N/A | Domains are off for this repository. |
| No circular business deps | N/A | Domains are off for this repository. |
| Concepts documented | N/A | Domains are off for this repository. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
| --- | --- | --- | --- |
| Commit outcome renderer | No duplicate implementation found | instructions | Proceed after F001/F002. |

### E.4) Testing & Evidence

**Coverage confidence**: 85%

| AC | Confidence | Evidence |
| --- | --- | --- |
| ac-0001 | 95% | Named-pipe outcome is rendered and says not to run the nudge. |
| ac-0002 | 85% | Fifth-mode totality is proven; semantic promise correctness is not. |
| ac-0003 | 100% | Both CLI surfaces invoke one renderer; tests iterate outcome text. |
| ac-0004 | 40% | Current shared buffered recovery is false for Windows buffered modes. |
| ac-0005 | 100% | Historical fixture reads stale and doctor remains non-mutating. |
| ac-0006 | 100% | Current block is fresh; all changed lines are inside the managed region. |
| ac-0007 | 100% | Marker literals and outside-content idempotency are tested. |

### E.5) Doctrine Compliance

The two-level design is appropriate: it makes the buffered collapse explicit and
prevents duplicated buffered prose. Removing the instructions page's additional
enumeration is in scope because ac-0003 forbids independently maintained outcome
lists. However, `docs/how/gitai-collector.md:382-388` retains a stale
two-outcome enumeration, so the broad claim that no hand-maintained copy remains
is not currently true.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
| --- | --- | --- | --- |
| ac-0001 | Named-pipe guidance | Rendered outcome and nudge refusal path match. | 95% |
| ac-0002 | Exhaustive mode contract | `satisfies Record<CommitMode, ...>` rejects missing/extra mode keys. | 85% |
| ac-0003 | Shared renderer | Both surfaces interpolate `commitOutcomeLines()`. | 100% |
| ac-0004 | Honest vocabulary | Buffered wording overclaims Windows replay. | 40% |
| ac-0005 | Graceful migration | Verbatim pre-075 fixture becomes stale. | 100% |
| ac-0006 | Repository block refresh | Fence-contained AGENTS diff and doctor OK. | 100% |
| ac-0007 | Structural idempotency | Head/tail preservation and second-run unchanged test. | 100% |

**Overall coverage confidence**: 85%

## G) Commands Executed

```bash
git --no-pager show --format=fuller --stat 8a856921
git --no-pager diff 8a856921^ 8a856921 -- AGENTS.md harness/cli/src/services/instructions/commit-guidance.ts
git diff --quiet 8a856921 -- harness/cli/src/services/commit/commit-service.ts
git diff --check 8a856921^ 8a856921
npx tsc --noEmit -p harness/cli/tsconfig.json
node harness/cli/bin/harness.js doctor
```

## H) Handover Brief

**Review result**: CHANGES

**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/docs/plans/076-commit-guidance-convergence/plan.dd.md`  
**Spec**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/docs/plans/076-commit-guidance-convergence/plan.dd.md`  
**Phase**: Phase 1: Converge the managed block on the mode union  
**Tasks dossier**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/docs/plans/076-commit-guidance-convergence/assets/tasks/phase-1/tasks.dd.md`  
**Execution log**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/docs/plans/076-commit-guidance-convergence/assets/tasks/phase-1/execution.log.md`  
**Review file**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/docs/plans/076-commit-guidance-convergence/assets/reviews/phase-1-review.md`

### Files Reviewed

| File | Status | Domain | Action Needed |
| --- | --- | --- | --- |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/harness/cli/src/services/instructions/commit-guidance.ts` | Changes requested | instructions | Make buffered recovery honest on win32 and make the nudge contract enforceable or narrower. |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/harness/cli/src/services/doctor/collector/nudge.ts` | Read-only evidence | collector | No behavior change requested. |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/AGENTS.md` | Correct | agent guidance | No action until renderer fix is regenerated. |

### Required Fixes

| # | File | What To Fix | Why |
| --- | --- | --- | --- |
| 1 | `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/harness/cli/src/services/instructions/commit-guidance.ts` | Qualify or split buffered recovery so Windows readers are not sent to a nudge that refuses. | Satisfy ac-0004 and prevent the same misleading-recovery defect. |
| 2 | `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/harness/cli/src/services/instructions/commit-guidance.ts` | Make nudge disposition drive rendered text, or remove the unused field and narrow its documented guarantee. | Avoid a guard-shaped but unenforced promise contract. |

### Domain Artifacts to Update

| File | What's Missing |
| --- | --- |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/docs/how/gitai-collector.md` | Optional follow-up: stale two-outcome prose remains outside the two CLI surfaces. |

### Handback

Fixes go back through the implement verb, then re-run this review.

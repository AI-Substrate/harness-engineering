# Fix Tasks: Phase 1 - Converge the managed block on the mode union

Apply in order, then re-run the review.

## Critical / High Fixes

### FT-001: Make buffered recovery truthful on Windows

- **Severity**: HIGH
- **File**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/harness/cli/src/services/instructions/commit-guidance.ts`
- **Issue**: The shared buffered outcome says to run `telemetry-nudge` from an
  unsandboxed shell, but `runNudge()` refuses on every win32 host.
- **Fix**: Derive or qualify the buffered remedy with the POSIX/replay
  prerequisite, and add coverage for Windows `file-buffered` and
  `harness-buffered` guidance.

## Medium / Low Fixes

### FT-002: Make the nudge datum enforceable

- **Severity**: MEDIUM
- **File**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/harness/cli/src/services/instructions/commit-guidance.ts`
- **Issue**: `nudge` is not consumed by the renderer and may disagree with
  remedy prose.
- **Fix**: Render the nudge instruction from the structured disposition or
  remove the unused datum and narrow the claim to map-key totality.

### FT-003: Correct the AGENTS diff evidence count

- **Severity**: LOW
- **Files**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/docs/plans/076-commit-guidance-convergence/plan.dd.md`,
  `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block/docs/plans/076-commit-guidance-convergence/assets/tasks/phase-1/execution.log.md`
- **Issue**: The receipt says 11 changed AGENTS lines; the diff is 6 additions
  and 3 removals.
- **Fix**: Correct the count while preserving the true fence-scope evidence.

## Re-Review Checklist

- [ ] Windows buffered recovery is not presented as replayable.
- [ ] Nudge disposition and rendered remedy cannot disagree.
- [ ] Regenerate and inspect the managed AGENTS block.
- [ ] Re-run this review with no HIGH findings.

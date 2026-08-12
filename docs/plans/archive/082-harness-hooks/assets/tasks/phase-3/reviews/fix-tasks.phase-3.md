# Fix Tasks: Phase 3 - Doctor installs hooks alongside git-ai

Apply in order, then re-run the Phase 3 review.

## Critical / High Fixes

### FT-001: Do not claim install success without durable provenance

- **Severity**: HIGH
- **Files**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/harness/cli/src/services/hooks/hooks-verbs.ts`, `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/harness/cli/test/services/hooks/verbs-e2e.int.test.ts`
- **Issue**: `recordInstall()` returns `false` on a state-store write failure, but `installHooks()` discards it after mutating the config.
- **Fix**: Surface the agent as failed and compensate the just-written hook entries with the in-memory install outcomes, or otherwise guarantee durable provenance before success is reported. Test with `~/.harness` occupied by a regular file through the real binary and assert the original absent config state remains absent.

### FT-002: Prove provenance remains merged across repeated installs

- **Severity**: HIGH
- **Files**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/harness/cli/test/services/hooks/verbs-e2e.int.test.ts`
- **Issue**: The current test proves the second install does not change config bytes, but not that it preserves first-install `createdFile` and `createdKeys` provenance for later recovery.
- **Fix**: Add real-bin `install -> install -> uninstall` rows for an initially absent config and for a pre-existing config lacking event keys. Assert deletion in the first case and removal of only installer-created keys in the second.

## Re-review Checklist

- [x] A failed install-record write cannot leave a success-shaped mutated config. (probe refuses before any write; compensation undoes a post-probe failure; M2+M3+M5 RED)
- [x] Repeated install retains created-file provenance through uninstall. (real bin, 3 processes; M1 RED)
- [x] Repeated install retains created-key provenance through uninstall. (real bin; parse-equal, whitespace-only residue stated)
- [x] Targeted Phase 3 real-bin tests pass. (389 tests, HARNESS_TEST_SCOPE=all; harness checks at standing baseline)

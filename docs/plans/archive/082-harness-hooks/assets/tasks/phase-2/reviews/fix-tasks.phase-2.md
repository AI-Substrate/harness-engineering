# Fix Tasks: Phase 2 - Hook installer and operator verbs

## Critical / High Fixes

### FT-001: Wire the delivered uninstall verb

- **Severity**: HIGH
- **File**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/harness/cli/src/acts/hooks.ts`
- **Issue**: The operator-facing `uninstall` subcommand is absent.
- **Fix**: Add a verb that invokes the supported-strategy uninstall flow and reports
  unsupported strategies explicitly. Add real-bin e2e coverage.

### FT-002: Prove failed fires through `status --json`

- **Severity**: HIGH
- **File**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/harness/cli/test/services/hooks/verbs-e2e.int.test.ts`
- **Issue**: The delivered status envelope can discard failure data undetected.
- **Fix**: Create a real failed journal entry through the hook runtime, invoke the
  real status command, and assert `fires.failed` and the recorded cause.

### FT-003: Preserve user-created empty event arrays

- **Severity**: HIGH
- **File**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/harness/cli/src/services/hooks/uninstall-strategy-a.ts`
- **Issue**: Uninstall deletes an empty event-array key without knowing whether
  install created it.
- **Fix**: Persist or otherwise derive per-install creation provenance, then delete
  only keys created by the install. Update the existing over-reach test to require
  preserving pre-existing empty arrays.

## Re-Review Checklist

- [ ] `harness hooks uninstall --json` works through the real binary
- [ ] A failed fire is visible through the real status payload
- [ ] Pre-existing empty event arrays survive install then uninstall
- [ ] Re-run the Phase 2 cross-model review

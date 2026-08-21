# Code Review: Phase 2 - Hook installer and operator verbs

**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/docs/plans/082-harness-hooks/plan.dd.json`  
**Phase**: Phase 2  
**Date**: 2026-08-10  
**Reviewer**: Cross-model review (`pij-causal-sturgeon`)  
**Testing approach**: Hybrid

## A) Verdict

**REQUEST_CHANGES (FIX_REQUIRED)**

The delivered CLI has no `harness hooks uninstall` subcommand, and Dim-0 found
that the failed-fire compensating control can be removed from the delivered
`status` payload without failing any Phase 2 target test.

## B) Summary

**CONFIRMED:** `uninstallStrategyA()` exists only as a service function and is
never registered by `registerHooksAct()`. The exact Phase 2 binary answers
`unknown command 'uninstall'`.

**CONFIRMED:** replacing the `fires: fireSummary(d)` mapping in the `status`
command with a constant healthy summary left all 71 targeted Phase 2 tests
green. The test that creates a real failed fire calls `fireSummary()` directly,
not `harness hooks status --json`.

**CONFIRMED:** uninstall removes pre-existing empty event arrays. The code and
test both name this over-reach; it violates the promised surgical removal of
only our entries, independent of whether a particular agent currently treats
an empty array and an absent key alike.

## C) Checklist

- [x] Exact Phase 2 diff reviewed: `5b3b1264..ea5d6b6a -- harness/cli`
- [x] Targeted Phase 2 tests run on an isolated detached worktree
- [x] Dim-0 mutants run with matched patch anchors
- [ ] Delivered `uninstall` verb present
- [ ] Failed-fire status behavior protected through the real CLI
- [ ] Uninstall preserves pre-existing empty event arrays
- [x] Unsupported-strategy refusal has a real guard
- [x] `ours-with-foreign` refusal has a real guard
- [x] Real-bin binary-path check has a real guard

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH / FIX_REQUIRED | `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/harness/cli/src/acts/hooks.ts:80-100` | correctness / scope | `uninstall` is never registered, so the required operator command does not exist. | Wire and test an operator-facing `uninstall` command through the real bin. |
| F002 | HIGH / FIX_REQUIRED | `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/harness/cli/src/acts/hooks.ts:92-94`; `harness/cli/test/services/hooks/verbs-e2e.int.test.ts:114-137` | testing / backpressure | A failed fire can disappear from delivered `status --json` while all target tests remain green. | Drive a real failed fire, then assert its cause and count through `harness hooks status --json`. |
| F003 | HIGH / FIX_REQUIRED | `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/harness/cli/src/services/hooks/uninstall-strategy-a.ts:158-172`; `harness/cli/test/services/hooks/uninstall.test.ts:155-170` | data integrity | Uninstall deletes event-array keys that existed before install. | Track which keys install created and remove only those keys on uninstall. |

## E) Detailed Findings

### E.1) F001 - `uninstall` is implemented below the deliverable but absent from it

**CONFIRMED.** The act registers `fire`, `list`, `status`, and `install`, ending
at line 100. `uninstallStrategyA()` has no caller outside its direct unit test
file. On the detached `ea5d6b6a` build:

```text
$ node harness/cli/bin/harness.js hooks uninstall --json
error: unknown command 'uninstall'
(Did you mean install?)
exit=1
```

The Phase 2 task calls for `harness hooks install|status|uninstall|list`; this
is an omitted public surface, not an implementation detail.

### E.2) F002 - failed-fire evidence is not tested at the CLI boundary

**CONFIRMED (Dim-0).** I replaced the actual status mapping:

```ts
fires: fireSummary(d)
```

with a constant `{ recorded: false, total: 0, failed: 0, failures: [] }`, rebuilt
the isolated commit, and ran the six target files. All 71 tests passed. The
patch anchor matched and the whole mutant run was green.

`status-and-fires.test.ts` proves `fireSummary()` can read a failed journal
entry, including a real `hooks fire` process. The e2e status tests only prove
the no-fire shape, `recorded: false, total: 0`. Neither invokes real `status`
after a failed fire. Since hook execution intentionally exits zero and is
silent, this is the compensating control's load-bearing assertion.

### E.3) F003 - uninstall mutates pre-existing empty user configuration

**CONFIRMED.** After removing marked entries, uninstall removes every now-empty
event array. It has no record of whether the array existed beforehand. The
matching test explicitly expects a document seeded with `PreToolUse: []` and
`PostToolUse: []` to end with neither key.

This is a destructive change to configuration the installer did not create. It
also conflicts with the task's surgical-removal and original-value preservation
claims. Whether current loaders make absent and empty equivalent is **INFERRED**:
no native loader was measured. That uncertainty is not a basis to delete
pre-existing state.

### E.4) Confirmed clean controls

- **Unsupported strategies:** mutating `if (!report.supported)` to `if (false)`
  made `install REFUSES a detected-but-unsupported agent BY NAME` fail. The
  current Strategy C/D cut refusal is protected.
- **Three-state ownership:** mutating the removal predicate to include
  `ours-with-foreign` made the byte-identical foreign-entry test fail. The
  direct strategy function refuses that shape correctly.
- **Binary target:** replacing the real `process.argv[1]` input with a missing
  path made the real-bin e2e path assertion fail.
- **Backup widening:** the Phase 2 suite covers both `claude-code` and `gemini`
  no-override fallback paths, plus the Claude override path.
- **JSONC properties:** comment, key-order, pre-existing-entry and untouched
  prefix checks are input-derived rather than relying solely on regenerated
  goldens.

### E.5) Doctrine and domain compliance

Domain mode is off. No domain artifacts are implicated by this phase. The three
findings are all failures of the plan's stated deterministic backpressure and
safe-config-editing doctrine.

## F) Coverage Map

| Review concern | Evidence | Confidence |
|----------------|----------|------------|
| Public `uninstall` surface | Exact binary invocation and source trace | High |
| Failed fire exposed by delivered status | Anchored status-payload mutant: 71/71 target tests green | High |
| Preserve pre-existing empty arrays | Source trace and direct unit-test expectation | High |
| Strategy C/D refusal | Anchored refusal mutant rejected by test | High |
| Compound ownership refusal | Anchored ownership mutant rejected by test | High |
| Real binary path | Anchored path mutant rejected by e2e test | High |

## G) Commands Executed

```bash
git diff 5b3b1264..ea5d6b6a -- harness/cli
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npx vitest run test/services/hooks/uninstall.test.ts test/services/hooks/hooks-verbs.test.ts test/services/hooks/verbs-e2e.int.test.ts test/services/hooks/config-writer.test.ts test/services/hooks/backup-widening.test.ts test/services/hooks/status-and-fires.test.ts
node harness/cli/bin/harness.js hooks uninstall --json
```

## H) Handover Brief

**Review result**: REQUEST_CHANGES (FIX_REQUIRED)  
**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/docs/plans/082-harness-hooks/plan.dd.json`  
**Phase**: Phase 2  
**Tasks dossier**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/docs/plans/082-harness-hooks/assets/tasks/phase-2/tasks.dd.md`  
**Execution log**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/docs/plans/082-harness-hooks/assets/tasks/phase-2/execution.log.md`  
**Review file**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/docs/plans/082-harness-hooks/assets/tasks/phase-2/reviews/review.phase-2.md`

1. Register and test `harness hooks uninstall` through the real binary.
2. Add a real-bin failure path: cause a fire failure, invoke `harness hooks status --json`, and assert `failed` plus the cause.
3. Preserve a pre-existing empty event key by recording creation provenance at install, not by guessing from an empty array during uninstall.

**Softest claim:** `github-copilot`'s `type: "command"` remains unverified against
Copilot's native parser. Its presence is sourced from the observed git-ai file,
but requiredness has not been measured; I did not classify that as a defect.

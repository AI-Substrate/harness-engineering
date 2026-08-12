# Code Review: Phase 3 - Doctor installs hooks alongside git-ai

**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/docs/plans/082-harness-hooks/plan.dd.json`  
**Phase**: Phase 3 - Doctor installs hooks alongside git-ai  
**Date**: 2026-08-10  
**Reviewer**: Cross-model review  
**Scope**: `ea5d6b6a..ca505b23 -- harness/cli`  
**Testing approach**: Hybrid (real-bin integration tests plus isolated mutation checks)

## A) Verdict

**REQUEST_CHANGES / FIX_REQUIRED**

The normal recovery paths are well-designed, but an unwritable provenance state
silently turns a successful install into an unrecoverable configuration mutation.
The second-install provenance guarantee is also unprotected: its destructive
regression mutant passes all 85 targeted Phase 3 tests.

## B) Summary

The doctor injection fence is correctly composed from the resolved collector
dependencies, and its test positively proves a fenced write while rejecting the
real home. Restore is delivered through the real binary and loudly refuses missing
or invalid backups. The backup tree and manifest preserve absolute sources,
including `__` names and recorded absences. The Cursor validation prompt uses
`refs/notes/ai`, creates its scratch repository, and asks for note identity rather
than a count.

The two findings are about recovery guarantees after a real write. The first is
production behavior observed through the real binary. The second is confirmed
mutation evidence of an unprotected guarantee; the implementation currently has
the right merge, but the targeted suite cannot retain it.

## C) Checklist

- [x] Scope limited to the supplied Phase 3 CLI range
- [x] Injection guard tested with positive and negative controls
- [x] Restore refusal tested through the real binary
- [x] Backup round trip reviewed for namespace split, absent files, and corrupt manifests
- [x] Provenance merge and prune-on-unmarked behavior traced
- [x] Real-bin tests run with an isolated HOME
- [ ] Provenance write failure is handled safely
- [ ] Second-install provenance is protected by an end-to-end assertion

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|---|---|---|---|---|---|
| F001 | HIGH | `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/harness/cli/src/services/hooks/hooks-verbs.ts:193-201` | recovery correctness | `recordInstall()` can return `false`, but the result is discarded and the mutated config is reported as installed. | Treat persistence failure as a failed install and compensate the just-written entries (or otherwise retain durable provenance) before reporting success. |
| F002 | HIGH | `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability/harness/cli/test/services/hooks/verbs-e2e.int.test.ts:98-104` | test evidence | The second-install test stops at byte equality and never verifies later uninstall; a provenance-overwrite mutant passes all 85 targeted tests. | Add a real-bin install -> install -> uninstall round trip for created files and created event keys. |

## E) Detailed Findings

### F001 - CONFIRMED: provenance persistence failure leaves unrecoverable state

`recordInstall()` explicitly returns `false` when it cannot create or write
`install-record.json` (`install-record.ts:96-104`). `installHooks()` invokes it
after writing agent configuration but ignores that result (`hooks-verbs.ts:193-201`)
and appends the outcome to `installed`.

I reproduced this through the Phase 3 binary with an isolated HOME whose
`~/.harness` was a regular file. `hooks install --json` reported Cursor
`created: true` and no failures. `hooks uninstall --json` then removed the two
entries but reported `deleted: false`; `.cursor/hooks.json` remained with empty
`preToolUse` and `postToolUse` arrays. The original state was no config file.

This violates the phase's recovery promise precisely when its provenance store is
unavailable. It affects direct `harness hooks install` and doctor, because doctor
uses the same service.

### F002 - CONFIRMED: the merge-across-installs guarantee has no effective test

The implementation correctly ORs `createdFile` and unions `createdKeys`
(`install-record.ts:87-93`). However, the real-bin idempotency test performs two
installs and asserts only that config bytes do not change
(`verbs-e2e.int.test.ts:98-104`). Its created-file recovery test performs only one
install before uninstall (`verbs-e2e.int.test.ts:386-405`).

I anchored a mutant replacing the merge with:

```ts
createdFile: outcome.created,
createdKeys: [...outcome.createdKeys],
```

Then rebuilt and ran all six targeted Phase 3 files: **85 tests passed**. Through
the real binary, the same mutant left an install-created Cursor config behind after
install -> install -> uninstall. This is a test-evidence finding: current code is
correct, but a regression of the explicit provenance contract is not detected.

### Clean controls and reviewed boundaries

- **Injection guard: CLEAN.** Replacing the injected home at
  `doctor.ts:299` with `/escaped-home` made
  `doctor.test.ts` fail its positive fenced-write assertion. The test also checks
  every fake-FS write is outside `homedir()`. The real-bin doctor tests run with
  isolated HOME values.
- **Restore delivery: CLEAN.** Replacing the restore non-zero branch with
  `if (false)` made both real-bin refusal tests fail. Missing manifests and no
  backup are not reported as clean restores.
- **Backup mapping: CLEAN.** The manifest records absolute source paths and the
  restore tests cover a `__` directory name, a recorded absence that must delete,
  and unrecognized/missing manifests.
- **Uninstall ownership and pruning: CLEAN.** The real-bin tests cover
  unsupported `pi`, created-file deletion, and an out-of-band cleanup that removes
  stale provenance. No-provenance behavior is conservative in
  `uninstall-strategy-a.ts`.
- **Prompt: CLEAN.** `CURSOR-PROMPT-8.md` creates the validation repository,
  reads `git notes --ref=ai show HEAD`, requires sha/file/range/actor-kind identity,
  and includes explicit uninstall cleanup.

## F) Coverage Map

| Acceptance area | Evidence | Confidence |
|---|---|---|
| Doctor installs only in injected boundary | Anchored home mutant made `doctor.test.ts` fail | High |
| Restore recovers safely | Real-FS backup round trips and real-bin refusal mutant | High |
| Restore handles absence and malformed backup | Integration tests and real-bin refusal assertions | High |
| Provenance survives normal single install | Real-bin created-file uninstall test | High |
| Provenance survives repeated install | Merge mutant leaves all 85 targeted tests green | Low |
| Provenance storage failure is recoverable | Real-bin reproduction shows incorrect successful result | Low |
| Prompt scores note identity | Direct prompt audit | High |

## G) Commands Executed

```bash
git diff ea5d6b6a..ca505b23 -- harness/cli
HOME=/tmp/pij-causal-sturgeon-home HARNESS_TEST_SCOPE=all npx vitest run --config vitest.config.ts ...
HOME=<isolated> node harness/cli/bin/harness.js hooks install --json
HOME=<isolated> node harness/cli/bin/harness.js hooks uninstall --json
node harness/cli/bin/harness.js plan validate docs/plans/082-harness-hooks/plan.dd.json --complete
```

The targeted baseline was 6 files / 85 tests passing. The complete plan validation
returned zero errors and 64 pre-existing warnings; it is not used as implementation
evidence for this phase.

## H) Handover Brief

**Review result**: REQUEST_CHANGES / FIX_REQUIRED

**Required fixes**

1. Make failed provenance persistence visible and recoverable: do not return a
   successful install after configuration is written without durable uninstall
   provenance. Add a real-bin test that makes the state directory unwritable (a
   file at `~/.harness` is cross-platform) and proves the original config state is
   retained or restored.
2. Add real-bin second-install recovery tests. For an initially absent config,
   install twice then uninstall and assert the file is deleted. Repeat for a
   pre-existing config without event keys and assert those created keys disappear
   after the second install and uninstall.

**Softest claim**: I found no remaining path in the changed Phase 3 composition
that can reach the real home when `collectorOverride` is injected. That conclusion
is based on the changed call graph and mutation controls, not a proof over every
future caller.

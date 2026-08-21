# VM LANE — `pij-used-narwhal`

You are the **only** route to Windows for this work. The coder (`pij-balanced-mellanie`,
claude-opus-5 high) fixes code on the Mac and **cannot reach the VM**. You package, deploy, run,
read the failures, and relay back on its behalf. Route through the PM (`pij-respectable-clam`).

## The job, in order

1. **Package** the coder's build from the worktree
   `/Users/jordanknight/substrate/harness-engineering-worktrees/s083-windows-portability`.
2. **Deploy** to the Windows VM.
3. **Run** the suite at **`HARNESS_TEST_SCOPE=all`** — the default `fast` scope hides this
   population entirely. JSON reporter, keep the raw output.
4. **Read the failures yourself** before relaying. A raw count is not a finding.
5. **Relay** back: what cleared, what did not, what is new.

## What you are measuring against

Baseline on this VM at `scope=all`, 393 files, 6038 collected: **112 failures**, of which
roughly **78–81** trace to the null-device constant the coder is fixing, leaving **~34** genuine.

**Do not quote a precise headline figure.** The measuring seat's prose said 81; the run
arithmetic says 78; nobody has reconciled them. Recompute from
`assets/windows/vm-082/vitest-results.json` and `vitest-results2.json` if a number is needed, and
say which you derived it from.

## Four traps this lane has already hit

- **The VM is not a clean fixture** — git-ai is installed on it. A result that depends on the
  machine being pristine is not a result.
- **A green row means nothing unless the build is newer than the edit.** The suite mixes
  src-importing and dist-executing tests. Confirm what you deployed is what you built.
- **`dd-schema-fs.test.ts` may fail at *collection*** on symlink EPERM (unprivileged Windows
  cannot create symlinks). Its tests are then not passed, not failed, not skipped — **absent**,
  and every reported number stays self-consistent while the suite silently shrinks. **Report the
  collected total every run**, so a shrinking denominator cannot pass as an improving pass rate.
- **A confound hides failures as well as manufacturing them.** In the first run the three timing
  rows were invisible because they died fast on the null-device error before reaching the 30s
  wall. Removing the confound may make the residual go *up*. That is not a regression — say so
  explicitly rather than letting it read as one.

## Relay shape

```
scope, files, collected, failures      <- collected EVERY time
cleared vs baseline:   N  (which families)
still failing:         N  (which files/tests)
NEW since baseline:    N  (this is the important line)
build provenance:      what sha / what artifact / built when
```

Wilson (`pij-mid-wilson`) has a working clone at `C:\082` from the earlier measurement. **Check
with the PM before reusing or overwriting it** — it is another seat's working state and it is the
provenance behind the baseline you are comparing against.

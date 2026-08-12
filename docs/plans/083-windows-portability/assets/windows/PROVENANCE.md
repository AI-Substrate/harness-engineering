# PROVENANCE — which file backs which number, and which of them are in this repo

**Written** 2026-08-12, after plan 083 merged (`cfbf7415`). **Read this before quoting any figure
from this plan.**

The plan's headline is **`107 → 0` on Windows**. Until this file existed, the only raw results
committed here were `vm-082/vitest-results{,2}.json` — which record **112** and **37**, a
**different lineage** from the two endpoints the title asserts. A reader opening them to check the
headline found numbers that could not be reconciled with it. **Evidence that looks like support
and disagrees is worse than absent evidence**, so the two load-bearing files are now committed and
every other run is fingerprinted below.

## The measurement chain — each run is the CONTROL for the next

Same Windows VM, same clone, one variable per commit. Verified in-tree after landing, not only at
source.

| run | commit | failed / collected / files | status | sha256 (first 16) |
|---|---|---|---:|---|
| tree695 | clean `695a3056` | 107 / 6038 / 393 | **LOCAL** | `2a0a8022fee03080` |
| **control** | clean `858f9a0c` | **107** / 6038 / 393 | **COMMITTED** — `vitest-results-control.json` | `87738d1ec257dd12` |
| treatment | `2d93d3af` null device | 28 / 6039 / 393 | **LOCAL** | `080fd889f07cba88` |
| hooks | `fd55fd4a` boundary | 11 / 6047 / 394 | **LOCAL** | `02e55a68d7ad8f9f` |
| symlink | `ba1aeda0` fs/doctor | 2 / 6055 / 395 | **LOCAL** | `0772b78c28bfadcb` |
| **timeout** | `3fa304e6` budget | **0** / 6055 / 395 | **COMMITTED** — `vitest-results-timeout.json` | `c5e9b826e9d9a5f1` |

**The two committed rows are the headline's two endpoints**, so `107 → 0` is checkable from this
repository alone. The four intermediate runs are controls; they are fingerprinted here rather than
committed, because their value is the *delta* they establish and the plan records each delta with
its attribution.

**Chain of custody, not just a self-computed hash.** The VM lane (`pij-used-narwhal`) reported
`sha 87738D1E` for the control and `sha C5E9B826` for the timeout run **at the moment of
measurement on the Windows box**, before either file left it. Both match the committed files. So
these are demonstrably the artifacts the VM produced, not lookalikes.

**LOCAL** files live in `scratch/win/results/` — **gitignored**, on one machine, not backed up.
Console logs sit beside each JSON as `vitest-console-<run>.log`.

## `vm-082/` — SUPERSEDED, kept deliberately, not quoted

| file | records | sha256 (first 16) |
|---|---|---|
| `vm-082/vitest-results.json` | 112 failed / 6038 | `987d3b6ea57162f9` |
| `vm-082/vitest-results2.json` | 37 failed / 6038 | `939a92d7fe253a2b` |
| `scratch/…/vm-082-original/vitest-console.log` | run-1 console (**LOCAL**) | `4eb748f36cefa5f3` |
| `scratch/…/vm-082-original/vitest-console2.log` | run-2 console (**LOCAL**) | `8a44935c6473771b` |

These are `pij-mid-wilson`'s original run-1 / run-2, and **112 is not our baseline — do not quote
it.** The reason is argued in full in the plan's **"A sha is not a tree"** section
(`windows-portability-plan.md`) and is not re-argued here: that run's **working tree state was
never recorded**, ~18 files were modified in it, and the seat that could have described it exited
on 2026-08-11. Its provenance is a sha and a memory.

They are kept because they are the **origin record of the discovery**, and because deleting the
evidence that a number was superseded is how a superseded number comes back.

## What is not here at all

The **x64 GitHub CI** confirmation — `passed=6027 failed=0 skipped=28 of 6055, 0/395 files failed`
— lives in Actions run `31462228537` and as a comment on PR #165. GitHub retains it; we do not.
It is a **second architecture** confirming the same fix, not part of the VM chain above.

## This evidence nearly died twice on 2026-08-12

Worth knowing, because both mechanisms are still live for anyone keeping results in `scratch/`:

1. **A worktree salvage** whose probe used `git ls-files -mo --exclude-standard` — which **excludes
   gitignored paths**. The console logs were invisible to it and would have gone silently, while
   the salvage report read *"complete"*.
2. **The worktree removal itself**, minutes later.

Both times the files were invisible to `git status`. The catch came from a seat with **nothing at
stake** in the tarball. **A gitignore flag means "not part of the deliverable" — never "not worth
keeping"**, and one filter carries both meanings.

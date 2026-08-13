# SUPERSEDED — these files record 112 and 37. The plan's headline is 107 → 0.

**Do not quote 112 as this plan's baseline.** These are `pij-mid-wilson`'s original run-1 and
run-2 on the Windows VM, and they are an **earlier lineage** than the numbers the plan asserts.

| file | records |
|---|---|
| `vitest-results.json` | 112 failed / 6038 collected |
| `vitest-results2.json` | 37 failed / 6038 collected |

**Why they are not the baseline:** that run's **working tree state was never recorded.** Roughly 18
files were modified in it, only 6 of which were later attributable, and the seat that could have
described the rest exited on 2026-08-11. Its provenance is a sha and a memory. The argument is made
in full in `../../../windows-portability-plan.md` § **"A sha is not a tree"** — read it there
rather than re-deriving it here.

**What replaced them:** a clean control re-measured on the tree the fix actually lands on — **107**
— and the final run — **0**. Both are committed beside this directory as
`../vitest-results-control.json` and `../vitest-results-timeout.json`, with hashes and the full
six-run chain in `../PROVENANCE.md`.

**Why they are kept rather than deleted:** they are the origin record of the discovery, and
deleting the evidence that a number was superseded is how a superseded number comes back.

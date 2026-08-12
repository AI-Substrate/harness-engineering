# Reviewer brief — plan 077, round two (#108)

**PM**: `pij-respectable-clam` · **Coder**: `pij-sacred-orangutan` (opus-5) · **You**: terra @ xhigh

## Scope

- **Worktree**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability`
- **Commits**: `ab44268d`, `1faedfd7`, `aea4ae8d` · **Branch**: `s077/suite-portability`
- **PR #118 is OPEN and a downstream consumer pulls this branch.** Do not fix, do not push.
- Invoke the CLI as `node harness/cli/bin/harness.js`. Never `just link`.

```
/builder 7 review --plan docs/plans/077-windows-suite-portability --phase "Phase 3: Round two — the flake class we created, and the one product smell"
```

## Read first

`original-ask.md` (the frame) · `assets/tasks/phase-3/tasks.dd.md` ·
`assets/tasks/phase-3/execution.log.md` · **issue #108's last four comments at source**.

## The standing constraint

**Nobody here has a Windows box.** Every win32 figure is *expected, unverified*. The consumer's
re-run is the only proof. So the highest-value finding is **any place a win32 outcome is stated
more confidently than it was measured**.

## Where I want your skepticism, ranked

**1. THE ABSENCE CLAIM — the strongest claim in the round and the least verifiable.**
Five of the eight 30s-ceiling cases (`app` ×4, `update-banner` ×1) were investigated and
deliberately **not touched**. The coder reports: fully faked deps, `src/services/telemetry` has no
`child_process`/`fs`/`homedir`, 0ms locally except one 180ms case — and says it found **no
mechanism** for their 18–26s on the consumer's box, reporting that as an *absence* rather than
inventing one.

Attack it. Is the absence real, or is it a search that stopped early? Name a mechanism it did not
consider — module resolution, vitest worker startup, transform cost, fake construction, anything
that costs time on Windows and nothing here. If the absence holds, it **reframes the consumer's #1
item**: 5 of 8 ceiling cases contain no measurable work, which is a different problem from "slow
tests".

**2. THE tk-0201 CONSOLIDATION — did it keep all three properties?**
The coder **verified then declined** the consumer's suggestion: the three `flow-renderer` cases are
three *different* properties over three *different* inputs (golden corpus / the importance-border
regression that actually shipped / TD-columns shape), so "one representative proof" buys time by
deleting two. It instead measured that the cost is **spawns, not assertions** (1 fence 508ms, 20
fences 558ms — 19 extra fences cost 50ms) and batched to one memoised spawn, keeping all three
assertions and the same 58 tests.

Verify the three properties genuinely survive. A batch that merges three assertions into one
weaker one would look identical in the test count.

**3. THE (a)/(b)/(c) VERDICT AND ITS STATED LIMIT.**
Evidence supports **(a)**: the pre-fix predicate evaluated verbatim on win32-shaped keys gives
`dirKeyMatches=false, fileKeyMatches=false, hasSource=false` — `copyDir` returns before **any**
read, so the consumer's downstream door is never reached on our tree. **(b)** is ruled out because
`copyDir`'s copy loop already normalised keys before the change.

The coder says it **cannot** distinguish **(c)** — their fork is demonstrably not upstream. Check
that the verdict is stated with that limit intact everywhere it appears (log, plan, receipts), and
that the coder's "their observation is nonetheless REAL — different call paths" survives into what
we send them. Two parties observed true things; only the routes differ.

**4. THE DENOMINATOR.** A main merge landed between round one's log and this one, so local
**5124 is not comparable to round one's 5116**. The coder counted the delta **from the diff**, not
by subtracting run totals, and says it nearly reported a −8 that was a tree conflation. Verify the
+1 is real and that nothing else in the report subtracts across the merge.

**5. `meta.status`.** `dd doctor` rejected `complete`; set to `ready` because PR #118 is still open
and `shipped` would overclaim. Confirm that is the honest value.

## Known-open, do not re-report

- One surviving `flow-renderer` case at ~26s vs a 30s ceiling (**~1.15x**) — better than three at
  flake margin, **not fixed**, and the coder asked for it not to be buried.
- `cbd90474` (turkey's preserved work) is **not** an ancestor of this branch — verified with
  `git merge-base --is-ancestor`. Those 6 files are **not** covered by this round's green suite.
- **#129** stays unassigned. The coder carried two pointers without pulling them in.

## Bar for a finding

The consumer is not blocked and has said stopping here is reasonable. A finding must be a real
defect, a control that does not fail when it should, or a claim outrunning its evidence — not
polish. If it is clean, say so plainly.

## Deliverable

Append to `assets/reviews/phase-3-review.md`, then `pij send pij-respectable-clam` **APPROVE** or
**CHANGES** with findings ranked.

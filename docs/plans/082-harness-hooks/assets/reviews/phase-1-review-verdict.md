# Phase 1 Cross-Model Review

**Verdict: APPROVE_WITH_NOTES**

## Finding

### F001 - Medium - Provocation rows for real reflog/merge paths can pass without running their transition

**CONFIRMED** at `harness/cli/test/services/hooks/provocation.int.test.ts:172,281-304`.

`gitTry()` swallows a non-zero Git exit, while the affected table rows assert only
`outcome.kind === 'silent'`. If a transition fails, POST sees the PRE head unchanged
and returns `silent/head-unchanged`, so the row passes without exercising its named
real-git operation.

I replaced only the `single-commit fast-forward pull` transition callback with a
no-op and ran its targeted test. It still passed. The same assertion shape affects:

- multi-commit fast-forward pull
- single-commit fast-forward pull
- no-ff merge
- committing cherry-pick
- committing revert
- git am

This weakens the real-repository proof for the reflog and multiple-parent paths; the
pure classifier test is not a substitute. Make each row assert its expected reason
or assert a postcondition such as the intended HEAD transition before asserting
silence.

## Clean controls

- **CONFIRMED:** The classifier takes no `.git` state parameter; the seven named
  pre-index defeaters, real positive emission, and both declared known-blind
  emission rows are present.
- **CONFIRMED:** The provocation suite operates on isolated, real Git repositories.
  The seven index rows use throwing `git()` commits, so their target commits cannot
  silently become no-ops.
- **CONFIRMED:** My independent mutations of the classifier produced the claimed
  disjoint failure sets: command scan removed = 5 red; pre-index discriminator
  removed = 7 red; both removed = 12 red, exactly their union.
- **CONFIRMED:** `claimTransition()` uses exclusive creation before `emitter.emit()`;
  the real-filesystem race test produces one emission.
- **CONFIRMED:** Runtime failure assertions use the journal rather than treating
  exit zero as evidence. The live-daemon fixture was measured here: the positive
  produced a note anchored to its commit, `a.txt`, range `1-3`, and an actor in the
  note body; its no-emit causation control produced no note.
- **CONFIRMED:** Restored focused baseline: 55 tests passed across provocation,
  state, verb, and live-daemon fixtures. No `harness/cli` changes remain from this
  review.

## Softest claim

**INFERRED, not filed:** `FileHookJournal.record()` is a read-rewrite-write sequence
without an interprocess lock. Concurrent hook processes could lose one journal
outcome. I did not reproduce that race, so it is not a formal finding in this
review.

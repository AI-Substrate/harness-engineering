# Reviewer brief — plan 077, round four: the null-device product defect (#108)

**PM**: `pij-respectable-clam` · **Coder**: `pij-effective-flyingfish` (opus-5) · **You**: terra

## Scope

- **Worktree**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability`
- **Commit**: `67595344` (6 files, +238/−6) on `s077/suite-portability`, base `f19bf0d1`
- **NOT PUSHED.** Do not fix, do not push, do not merge.
- Invoke the CLI as `node harness/cli/bin/harness.js`. Never `just link`.
- Brief the coder worked to: `assets/CODER-BRIEF-round4-nulldevice.md`

## The standing constraint

**Nobody here has a Windows box.** Every win32 outcome is *expected, unverified*. The
downstream consumer has already **signed off** and may never run this, so their re-run is
not a safety net you can assume.

## The claim structure — this is what to attack

The change rests on **two stacked claims**, and only one is ours:

- **(i)** `os.devNull` returns `\\.\nul` on win32 — **ours**, documented Node behaviour,
  assertable under simulation.
- **(ii)** git **accepts** `NUL` and treats it as an empty config — **NOT ours**. Inherited
  from a comment in the consumer's fork, which they said plainly they could not date or
  trace to a changelog.

The agreed ceiling, which should appear in the commit subject and body: **"we now emit the
spelling git is reported to accept"**, NOT "isolation is restored on Windows".

**Check (ii) is nowhere written in our voice** — not in code comments, not in the commit
body, not in test names. If we have quietly promoted a borrowed undated claim into an
assertion, that is the finding.

## Where I want your skepticism, ranked

**1. THE CODER'S OWN SOFTEST CLAIM — it named it, so test it.**
Case 5 is a source-text guard: every executable `GIT_CONFIG_GLOBAL` line in the adapter
must route through `nullDeviceForPlatform`. The coder says this only guards a third site
*in that one file*, and a new `GIT_CONFIG_GLOBAL` in a **different** adapter is invisible
to it.

I verified the exposure is currently zero — `grep` across `harness/cli/src` finds
`GIT_CONFIG_GLOBAL` only in that adapter. So the gap is about a future file, not a present
one. **Decide whether that makes the per-file guard sufficient or whether the commit body
overclaims.** The coder explicitly asked you to push on this.

**2. THE MUTATION EVIDENCE — re-run it, do not read it.**
The coder reports it verified by reverting, not by inspection:

```
fix in place ............................ 5 passed
BOTH sites reverted ..................... 3 failed / 2 passed
ONE site fixed, the other left .......... 2 failed / 3 passed
```

That third case is the one that matters — a test that only fails when *both* sites are
broken would be worthless against the sibling-left-behind shape. **Confirm each site is
asserted separately and by name, and that neither is proven by implication from the
other.**

**3. THE EXPORT SURFACE — the coder flagged this as the diff's one judgement call.**
Two env builders and the helper are now exported, to make both sites assertable under a
simulated platform without threading a platform field through the adapter class. Is that
the smallest change that buys the testability, or has production API been widened for a
test's convenience? `arch-check` is reported unchanged at baseline (2) — verify.

**4. THE PRE-EXISTING ASSERTION THAT WAS ALSO WRONG.**
`exec-remote-telemetry-git.int.test.ts:1491` read `toBe(devNull)` — correct on POSIX,
wrong on win32, and *structurally incapable* of catching this defect. Now
`toBe(nullDeviceForPlatform())`. Confirm it would have gone red on Windows if left, and
that the new form is not merely tautological with the implementation.

**5. THE THREE COMMENT-ONLY SITES.**
`exec-git-write.int.test.ts:165,166` and `archive-move.test.ts:65` keep the bare
`'/dev/null'` literal deliberately. My ruling, and I want it checked rather than trusted:
on win32 `'/dev/null'` is an ordinary **missing file** git reads as no config, whereas
`os.devNull` resolves to the **device path**. Evidence: both files run on Windows with no
platform guard, execute real git repeatedly, and are **not** in the consumer's failing set
across three pristine runs.

**The hazard inverts** — those sites are safe *because* they look wrong, so a future
tidy-up to `os.devNull` would introduce the bug at three new sites. Confirm the comments
actually say that, and that nothing there changed behaviour.

## Known and deliberate — do not re-report

- Six other consumer failures: deranked by them, untouched.
- `#129`, `#130`: filed, out of scope.
- Warn-launch baseline: `arch-check` 2, `markdown-lint` 210, `windows-check` 6. Report only
  if this commit **added** to any.
- No `windows-check` rule for null-device-as-config-path. Deliberately not added — it would
  move the warn-launch baseline.

## Bar for a finding

A real defect, a control that does not fail when it should, or a claim outrunning its
evidence. Not polish. **The highest-value finding is any place a win32 outcome, or claim
(ii), is stated more confidently than it was measured.** If it is clean, say so plainly.

## Deliverable

Append to `assets/reviews/phase-4-review.md`, then `pij send pij-respectable-clam`
**APPROVE** or **CHANGES** with findings ranked.

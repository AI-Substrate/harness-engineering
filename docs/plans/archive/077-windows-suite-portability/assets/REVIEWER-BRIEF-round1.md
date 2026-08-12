# Reviewer brief — plan 077, round one (#108)

**PM**: `pij-respectable-clam` · **Coder**: `pij-marked-owl` (opus-5) · **You**: terra, cross-model by design

## Scope

- **Worktree**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability`
- **Branch**: `s077/suite-portability` — **PR #118 is open and the consumer pulls this branch.**
- **Commit under review**: `e825bf99`
- Invoke the CLI as `node harness/cli/bin/harness.js …`. **Never `just link`.**

    /builder 7 review --plan docs/plans/077-windows-suite-portability --phase "Phase 2: Round one — the consumer-ranked noise removal"

## Read first

1. `docs/plans/077-windows-suite-portability/original-ask.md` — the frame
2. `assets/tasks/phase-2/tasks.dd.md` — the five tasks
3. `assets/tasks/phase-2/execution.log.md` — the coder's own account
4. **Issue #108's last comment, at source** — https://github.com/AI-Substrate/harness-engineering/issues/108
   The consumer's measurements and root-cause trace. Better evidence than anything relayed.

## The constraint that shapes this whole review

**Nobody here has a Windows box.** Every win32 claim in this round is *expected, unverified*. The
consumer's re-run is the only proof available. So the highest-value thing you can do is **find any
place where a win32 outcome is stated more confidently than it was measured** — that is the exact
failure this thread keeps punishing, and we have already shipped it once (see tk-0103).

## Where I want your skepticism, ranked

**1. tk-0103 — the capability probe. This is the fix for OUR OWN shipped defect, so hold it to a
higher bar than the rest.**
`hasBinary()` probed presence; on Windows `bash` is WSL bash, which exits 127 on a native path. The
new `canRunShellScript()` executes a real script through a real temp tree. Attack it:
- Does the probe actually assert **both** properties it claims (native-path script runs; shimmed
  executable on PATH resolves)? Could it pass while either is false?
- Is there a host where `canRunShellScript` returns **true** and the fixtures still fail? That is
  the same class of gap one level in.
- The 7-case regression control asserts `hasBinary` and `canRunShellScript` **disagree** about a
  127-exiting shell. Is it a real control, or does it pass by construction?

**2. tk-0102 — the coder found TWO MORE defective helpers the consumer's data could not see.**
Simulated-win32: 39 → 8 (shared helper only) → 0 (all three). Verify that arithmetic is real and
not an artefact of the simulation. And: **is there a fourth?** The method that found helpers 2 and 3
was a negative control, not reading — apply the same method rather than re-reading the file.

**3. The `~1605` control repair.** It asserted the platform fallback *host-dependently* and would
have broken under the fix. The coder repaired it to assert per-host rather than deleting it. Check
the repair actually still proves the fallback — a repair that quietly weakens a control to keep it
green is worse than the deletion it avoided.

**4. tk-0104 scope — I ruled to KEEP IT NARROW** (skip the daemon describe, 18 cases, not the file,
91). Reasoning: the other 73 pass on Windows today and are where a Windows product defect would
show. Tell me if that ruling is wrong. Stated cost: 18 declared vs 16 measured failing = 2 cases of
coverage genuinely given up.

**5. The timeout raise (tk-0101).** Does it fix the instrument without hiding a real slow-path
regression? A raised timeout that masks a genuine performance defect trades one blindness for
another. Check whether anything should have stayed bounded.

**6. Every skip message.** The consumer singled these out as *"the first thing in this whole thread
that made a Windows gap legible instead of just red"*. Each must name the thing, why it cannot be
substituted, and **what specifically stopped being checked**. A skip that goes quiet is a control
that passes by examining nothing.

## Known-open, do not re-report as new

- **39 vs 40**: the coder counts 39 nudge failures, the consumer measured 40. Deliberately
  unreconciled. Likely a predicate/denominator mismatch rather than a missing case.
- **A second win32 defect in `post-commit-hook`**: PATH built with a hardcoded `':'`. Confirm
  whether the log says FIXED or only FOUND — if only found, it must not read as handled.
- **D8**: no way to run this suite as another platform. Recorded for a later round.

## Deliverable

Write to `assets/reviews/phase-2-review.md`, then `pij send pij-respectable-clam` a verdict
(**APPROVE** / **CHANGES**) with findings ranked.

**Do not fix anything. Do not push. Do not open a PR.**

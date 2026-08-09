# Coder brief — plan 077, round six: the `windows-latest` CI leg (#108)

**PM**: `pij-respectable-clam` · **Coder**: `pij-exuberant-skaffen` · **Branch**: `s077/suite-portability` @ `209d1e3b`

## Why this exists — it is the actual finding of the whole thread

`windows-check` found **zero** of the four defects fixed in `5a8e8f5b`, and cleared zero.
Every one was a **logical-vs-native path shape mismatch at a comparison**, which no
per-line lint can see. Adding WIN rules would not have caught them and will not catch the
next one.

**Right now the only instrument that can see this class is a person in another org,
volunteering to run our suite on their laptop.** That is not a supply chain, it is a
favour — and it is why the count drifted to 134 before anyone noticed.

## What to build

A `windows-latest` job on `ci.yml`.

**WARN-LAUNCH, not a gate.** It runs, reports, and blocks nothing. The suite is not green
on Windows today, so a blocking job breaks every PR on day one. Flipping it to blocking is
a later decision that belongs to whoever owns it once it is actually green.

That matches how `windows-check`, `arch-check` and `markdown-lint` already ship here — use
the same posture and say so, so the next reader does not read "non-blocking" as "nobody
cared".

## The one design constraint that matters

**The job must report its SKIP COUNT, prominently.**

We have deliberately introduced win32 skips this round — the daemon cluster, the URL-scope
credential case. A Windows job that goes green *because the hard things are switched off*
is the control-that-cannot-fail shape we have spent five rounds removing from this
codebase. **A green must not be able to mean "we stopped looking."**

So the summary line reports **passed / failed / skipped**, and a rising skip count is
visible without anyone going hunting for it.

## What I do NOT want

- **Do not make the suite green by skipping.** If something fails, it fails and the job
  says so. This job's job is to *tell the truth*, not to be green.
- **Do not gate.** Not `ci-required`, not a branch-protection dependency.
- **Do not chase the current failures.** Their disposition is settled or declared;
  `:997:22` is an open unknown awaiting the consumer's log.

## Known facts to build against

- The consumer measures **~1s per child process** on Windows — spawn-heavy files are slow
  there, so expect a long job and do not tune it down by skipping.
- Their pristine `f19bf0d1` run: **12 files / 27 tests failing, 5121 total**. That is
  roughly what day one should report, minus what `5a8e8f5b` fixed. **If the job reports
  dramatically fewer failures than that, suspect the job before believing the number.**
- `just checks` baseline degradations, do not add: `arch-check` 2, `markdown-lint` 210,
  `windows-check` 6.

## Honesty constraints

- **We cannot test this job locally.** Its first real run is on GitHub's runner, so
  everything about its behaviour is **expected, unverified** until it runs there.
- A CI runner is **not** a proxy for a user machine — hosted runners are curated. A green
  `windows-latest` leg does not mean the consumer's box is green, and the job description
  should not imply it does.
- Name your own softest claim.

## Operational

Baton **`s077-gate`** covers commit + full-tree gate in this shared worktree —
`pij-nasty-mosquito` may be working. Request it when ready to commit; editing needs no
baton.

`HARNESS_NO_TELEMETRY=1 timeout 30 git commit --no-verify`, explicit pathspecs.
**Never `git add -A`.** Do not push. Report before committing.

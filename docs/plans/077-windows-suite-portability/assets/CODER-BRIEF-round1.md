# Coder brief — plan 077, round one (#108)

**PM**: `pij-respectable-clam` · **Reviewer**: terra (cross-model, spawned separately)

## Read first, in order

1. `docs/plans/077-windows-suite-portability/original-ask.md` — **the frame**. Read it properly;
   it changes what "done" means here.
2. `plan.dd.md` — ACs. Round one is **ac-0009, ac-000a, ac-000b**.
3. `assets/tasks/phase-2/tasks.dd.md` — your five tasks, `tk-0101` … `tk-0105`.
4. Issue #108, the **last comment** — https://github.com/AI-Substrate/harness-engineering/issues/108
   That is the consumer's own measurement and root-cause trace. It is better evidence than
   anything I can give you second-hand. Read it at source.

## Workspace

- **Worktree**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability`
- **Branch**: `s077/suite-portability` — **already pushed, PR #118 is OPEN and the consumer pulls
  it.** Commit onto this branch; do **not** open a new PR.
- Invoke the CLI as `node harness/cli/bin/harness.js …`. **Never `just link`** — the global
  `harness` belongs to main.
- `just build` is safe. `just checks` is the gate.

## The frame, in one paragraph

The person on the other end of #108 is **not a bug reporter — they are a downstream consumer
shipping harness to production**, on a source fork, and they are the only Windows signal anyone
has. Their Linux CI is green so **nothing here blocks their release**. What they want is
**signal-to-noise**: this suite is the only instrument that would detect the next Windows *product*
defect, and while it is permanently red nobody can tell whether one is in there. Optimise for
making Windows gaps **legible**, not for a green number.

They ranked this work themselves. **Work their order.** It is not the order we would have picked.

## Your five tasks

**tk-0101 — raise the 5000ms timeout. DO THIS FIRST.**
Their #1, and it is the instrument: ~46 of ~151 failures are `Test timed out in 5000ms`, and on
*this branch* it manufactured phantom failures in five files that pass on main (the run was 32%
slower on the same box with nothing else changed). **While it stands, no other Windows measurement
is trustworthy — including your own for tk-0102 and tk-0104.** Prefer a global raise unless you
have a reason not to; state which you chose and why.

**tk-0102 — `platform: 'linux'` in `nudge.test.ts`'s `deps()` helper (~line 92).**
~40 failures, one line. They root-caused it: the helper never sets `platform`, so `isWin32()` falls
back to `IS_WIN32` and reads the host. **Do not touch `nudge.ts`** — the guard is correct, the
composition root passes `platform` explicitly, and `nudge.ts:300` already states the rule. The
file's own convention is to inject it (`pipeDeps({platform:'win32'})` at 1470/1483/1495/1513).

**tk-0103 — fix the capability defect WE shipped in #118.**
`hasBinary()` in `test/support/external-binary.ts` probes **presence**. On Windows `bash` resolves
to `C:\Windows\system32\bash.exe` — **WSL bash** — which eats the backslashes in a Windows path and
exits 127; `which node` inside it also fails. So the guard returns true and `post-commit-hook`
proceeds to fail anyway. Either probe **capability** (can it execute a script at a native path) or
skip that file on win32 with a named reason. Their line, and it is the lesson: *presence is not the
property that matters — capability is.* A presence-only guard is **worse than none**, because the
declaration makes the gap look handled.

**tk-0104 — skip `exec-remote-telemetry-git` on win32 with a NAMED reason.**
16 failures. The consumer deprioritised this **as coverage**, not as an oversight: it is a
real-`git daemon` suite that Linux CI covers properly, and on Windows the daemon holds handles past
SIGTERM. Name what is unproven on win32 in the skip text.

**tk-0105 — re-measure and report.**
Three columns — **failures fixed / failures declared / skips recovered**. Never a total that mixes
them. Expected trajectory: ~140 → ~40.

## The skip-message shape they asked for more of

They singled this out as *"the first thing in this whole thread that made a Windows gap legible
instead of just red"*:

> SKIPPED — the external binary `jq` is not on PATH for this host. This case is NOT reimplementable:
> jq is the SUBJECT of the assertion… What is now unproven on this host: that a reviewer at a shell
> can answer "which findings were refuted"…

Every skip you add names the thing, why it cannot be substituted, and **what specifically stopped
being checked**. A silent skip is a control that passes by examining nothing.

## Constraints

- Explicit pathspecs only — **never `git add -A`**. **Never `git stash`** (shared across worktrees).
- Commit as `HARNESS_NO_TELEMETRY=1 timeout 30 git commit --no-verify`.
- Push to `s077/suite-portability`. **Do not open a PR** — #118 exists.
- `just fix` before pushing (CI gates on biome), then `just checks` green on every hard gate. The
  three warn-launch degradeds (`arch-check`, `markdown-lint`, `windows-check`) are pre-existing.
- **We cannot verify any of this on Windows ourselves.** Do not claim a Windows outcome you have
  not measured — say "expected, unverified on win32" and let their re-run be the proof.

## Report

`pij send pij-respectable-clam "<one line> — <path>"`. Pointer-style: detail to disk, send a path.
If a task looks wrong, say so early — a wrong task is mine to fix, not yours to work around.

# Phase 1 review brief — what to attack, and what a pass has to prove

> Written by the PM BEFORE the review, so the reviewer is not handed the coder's framing as its
> starting premise. Read this before the diff.

## Your job

You are the **cross-model reviewer**. The coder wrote its own tests, so **green is a claim, not
proof**. Run `/builder 7 review` — that is a skill you are expected to use, not a formality.

Review the commit range on `s077/suite-portability` from `e50311c5` (exclusive) to the phase-1
head. Everything before that is plan documents and is out of scope.

## The one thing this phase exists to get right

`harness hooks fire` must emit a synthetic trace2 event **only when the agent AUTHORED a new
commit in this repository**. Every wrong emit fabricates a note claiming an agent wrote code a
human or a merge actually wrote. That is the exact defect the plan exists to fix, so shipping a
guard that over-emits would reproduce it with our name on it.

**The discriminator is the INDEX STATE RECORDED AT PRE.** This was measured, and three other
candidates were measured DEAD:

| candidate | why it fails |
|---|---|
| parent count | catches only `--no-ff` merges |
| reflog subject | catches ff-pull, cherry-pick, revert, amend — misses the other seven |
| `.git` state (`MERGE_HEAD`/`SQUASH_MSG`) | **does not exist when our hook runs.** `MERGE_HEAD` is never written by `merge --squash` at all, and `SQUASH_MSG` is unlinked by git before its own post-commit hook fires |

**Seven transitions are byte-identical to a genuine authored commit** on all three: `merge
--squash`, `cherry-pick -n`, `revert -n`, `git apply`, `checkout REF -- path`, `restore
--source`, `read-tree -m -u` (how `git subtree` works). At PRE each leaves an **already-staged**
index; a genuine agent edit leaves a **clean** one.

## Attack these specifically

1. **Does the classifier take `.git` state as a parameter?** If it does, that is a finding, not a
   style note — a fabricated input would make a broken system look green in tests while failing
   in the field, because the real file is gone by decision time.
2. **Is the provocation suite driven against REAL git repositories, or against the pure
   function?** A suite that feeds the pure classifier a hand-built state proves only that the
   implementation matches itself. Check what actually shells out.
3. **Are all seven defeaters present as rows, by name?** Count them mechanically; do not read the
   list and agree. A missing row is a hole in the only guard we have.
4. **Is the positive control real?** A suite that only asserts silence passes trivially if the
   runtime never emits at all. There must be a row that emits, and it must be able to fail.
5. **The known-blind row.** A human committing inside the PRE/POST bracket is indistinguishable
   and always will be — nothing in git records who typed. It must be asserted as **emitting**,
   documenting the limitation. If it is quietly absent, the suite is hiding a known defect.
6. **The atomic PRE write.** The POC wrote state after emitting — a read-then-write window where
   two concurrent fires both emit. Check for exclusive-create or a lock, and check there is a
   concurrency row proving at most one emit.
7. **Exit 0 everywhere, and the journal.** Every failure path exits 0 by design — which means
   **no assertion may rest on the exit code**, since it carries no information. Assertions must
   be on the journal. Verify that, and verify the journal actually records
   emitted / silent-with-reason / failed-with-cause.
8. **The live-daemon fixture.** `vitest.config.ts` sets `GIT_TRACE2_EVENT='0'` run-wide, so "no
   note appeared" is trivially true. The positive direction must exist, must assert note
   **identity** (file, line range, session id) and never a note **count**, and with no daemon
   present must record **SKIPPED**, never PASSED.

## Dim-0 is mandatory and it is not optional here

For every load-bearing assertion, prove the test is **non-vacuous**: break the guard, re-run the
targeted test, confirm RED, restore. The coder has been doing this and reporting it; your job is
to check it was actually done and that it bites where it matters, not to take the report's word.
An `APPROVE` asserting test quality with no mutation evidence is a missing proof — that is
`FIX_REQUIRED`, not a note.

## How to report

- Distinguish **CONFIRMED** (you ran it or read the exact line) from **INFERRED**.
- Say what you checked and found **clean** — a stream of findings with no positive controls is a
  bias I cannot see from outside.
- End with your **softest claim** — the thing you are least sure of, so it gets attention while
  it is still cheap to overturn.
- Findings carry severity. Critical/high → `FIX_REQUIRED`; medium → `APPROVE_WITH_NOTES`.

## Out of scope — do not file these

- **The absorption case** (human lines stamped as AI inside a file). Never reproduced; the plan
  explicitly does not claim to fix it. A finding that we failed to fix it is a finding against a
  declared non-goal.
- **Windows behaviour.** UNVERIFIED by design and handed to the remote agent on #108.
- **The installer, doctor wiring, and the `status` verb.** Phases 2 and 3.
- Pre-existing warn-launch findings (arch-check on `services/telemetry/*`, windows-check on
  `.harness/extensions/checks/extension.ts`, markdown-lint). None are in this diff.

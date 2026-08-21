# S3 — TESTS & TIMING. Six fake-fs rows, and three that may be a real race

**Worktree**: `harness-engineering-worktrees/s077-win-tests` · **Branch**: `s077/win-tests` @ `5e1aa48a`
**Read `docs/plans/083-windows-portability/assets/windows/STREAM-CONTEXT.md` first.** Everything merges into `s077/suite-portability`.

---

## Part A — six windsurf composition rows, and these ARE test-level

All six in `harness/cli/test/services/hooks/composition-boundaries.test.ts` — the F2/F3 rows:
does not report windsurf installed when the unit should commit · reports it installed when one of
its two files failed · does not name the file it could not roll back · does not throw where a
peer-sharing rollback must refuse · provenance compensation still says `rolled back` · does not
refuse to restore a file that moved under it.

**The product is fine and there is field evidence for that**: on the real Windows box `hooks
install` wrote **both** `~/.codeium` paths and `hooks status --probe` reports windsurf
`executionState: runs`. So F010 holds; it is the **fake-fs path handling** in these rows that does
not. Both we and the remote agent measured exactly 6, same file — a clean match.

Fix the fake-fs. **Do not touch `install-strategy-a.ts`** — if you find yourself wanting to, stop
and tell the PM, because that would mean the field evidence and the test disagree and *that* is the
finding.

## Part B — three timing rows, and DO NOT call them flaky yet

| file | observation |
|---|---|
| `adapters/git/exec-remote-telemetry-git.int.test.ts` | passes in isolation — contention only |
| `hooks/journal-race.int.test.ts` | passes in isolation (2/2); **under load the concurrent journal records 14 lines where 8 are expected** |
| `hooks/composed-command.int.test.ts` | flaky at the timeout boundary (28.3s against a 30s budget) |

**`journal-race` recording 14 where 8 are expected is not a timeout — it is a count.** A timeout
says "too slow"; a wrong count says the concurrent journal wrote more records than the contract
allows. That is a **concurrency observation**, and "raise the timeout" is exactly how a real race
gets buried. **Investigate it as a race first.** If it turns out to be genuinely test-only, say so
with the evidence that rules the product out — do not conclude it by default.

The other two look like genuine contention. Even so: prefer making the test **not depend on wall
time** over enlarging the budget. A bigger timeout is a smaller version of the same bug.

## Something the measurement already proved, and you should carry

In RUN 1 this family was **invisible** — zero timeouts recorded — because all three rows died fast
on the null-device error before reaching the 30s wall. They only appeared once that confound was
removed. **A confound hides failures as well as manufacturing them.** So: once S1 lands its
null-device fix, **re-measure this family**; your baseline may move under you, in either direction.

## Also yours — the denominator hazard

`dd-schema-fs.test.ts` fails at **collection** on symlink EPERM (unprivileged Windows cannot create
symlinks). Its tests are not passed, not failed, not skipped — **absent**, and every reported number
stays self-consistent while the suite silently shrinks.

Two parts, and the second matters more than the first:
1. Decide the handling — an explicit skip-with-reason that is *visible in the counts*, a
   Developer-Mode precondition, or a test that does not need symlinks. Your call, justified.
2. **A file that fails to COLLECT should be impossible to overlook.** Right now it costs one line
   in a log. Propose (do not build without the PM's go) how a collection failure could be made to
   surface as loudly as a test failure.

## Scope discipline

Do not touch S1's or S2's files. Find a third defect → report it, do not fix it.

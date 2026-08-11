# Shared context — the Windows portability streams (plan 082 / issue #108)

**Read this once. Your stream brief is separate and short.**
**PM**: `pij-respectable-clam` · **Base**: `s077/suite-portability` @ `5e1aa48a` · **PR**: #118

---

## What was measured, and by whom

`pij-mid-wilson` ran the full suite on a Parallels Windows 11 VM (local disk, clean shallow clone,
`npm ci` clean, git `2.55.0.windows.3`), **blind** — without reading the remote agent's report
first, deliberately, so the comparison was a diff and not a confirmation.

```
scope=all · sha 695a3056 · 393 files (367 cli + 26 ext) · 6038 collected

RUN 1  branch as committed            112 failed | 5891 passed | 35 skipped
RUN 2  null-device confound removed    37 failed  (3 probe-induced) -> 34 GENUINE
```

**81 of the 112 are one product defect.** The 34 is the number that describes our actual
portability debt. We reproduce **22 of the remote agent's 23**, with Family A matching
file-for-file.

Full write-up: `docs/plans/083-windows-portability/assets/windows/vm-082-measurement.md`. Raw JSON for both runs: `docs/plans/083-windows-portability/assets/windows/vm-082/`.
Their report, marked as their claim: `docs/plans/083-windows-portability/assets/windows/remote-23-failures.md`.

## Why our CI never caught any of it

`.github/workflows/windows.yml` ran bare `vitest run`, taking `vitest.config.ts`'s `fast` default —
**349 files** — and is report-only (`exit 0` regardless). Five runs, all `success`. Fixed in
`5e1aa48a`: the scope is now explicit and printed with the results. **Your fixes must be verified
at `scope=all`; `fast` will lie to you exactly as it lied to us.**

## THE RULE THAT MATTERS MOST HERE

**Do not relax an assertion to make it pass.** Thirteen of these compare a Windows path against a
POSIX-shaped expectation, and the cheap fix — rewrite the expectation to whatever Windows printed —
produces a test that **passes a revert and fails a correct fix**. For every failing row, decide
*which side is wrong* and say so in the commit. Where the product is wrong, fix the product and let
the test follow.

Corollary: **a test written from the implementation pins the implementation.** If you find yourself
running the code to discover what to assert, stop and work out what it *should* be.

## EVERYTHING LANDS ON PR #118's BRANCH — Jordan's explicit call

**There is no second PR.** Your stream branch exists only because git cannot check one branch out
into three worktrees at once; it is an isolation device, not a destination. When your reviewer
passes you, **merge your stream branch into `s077/suite-portability`** (take the gate baton first —
`pij orchestration baton request s077-gate --purpose "..."`), verify the merge, push. The PM will
coordinate ordering if two of you are ready together.

After any merge from another stream, **re-run your own suite before claiming green**: a clean
auto-merge is not semantic compatibility, and this branch has already had one guard silently
re-removed by a merge that git considered conflict-free.

## Verification ladder — every stream, in this order

1. **Mac**, `HARNESS_TEST_SCOPE=all`, your worktree. Green here proves nothing about Windows, but
   red here means you broke something that worked.
2. **Windows VM**, `scope=all` — via `pij-mid-wilson`, which owns the VM lane and already has a
   working clone at `C:\082`. **Do not drive the VM yourself**: it is one machine, three streams,
   and concurrent runs would interleave. Hand wilson your branch + sha and ask for a run.
3. **GitHub Actions Linux** — automatic on push.
4. **GitHub Actions Windows** — `workflow_dispatch` on `windows.yml`, pointed at your ref. **Ask
   the PM before dispatching**; it costs Actions minutes and Jordan asked us to prefer the VM.

**Report the denominator with every number**: scope, files, collected. A count without its scope is
unreadable — 349 files green and 393 files with 112 failures are both true of the same sha.

## Your reviewer

Each stream has a paired reviewer (gpt-5.6-sol, high). Brief them RED-first: what you changed, what
you deliberately did NOT change, and what you are least sure of. A reviewer told only the happy path
reviews the happy path. At the end a separate gpt-5.6-sol **max** reviewer checks all three streams
together, so cross-stream interactions are their job, not yours — but flag anything you notice.

## Working rules (non-negotiable)

- Work **only** in your own worktree. Never `git add -A`, never `git stash`, explicit pathspecs.
- Never touch `main`, the shared `s077-suite-portability` worktree, or another stream's branch.
- Commit: `HARNESS_NO_TELEMETRY=1 timeout 30 git commit --no-verify`.
- `gh` runs as `env -u GH_TOKEN`. Never print a token.
- `just fix` before pushing — CI runs biome, `harness checks` does not.
- Rebuild with `just build` after editing: the live harness runs `dist/`, not `src/`.
- **A suite mixing src-importing and dist-executing tests can report two revisions of one function
  in a single run.** A green row means nothing until the build is newer than the edit.
- Questions to the PM in chat, one at a time. Never a modal question UI.
- `pij report now "<did>" "<next>"` at the start and end of each unit.

## Standing facts you should not re-derive

- **Native Windows Cursor has no sandbox** (it runs its Linux sandbox inside WSL2). Every Windows
  measurement here is the pass-through case.
- **The VM is not a clean fixture** — git-ai is installed on it. Fine for tests; not a from-zero
  observation.
- **`dd-schema-fs.test.ts` fails at COLLECTION** on symlink EPERM (unprivileged Windows cannot
  symlink). Its tests are not passed, failed or skipped — **absent**. That is how a suite shrinks
  while every number stays self-consistent. Keep it separate from any count you report.
- **Biome's formatter fails on Windows in all three codegen steps and the build still exits 0**,
  leaving generated `*-content.ts` non-canonical. It manufactured no test failures. Out of scope
  for all three streams — recorded so nobody rediscovers it.

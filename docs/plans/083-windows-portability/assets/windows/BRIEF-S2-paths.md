# S2 — PORTABILITY. Thirteen path-shaped failures, and the product asymmetry underneath them

**Worktree**: `harness-engineering-worktrees/s077-win-paths` · **Branch**: `s077/win-paths` @ `5e1aa48a`
**Read `docs/plans/083-windows-portability/assets/windows/STREAM-CONTEXT.md` first.** Everything merges into `s077/suite-portability`.

---

## Start with the product defect, not the tests

`harness/cli/src/services/hooks/binary-path.ts` declares as **property 4** that embed and extract
are inverses — *"EXTRACTABLE AGAIN"*. They are not:

```js
normaliseBinaryPath = path.replace(WINDOWS_EXTENDED_PREFIX, '').replace(/\\/g, '/')
embedBinaryPath     = quoteForShell(normaliseBinaryPath(path))
```

`\` → `/` on the way **in**, and **nothing reverses it on the way out**. `stat()` tolerates the
forward-slash form, so `status` still reports `installed` — which is precisely why this survived.
Any caller string-comparing an extracted path against a native `path.join()` result mismatches.

**A documented invariant the code does not hold, masked by a tolerant consumer.** Decide whether
the fix is to denormalise on extraction, to compare path-semantically rather than by string, or to
weaken the documented property to what the code actually promises — **and justify the choice**. All
three are defensible; silently doing one and leaving the docstring claiming another is not.

## Then the 13 assertions

Verbatim list with file/test/signature: `docs/plans/083-windows-portability/assets/windows/vm-082-measurement.md` (ours) and
`docs/plans/083-windows-portability/assets/windows/remote-23-failures.md` (theirs — read as a cross-check, not a spec; note their header
says 17 while their table enumerates 13, and **13 is right**).

Spread across `acts/doctor.test.ts`, `hooks/binary-path.test.ts`, `hooks/command-runs.test.ts`,
`hooks/install-strategy-a.test.ts`, `hooks/legacy-command-form.test.ts`,
`hooks/verbs-e2e.int.test.ts`, `collector/backup-restore.int.test.ts`.

**Two of them are not path-separator at all** and the remote agent filed them under Family A
anyway — `acts/doctor.test.ts` "envelope has 13 layers, test pins 12" and "injected ingress probe
returns `[]`, expects 1". **Triage those separately**; a count pinned at 12 when the envelope has 13
is a staleness bug, not a portability one, and fixing it as if it were the latter would hide it.

## The trap, restated because it is the whole job

Thirteen assertions currently encode POSIX expectations. The cheap fix is to rewrite each
expectation to whatever Windows printed. **That produces tests which pass a revert and fail a
correct fix** — the exact inverse of what a test is for. For each row, decide which side is wrong.
Where an assertion is genuinely platform-shaped, prefer a **path-semantic comparison** over a
literal string, so the test stops being platform-dependent rather than becoming
Windows-dependent instead.

## Scope discipline

Do not touch `exec-remote-telemetry-git.ts` or `acts/flow.ts` (S1), or
`composition-boundaries.test.ts` (S3). Find a third defect → report it, do not fix it.

# S1 — PRODUCT. Two defects that make harness give confidently wrong answers on Windows

**Worktree**: `harness-engineering-worktrees/s077-win-product` · **Branch**: `s077/win-product` @ `5e1aa48a`
**Read `docs/plans/083-windows-portability/assets/windows/STREAM-CONTEXT.md` first.** Yours is the highest-risk stream: both defects are in
shipped product code and **P1 is on `main`**, not just this branch.

---

## P1 — `GIT_CONFIG_GLOBAL` points at a Windows null device, and git refuses to run

**81 of our 112 Windows failures.** Measured directly, outside vitest, four verbs × three values,
with a positive control, on git `2.55.0.windows.3`:

```
GIT_CONFIG_GLOBAL=NUL        -> exit 128  "fatal: unable to access 'NUL': Invalid argument"
GIT_CONFIG_GLOBAL=\\.\nul    -> exit 128  same
GIT_CONFIG_GLOBAL=/dev/null  -> exit 0, isolated, works
```

So `ExecRemoteTelemetryGit` is **inoperative on that box** — every telemetry git call exits 128.

**The two values differ by branch, and this trips people up:**

| | value used | source |
|---|---|---|
| `main` | `\\.\nul` | `os.devNull` passed straight through |
| this branch | `'NUL'` | `nullDeviceForPlatform()` |

Both measured at 128. A reader who greps `main` for `NUL` finds nothing and wrongly concludes the
report was wrong. **Say it precisely in your commit.**

### What makes this the most instructive defect in the plan

`exec-remote-telemetry-git.ts` carries a doc comment recording a measurement table attributed to
*"the downstream consumer of #108, with a positive control"*, asserting `GIT_CONFIG_GLOBAL=NUL →
exit 0 ISOLATED`. Product code was built on it. A unit test
(`exec-remote-telemetry-git-null-device.test.ts`) then asserts the same value **and passes**, because
on Linux the win32 branch is never exercised. **Our suite actively defends the broken constant.**
Nobody re-measured, because a positive control had already been cited.

Your fix must kill all three: the value, the test that defends it, and the comment that laundered
someone else's measurement into a fact of ours.

### On the fix itself — DO NOT just substitute `/dev/null`

It works on Windows because git treats a **missing file** as no config. That is relying on a
behaviour, not using a device, and it would be a second unexamined constant replacing the first.
The intent is *"no global config"*. State that intent in a platform-neutral way — a
guaranteed-empty temp file we create and clean up is the obvious candidate, but **the design call is
yours to make and justify**; if you find something better, take it.

Whatever you choose, the test must **exercise the win32 branch on every platform** (inject the
platform, as `nullDeviceForPlatform(platform)` already allows) so this can never again pass by not
being run.

**`main` is affected.** Fix it here; flag to the PM whether it wants a separate cherry-pick.

## P2 — `docRepoRoot` anchors a document to the WRONG repository

**5 rows.** `src/acts/flow.ts`, `docRepoRoot()`:

```js
for (let hops = 0; hops < 64; hops += 1) {
  if (deps.fs.exists(posixJoin(dir, '.git'))) return dir;   // <- tested BEFORE the fixpoint check
  const parent = posixDirname(dir);
  if (parent === dir) break;
  dir = parent;
}
```

On POSIX the walk stops at `/` and falls back to cwd. **On Windows it walks through the drive root**:
`C:/Users/x` → `C:` → `posixDirname("C:")` → `"."`. The loop then tests `exists("./.git")`, which
resolves against `process.cwd()` — the harness repo — finds it, and **returns `"."`**.

Three things wrong at once: it does not fall back, it returns a **relative** root that means
something different per caller, and it does so **confidently**. Symptom: `E441
DD_GATE_TARGET_INVALID` where `E440`/a verdict is expected, and a healthy plan orienting
`unevaluable`.

The function's own docstring warns about exactly this class — *"worse than an error: it is a refusal
the reader can only clear with `--force`, for a document that was never incomplete."* On Windows the
guard it describes is what misfires.

**Fix the walk to recognise a drive root as a terminal**, and make the fallback reachable. A
regression test must run the win32 path shape **on every platform**, not only on Windows.

## Scope discipline

Two defects, no more. If you find a third, **report it, do not fix it** — a stream that grows
mid-flight cannot be reviewed against its brief. Do not touch the path-separator assertions (S2) or
`composition-boundaries.test.ts` (S3).
